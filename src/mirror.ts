import * as THREE from "three";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandTracker } from "./handTracker";
import type { Room } from "./rooms";

/**
 * A steamed-up bathroom mirror. The screen shows your reflection (the webcam,
 * flipped), misted over with fog and creeping frost. Wipe it clear with an
 * open hand, or draw in it with one finger; the mouse works too. The fog
 * slowly comes back from the edges of what you cleared, leaving faint smears,
 * frost grows in from the corners and is harder to wipe, and the water you
 * push aside gathers into drops that run down the glass.
 *
 * The fog, frost and smears live in a small texture that a shader updates
 * every frame (red: fog, green: frost, blue: smear left by wiping). Drops
 * are simulated here and drawn as tiny lenses over the reflection.
 */
export interface MirrorSettings {
  /** How thick the fog gets, 0 to 1. */
  mirrorFog: number;
  /** How fast the fog comes back, 1 is normal. */
  mirrorFogReturn: number;
  /** How blurred the reflection is behind the fog, 0 to 1. */
  mirrorBlur: number;
  /** How visible the smears left by wiping are, 0 to 1. */
  mirrorSmears: number;
  /** How far frost grows in from the edges, 0 to 1. */
  mirrorFrost: number;
  /** How fast frost grows, 1 is normal. */
  mirrorFrostSpeed: number;
  /** How hard frost is to wipe away, 0 (like fog) to 1 (barely). */
  mirrorFrostHardness: number;
  /** How far towards the mirror a hand must reach to wipe: 0 any raised hand wipes, 1 only right up close. */
  mirrorReach: number;
  /** Width of an open-hand wipe, 1 is normal. */
  mirrorPalmSize: number;
  /** Width of a line drawn with one finger, 1 is normal. */
  mirrorFingerSize: number;
  /** How many water drops form and run down, 0 to 1. */
  mirrorDrops: number;
  /** Show a faint ring where each hand is. */
  mirrorShowHands: boolean;
}

export const MIRROR_DEFAULTS: MirrorSettings = {
  mirrorFog: 0.85,
  mirrorFogReturn: 1,
  mirrorBlur: 0.6,
  mirrorSmears: 0.5,
  mirrorFrost: 0.4,
  mirrorFrostSpeed: 1,
  mirrorFrostHardness: 0.6,
  mirrorReach: 0.3,
  mirrorPalmSize: 1,
  mirrorFingerSize: 1,
  mirrorDrops: 0.5,
  mirrorShowHands: true,
};

export interface MirrorDeps {
  renderer: THREE.WebGLRenderer;
  /** The webcam, as the head tracker runs it. */
  video: HTMLVideoElement;
  hands: HandTracker;
  /** The tracked person's body landmarks, for judging how far a hand reaches. */
  body: () => NormalizedLandmark[] | null;
  /** The canvas the scene is drawn on, for wiping with the mouse. */
  canvas: HTMLCanvasElement;
}

export interface MirrorRoom extends Room {
  /** Mists the whole mirror over again. */
  refog(): void;
}

/** Wipes and drop trails per frame, at most. */
const MAX_SEGS = 24;
const MAX_DROPS = 260;

interface Drop {
  x: number;
  y: number;
  /** Radius, as a share of the mirror's height. */
  r: number;
  vy: number;
  sliding: boolean;
  wobble: number;
}

interface Stroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Radius, as a share of the mirror's height. */
  r: number;
  fog: number;
  frost: number;
}

/** Shared GLSL: value noise. */
const NOISE_GLSL = /* glsl */ `
  float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float mNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), u.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float mFbm(vec2 p) {
    return mNoise(p) * 0.5 + mNoise(p * 2.03 + 1.7) * 0.25 + mNoise(p * 4.1 + 3.1) * 0.125 + mNoise(p * 8.3 + 5.3) * 0.0625;
  }
`;

/** Shared GLSL: from a point on the mirror (0..1, y up) to the webcam image, flipped like a mirror and cropped to fill. */
const VIDEO_UV_GLSL = /* glsl */ `
  uniform vec2 uVideoScale;
  vec2 videoUv(vec2 m) {
    vec2 c = (m - 0.5) * uVideoScale;
    return vec2(0.5 - c.x, 0.5 + c.y);
  }
`;

export function createMirror(winW: number, winH: number, settings: MirrorSettings, deps: MirrorDeps): MirrorRoom {
  const { renderer, video, hands, body, canvas } = deps;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const aspect = winW / winH;

  // ---------- The reflection ----------
  const videoTexture = keep(new THREE.VideoTexture(video));
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  const videoScale = new THREE.Vector2(1, 1);
  const updateVideoScale = () => {
    const va = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    // Crop the webcam image to fill the mirror without stretching.
    if (va > aspect) videoScale.set(aspect / va, 1);
    else videoScale.set(1, va / aspect);
  };

  // ---------- Fog, frost and smears: simulated in a small texture ----------
  const simW = 512;
  const simH = Math.max(64, Math.round(simW / aspect));
  const makeTarget = () =>
    keep(
      new THREE.WebGLRenderTarget(simW, simH, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      }),
    );
  let simRead = makeTarget();
  let simWrite = makeTarget();
  const segA = Array.from({ length: MAX_SEGS }, () => new THREE.Vector4());
  const segB = Array.from({ length: MAX_SEGS }, () => new THREE.Vector4());
  const simUniforms = {
    uPrev: { value: simRead.texture as THREE.Texture },
    uTexel: { value: new THREE.Vector2(1 / simW, 1 / simH) },
    uAspect: { value: aspect },
    uDt: { value: 0 },
    uTime: { value: 0 },
    uReset: { value: 1 },
    uFogMax: { value: settings.mirrorFog },
    uFogReturn: { value: settings.mirrorFogReturn },
    uFrostMax: { value: settings.mirrorFrost },
    uFrostSpeed: { value: settings.mirrorFrostSpeed },
    uSegCount: { value: 0 },
    uSegA: { value: segA },
    uSegB: { value: segB },
  };
  const simMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: simUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #define MAX_SEGS ${MAX_SEGS}
        uniform sampler2D uPrev;
        uniform vec2 uTexel;
        uniform float uAspect, uDt, uTime, uReset, uFogMax, uFogReturn, uFrostMax, uFrostSpeed;
        uniform int uSegCount;
        uniform vec4 uSegA[MAX_SEGS]; // segment start and end
        uniform vec4 uSegB[MAX_SEGS]; // radius, fog strength, frost strength
        varying vec2 vUv;
        ${NOISE_GLSL}
        // How readily each spot frosts: first along the edges and in the corners, in an uneven, feathery front.
        float frostReach(vec2 uv) {
          vec2 p = vec2(uv.x * uAspect, uv.y);
          // A soft minimum of the distances to the four edges, so the front rounds the corners.
          vec4 e = vec4(uv.x * uAspect, (1.0 - uv.x) * uAspect, uv.y, 1.0 - uv.y);
          float edge = -log(dot(exp(-14.0 * e), vec4(1.0))) / 14.0;
          float corner = length(max(vec2(0.0), 0.35 - vec2(min(uv.x, 1.0 - uv.x) * uAspect, min(uv.y, 1.0 - uv.y))));
          return 1.0 - edge * 3.6 + corner * 1.6 + (mFbm(p * 1.6) - 0.5) * 1.1 + (mFbm(p * 6.0) - 0.5) * 0.35 + (mNoise(p * 30.0) - 0.5) * 0.15;
        }
        void main() {
          vec4 s = texture2D(uPrev, vUv);
          // 1: fog the whole mirror over again; 2: also clear the frost (a fresh start).
          if (uReset > 0.5) {
            gl_FragColor = vec4(uFogMax, uReset > 1.5 ? 0.0 : s.g, 0.0, 1.0);
            return;
          }
          vec4 n = (texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)) + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0))
                  + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)) + texture2D(uPrev, vUv - vec2(0.0, uTexel.y))) * 0.25;
          vec2 p = vec2(vUv.x * uAspect, vUv.y);

          // Fog creeps back in from the edges of a cleared patch, unevenly.
          float patchy = 0.5 + mNoise(p * 7.0 + uTime * 0.03);
          float fog = s.r + uDt * uFogReturn * 0.05 * patchy * (0.35 + 1.6 * n.r);
          fog = min(fog, uFogMax);

          // Frost grows towards how far it can reach here, fastest next to frost already there.
          float th = 1.0 - uFrostMax * 1.15;
          float target = smoothstep(th, th + 0.18, frostReach(vUv)) * step(0.001, uFrostMax);
          float frost = s.g;
          if (frost < target) frost = min(target, frost + uDt * uFrostSpeed * 0.04 * (0.15 + 2.5 * n.g));
          else frost = max(target, frost - uDt * 0.05);

          // Smears fade slowly.
          float smear = max(0.0, s.b - uDt * 0.012);

          for (int i = 0; i < MAX_SEGS; i++) {
            if (i >= uSegCount) break;
            vec2 a = vec2(uSegA[i].x * uAspect, uSegA[i].y);
            vec2 b = vec2(uSegA[i].z * uAspect, uSegA[i].w);
            vec2 ab = b - a;
            float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
            float d = length(p - a - ab * t);
            float r = uSegB[i].x;
            // A soft-edged, slightly ragged brush.
            float edge = r * (0.85 + 0.25 * mNoise(p * 90.0 / max(r * 30.0, 0.5)));
            float w = 1.0 - smoothstep(edge * 0.55, edge, d);
            fog *= 1.0 - w * uSegB[i].y;
            frost *= 1.0 - w * uSegB[i].z;
            smear = max(smear, w * uSegB[i].y * (0.6 + 0.4 * mNoise(p * 160.0)));
          }
          gl_FragColor = vec4(fog, frost, smear, 1.0);
        }`,
    }),
  );
  const simScene = new THREE.Scene();
  const simQuad = new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2)), simMaterial);
  simQuad.frustumCulled = false;
  simScene.add(simQuad);
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- The mirror's surface ----------
  const handRings = [new THREE.Vector4(), new THREE.Vector4()];
  const mirrorUniforms = {
    uVideo: { value: videoTexture },
    uHasVideo: { value: 0 },
    uVideoScale: { value: videoScale },
    uSim: { value: simRead.texture as THREE.Texture },
    uAspect: { value: aspect },
    uTime: { value: 0 },
    uBlur: { value: settings.mirrorBlur },
    uSmears: { value: settings.mirrorSmears },
    uHands: { value: handRings },
  };
  const mirrorMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: mirrorUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uVideo;
        uniform sampler2D uSim;
        uniform float uHasVideo, uAspect, uTime, uBlur, uSmears;
        uniform vec4 uHands[2];
        varying vec2 vUv;
        ${NOISE_GLSL}
        ${VIDEO_UV_GLSL}
        // Fine bright needles: each patch of glass has its own crystal direction.
        float needles(vec2 p, float angle, float freq) {
          vec2 d = vec2(cos(angle), sin(angle));
          float along = dot(p, vec2(-d.y, d.x)) * freq + mNoise(p * 6.0) * 0.7;
          // Needles break off at random lengths along their direction.
          float run = step(0.35, mNoise(vec2(floor(along), dot(p, d) * 12.0)));
          return pow(1.0 - abs(fract(along) * 2.0 - 1.0), 10.0) * run;
        }
        float frostCrystals(vec2 p) {
          vec2 q = p * 4.0 + vec2(mNoise(p * 3.0), mNoise(p * 3.0 + 4.0)) * 1.6;
          vec2 cell = floor(q);
          float angle = mHash(cell) * 3.1416;
          float spine = needles(p, angle, 45.0);
          float branch = needles(p, angle + 1.047, 70.0) * step(0.4, mHash(cell + 3.0)) + needles(p, angle - 1.047, 70.0) * step(0.5, mHash(cell + 5.0));
          // Crystals fade out towards their patch's edge, so patches don't look tiled.
          vec2 f = fract(q) - 0.5;
          float fade = 1.0 - smoothstep(0.25, 0.5, max(abs(f.x), abs(f.y)) - mNoise(q * 4.0) * 0.15);
          return clamp(spine * 0.9 + branch * 0.6, 0.0, 1.0) * (0.35 + 0.65 * fade);
        }
        // What the mirror reflects at a point on it.
        vec3 reflection(vec2 m) {
          if (uHasVideo > 0.5) return texture2D(uVideo, clamp(videoUv(m), 0.001, 0.999)).rgb;
          // No camera yet: a dim, warm bathroom with a lamp up to the left.
          vec2 p = vec2(m.x * uAspect, m.y);
          vec3 c = mix(vec3(0.05, 0.045, 0.04), vec3(0.2, 0.17, 0.13), m.y);
          c += vec3(0.5, 0.4, 0.28) * exp(-length(p - vec2(0.25 * uAspect, 0.85)) * 3.0);
          vec2 tile = abs(fract(p * 9.0) - 0.5);
          c *= 0.92 + 0.08 * smoothstep(0.46, 0.5, max(tile.x, tile.y)) * step(m.y, 0.45);
          return c;
        }
        void main() {
          vec2 m = vUv;
          vec2 p = vec2(m.x * uAspect, m.y);
          vec4 s = texture2D(uSim, m);
          float fog = s.r, frost = s.g, smear = s.b;

          vec3 sharp = reflection(m);
          // Fog scatters light: a soft blur, wider the thicker the fog.
          float radius = (0.004 + 0.03 * uBlur) * smoothstep(0.0, 0.7, max(fog, frost));
          vec3 blurred = sharp;
          if (radius > 0.0005) {
            blurred = vec3(0.0);
            for (int i = 0; i < 12; i++) {
              float a = float(i) * 2.39996 + 0.5;
              float rr = radius * sqrt((float(i) + 0.5) / 12.0);
              blurred += reflection(m + vec2(cos(a) / uAspect, sin(a)) * rr);
            }
            blurred /= 12.0;
          }
          vec3 col = mix(sharp, blurred, smoothstep(0.0, 0.5, max(fog, frost)));

          // Fog: a pale mist made of countless tiny beads.
          float beads = mNoise(p * 420.0) * 0.6 + mNoise(p * 160.0) * 0.4;
          vec3 mist = vec3(0.78, 0.8, 0.82) * (0.88 + 0.2 * beads);
          // Where the fog came back over a wipe, the smear shows as streaks.
          float streak = mNoise(vec2(p.x * 60.0 + p.y * 18.0, p.y * 4.0)) * 0.6 + mNoise(p * 30.0) * 0.4;
          // Where frost has formed, the water is ice rather than mist.
          float density = fog * (1.0 - uSmears * smear * 0.45 * (0.4 + streak)) * (1.0 - 0.75 * frost);
          col = mix(col, mist, density * 0.62);
          col += mist * 0.05 * density * smoothstep(0.55, 0.9, beads);

          // Frost: patches of crystal, each growing its fine needles in its own
          // direction with side branches at 60 degrees, over a pale icy haze.
          float crystal = clamp(frostCrystals(p) + frostCrystals(p * 2.3 + 7.0) * 0.6, 0.0, 1.0);
          // A thin, cold haze between the crystals, thicker where the frost is older...
          col = mix(col, blurred * 0.6 + vec3(0.62, 0.7, 0.78) * 0.45, frost * (0.4 + 0.25 * mNoise(p * 40.0)));
          // ...and the needles themselves, crisp and bright, densest at the growing front.
          float front = smoothstep(0.0, 0.4, frost) * (1.0 - 0.4 * smoothstep(0.7, 1.0, frost));
          col = mix(col, vec3(0.95, 0.98, 1.0), crystal * front * 0.9);

          // A bright rim where the cleared glass meets the fog.
          vec2 g = vec2(dFdx(fog), dFdy(fog));
          col += vec3(0.9) * 0.25 * smoothstep(0.004, 0.03, length(g)) * fog;

          // The mirror's edge: a slight bevel catching the light, and a darker silvering towards the border.
          float border = min(min(m.x, 1.0 - m.x) * uAspect, min(m.y, 1.0 - m.y));
          col *= 0.86 + 0.14 * smoothstep(0.0, 0.08, border);
          col += vec3(0.35) * (1.0 - smoothstep(0.0, 0.006, border)) * (0.5 + 0.5 * m.y);

          // Faint rings where the hands are: dashed while out of reach, solid while wiping.
          for (int i = 0; i < 2; i++) {
            vec4 h = uHands[i];
            if (h.w < 0.01) continue;
            float d = length(p - vec2(h.x * uAspect, h.y));
            float ring = 1.0 - smoothstep(0.0, 0.004, abs(d - h.z));
            float dash = h.w > 0.75 ? 1.0 : step(0.5, fract(atan(p.y - h.y, p.x - h.x * uAspect) * 3.0));
            col = mix(col, vec3(1.0), ring * dash * (h.w > 0.75 ? 0.5 : 0.25));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const mirror = new THREE.Mesh(keep(new THREE.PlaneGeometry(winW, winH)), mirrorMaterial);
  mirror.position.z = -0.002;
  group.add(mirror);

  // ---------- Drops: tiny lenses on the glass ----------
  const dropPositions = new Float32Array(MAX_DROPS * 3);
  const dropInfo = new Float32Array(MAX_DROPS * 3); // mirror u, v, radius in pixels
  const dropGeometry = keep(new THREE.BufferGeometry());
  dropGeometry.setAttribute("position", new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  dropGeometry.setAttribute("aInfo", new THREE.BufferAttribute(dropInfo, 3).setUsage(THREE.DynamicDrawUsage));
  const dropMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: {
        uVideo: mirrorUniforms.uVideo,
        uHasVideo: mirrorUniforms.uHasVideo,
        uVideoScale: mirrorUniforms.uVideoScale,
        uPx: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aInfo;
        varying vec3 vInfo;
        void main() {
          vInfo = aInfo;
          gl_PointSize = aInfo.z * 2.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uVideo;
        uniform float uHasVideo, uPx;
        varying vec3 vInfo;
        ${VIDEO_UV_GLSL}
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          c.y = -c.y;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          // A drop is a small lens: it shows the reflection around it, upside down and squeezed.
          vec2 m = vInfo.xy - c * (vInfo.z / uPx) * 2.2;
          vec3 seen = uHasVideo > 0.5 ? texture2D(uVideo, clamp(videoUv(m), 0.001, 0.999)).rgb : vec3(0.15, 0.13, 0.1);
          vec3 col = seen * 1.05;
          // Darker towards its edge, where light bends away.
          col *= 1.0 - 0.65 * smoothstep(0.35, 1.0, r2);
          // A sharp highlight up to the left, and a faint one opposite.
          col += vec3(1.0) * smoothstep(0.12, 0.0, length(c - vec2(-0.35, 0.4))) * 0.9;
          col += vec3(1.0) * smoothstep(0.25, 0.0, length(c - vec2(0.3, -0.45))) * 0.12;
          gl_FragColor = vec4(col, smoothstep(1.0, 0.8, r2));
          #include <colorspace_fragment>
        }`,
    }),
  );
  const dropPoints = new THREE.Points(dropGeometry, dropMaterial);
  dropPoints.frustumCulled = false;
  dropPoints.renderOrder = 1;
  group.add(dropPoints);
  const drops: Drop[] = [];

  // ---------- Wiping ----------
  const strokes: Stroke[] = [];
  /** Removes or pushes aside drops under a wipe, and leaves new ones along its edges. */
  const wipeDrops = (s: Stroke, moved: number) => {
    for (const d of drops) {
      const t = segmentT(d.x * aspect, d.y, s.ax * aspect, s.ay, s.bx * aspect, s.by);
      const cx = (s.ax + (s.bx - s.ax) * t) * aspect;
      const cy = s.ay + (s.by - s.ay) * t;
      const dx = d.x * aspect - cx;
      const dy = d.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < s.r) {
        if (s.r < 0.03) {
          d.r = 0; // a fingertip just takes the drop with it
        } else {
          // Pushed to the edge of the wipe.
          const k = (s.r * 1.02) / Math.max(dist, 1e-4);
          d.x = (cx + dx * k) / aspect;
          d.y = cy + dy * k;
        }
      }
    }
    if (s.r < 0.03 || settings.mirrorDrops <= 0) return;
    // Water pushed aside beads up along the wipe's edges.
    const count = Math.floor(moved / s.r * 4 * settings.mirrorDrops + Math.random());
    for (let i = 0; i < count && drops.length < MAX_DROPS; i++) {
      const t = Math.random();
      const ax = (s.ax + (s.bx - s.ax) * t) * aspect;
      const ay = s.ay + (s.by - s.ay) * t;
      const a = Math.random() * Math.PI * 2;
      drops.push(newDrop((ax + Math.cos(a) * s.r) / aspect, ay + Math.sin(a) * s.r, 0.002 + Math.random() * 0.006));
    }
  };
  const newDrop = (x: number, y: number, r: number): Drop => ({ x, y, r, vy: 0, sliding: false, wobble: Math.random() * 10 });

  // The mouse: drag to wipe with an open hand; right-drag or shift-drag draws with a finger.
  let pointer: { x: number; y: number; finger: boolean; down: boolean; moved: boolean } | null = null;
  const toMirror = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: 1 - (e.clientY - rect.top) / rect.height };
  };
  const onDown = (e: PointerEvent) => {
    if (e.target !== canvas) return;
    const at = toMirror(e);
    pointer = { ...at, finger: e.button === 2 || e.shiftKey, down: true, moved: true };
    pointerPath.push({ ...at });
  };
  const pointerPath: { x: number; y: number }[] = [];
  const onMove = (e: PointerEvent) => {
    if (!pointer?.down) return;
    const at = toMirror(e);
    pointerPath.push(at);
  };
  const onUp = () => {
    if (pointer) pointer.down = false;
  };
  const onMenu = (e: Event) => {
    if (e.target === canvas) e.preventDefault();
  };
  window.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("contextmenu", onMenu);

  // Hands: where each was last frame, to wipe along the path between.
  const lastHand = new Map<string, { x: number; y: number; pose: string; t: number }>();

  const brush = (finger: boolean) =>
    finger
      ? { r: 0.012 * settings.mirrorFingerSize, fog: 0.95, frost: 0.9 * (1 - settings.mirrorFrostHardness * 0.8) }
      : { r: 0.085 * settings.mirrorPalmSize, fog: 0.8, frost: 0.45 * (1 - settings.mirrorFrostHardness * 0.9) };

  const addStroke = (ax: number, ay: number, bx: number, by: number, finger: boolean) => {
    const b = brush(finger);
    const s: Stroke = { ax, ay, bx, by, ...b };
    strokes.push(s);
    wipeDrops(s, Math.hypot((bx - ax) * aspect, by - ay));
  };

  /** Whether a hand is close enough to the mirror to wipe, judged by how big it looks next to the shoulders. */
  const reaching = (size: number) => {
    const reach = settings.mirrorReach;
    if (reach <= 0.001) return true;
    const lm = body();
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    if (lm && (lm[11].visibility ?? 1) > 0.5 && (lm[12].visibility ?? 1) > 0.5) {
      const shoulders = Math.hypot((lm[11].x - lm[12].x) * (vw / vh), lm[11].y - lm[12].y);
      if (shoulders > 0.02) return size / shoulders > 0.2 + 0.3 * reach;
    }
    return size > 0.05 + 0.15 * reach;
  };

  let lastTime = -1;
  let refogQueued = 2; // 2: fog over and clear the frost (first frame)

  const room: MirrorRoom = {
    group,
    background: new THREE.Color(0x000000),
    refog() {
      refogQueued = 1;
      drops.length = 0;
    },
    update(timeS) {
      const dt = lastTime < 0 ? 0 : Math.min(0.05, timeS - lastTime);
      lastTime = timeS;
      updateVideoScale();
      const hasVideo = video.readyState >= 2 && video.videoWidth > 0;
      mirrorUniforms.uHasVideo.value = hasVideo ? 1 : 0;
      mirrorUniforms.uTime.value = timeS;
      mirrorUniforms.uBlur.value = settings.mirrorBlur;
      mirrorUniforms.uSmears.value = settings.mirrorSmears;
      strokes.length = 0;

      // Mouse.
      if (pointer && pointerPath.length) {
        let prev = { x: pointer.x, y: pointer.y };
        for (const at of pointerPath) {
          addStroke(prev.x, prev.y, at.x, at.y, pointer.finger);
          prev = at;
        }
        pointer.x = prev.x;
        pointer.y = prev.y;
        pointerPath.length = 0;
      }

      // Hands.
      handRings.forEach((h) => h.set(0, 0, 0, 0));
      const now = performance.now();
      const fresh = now - hands.seenAt < 300;
      const seen = new Set<string>();
      (fresh ? hands.hands : []).slice(0, 2).forEach((hand, i) => {
        // Into mirror coordinates: flipped, and through the same crop as the picture.
        const x = 0.5 + (1 - hand.x - 0.5) / videoScale.x;
        const y = 0.5 + (1 - hand.y - 0.5) / videoScale.y;
        const close = reaching(hand.size);
        const active = close && hand.pose !== "fist";
        const finger = hand.pose === "point";
        const key = hand.side || String(i);
        seen.add(key);
        const before = lastHand.get(key);
        if (active) {
          const joined = before && before.pose === hand.pose && now - before.t < 200;
          // Light smoothing against jitter.
          const sx = joined ? before.x + (x - before.x) * 0.7 : x;
          const sy = joined ? before.y + (y - before.y) * 0.7 : y;
          addStroke(joined ? before.x : sx, joined ? before.y : sy, sx, sy, finger);
          lastHand.set(key, { x: sx, y: sy, pose: hand.pose, t: now });
        } else {
          lastHand.set(key, { x, y, pose: "none", t: now });
        }
        if (settings.mirrorShowHands) handRings[i].set(x, y, brush(finger).r * (finger ? 1.6 : 1), active ? 1 : 0.5);
      });
      for (const key of [...lastHand.keys()]) if (!seen.has(key)) lastHand.delete(key);

      // Drops: condensation slowly gathers into drops; big ones run down, clearing a trail.
      if (settings.mirrorDrops > 0 && drops.length < MAX_DROPS && Math.random() < dt * 3 * settings.mirrorDrops) {
        drops.push(newDrop(Math.random(), 0.05 + Math.random() * 0.95, 0.0015 + Math.random() * 0.003));
      }
      const slideAt = 0.0085;
      for (const d of drops) {
        if (d.r <= 0) continue;
        d.r += dt * 0.00015 * settings.mirrorDrops;
        if (!d.sliding && d.r > slideAt) d.sliding = true;
        if (d.sliding) {
          // Stick and slip: speed comes in fits as the drop meets dry or wet glass.
          d.wobble += dt * 3;
          const grip = 0.5 + 0.5 * Math.sin(d.wobble * 2.3) * Math.sin(d.wobble * 0.7);
          d.vy = Math.min(0.25, d.vy + dt * 0.6 * (1.2 - grip));
          d.vy *= 1 - dt * 2 * grip;
          const ox = d.x;
          const oy = d.y;
          d.y -= d.vy * dt;
          d.x += Math.sin(d.wobble) * 0.0006 / aspect;
          if (strokes.length < MAX_SEGS) strokes.push({ ax: ox, ay: oy, bx: d.x, by: d.y, r: d.r * 0.75, fog: 0.9, frost: 0.4 });
          // It loses water as it goes, now and then leaving a tiny drop behind.
          d.r -= dt * d.vy * 0.012;
          if (Math.random() < dt * d.vy * 25 && drops.length < MAX_DROPS) drops.push(newDrop(ox, oy, d.r * 0.25));
          if (d.r < slideAt * 0.6) d.sliding = false;
        }
        if (d.y < -0.05) d.r = 0;
      }
      // Drops that touch run together.
      for (let i = 0; i < drops.length; i++) {
        const a = drops[i];
        if (a.r <= 0) continue;
        for (let j = i + 1; j < drops.length; j++) {
          const b = drops[j];
          if (b.r <= 0) continue;
          if (Math.abs(a.y - b.y) > a.r + b.r) continue;
          if (Math.hypot((a.x - b.x) * aspect, a.y - b.y) < (a.r + b.r) * 0.8) {
            const big = a.r >= b.r ? a : b;
            const small = big === a ? b : a;
            big.r = Math.cbrt(big.r ** 3 + small.r ** 3);
            big.sliding ||= small.sliding;
            small.r = 0;
          }
        }
      }
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i].r <= 0.0008) drops.splice(i, 1);

      // Draw the drops.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const px = buffer.y; // pixels per mirror height: the window fills the view
      dropMaterial.uniforms.uPx.value = px;
      drops.forEach((d, i) => {
        dropPositions.set([(d.x - 0.5) * winW, (d.y - 0.5) * winH, -0.001], i * 3);
        dropInfo.set([d.x, d.y, Math.max(1.5, d.r * px)], i * 3);
      });
      dropGeometry.setDrawRange(0, drops.length);
      dropGeometry.attributes.position.needsUpdate = true;
      dropGeometry.attributes.aInfo.needsUpdate = true;

      // Step the fog and frost.
      simUniforms.uDt.value = dt;
      simUniforms.uTime.value = timeS;
      simUniforms.uFogMax.value = settings.mirrorFog;
      simUniforms.uFogReturn.value = settings.mirrorFogReturn;
      simUniforms.uFrostMax.value = settings.mirrorFrost;
      simUniforms.uFrostSpeed.value = settings.mirrorFrostSpeed;
      simUniforms.uReset.value = refogQueued;
      refogQueued = 0;
      const n = Math.min(MAX_SEGS, strokes.length);
      simUniforms.uSegCount.value = n;
      for (let i = 0; i < n; i++) {
        const s = strokes[i];
        segA[i].set(s.ax, s.ay, s.bx, s.by);
        segB[i].set(s.r, s.fog, s.frost, 0);
      }
      simUniforms.uPrev.value = simRead.texture;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(simWrite);
      renderer.render(simScene, simCamera);
      renderer.setRenderTarget(previous);
      [simRead, simWrite] = [simWrite, simRead];
      mirrorUniforms.uSim.value = simRead.texture;
    },
    dispose() {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("contextmenu", onMenu);
      disposables.forEach((d) => d.dispose());
    },
  };
  return room;
}

/** Where along segment a–b the point p is closest, 0 to 1. */
function segmentT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  return len < 1e-10 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len));
}
