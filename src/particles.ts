import * as THREE from "three";
import type { Cutout } from "./headTracker";
import type { HandTracker } from "./handTracker";
import type { Room } from "./rooms";

/**
 * A cloud of glowing dust behind the glass that gathers into you. Step in
 * front of the camera and the particles fly into your outline, coloured by
 * the webcam, as a statue of sand with some relief; step away and they drift
 * apart again.
 *
 * Your hands play with it: an open palm blows the particles away, a fist pulls
 * them into a swirling ball that bursts when you open your hand, and a
 * pointing finger draws a sparkler trail. The mouse works too: drag to push,
 * Shift-drag or right-drag to pull.
 *
 * Every particle lives on the GPU: its position and velocity are texels in
 * two pairs of float textures, stepped each frame by a shader. Each particle
 * owns one point of the webcam image (its texel), which is where it goes when
 * that point is part of you.
 */
export type ParticleColourMode = "camera" | "tint" | "heat";

export const PARTICLE_COLOUR_MODES: { id: ParticleColourMode; name: string }[] = [
  { id: "camera", name: "Camera colours" },
  { id: "tint", name: "One colour" },
  { id: "heat", name: "Heat glow" },
];

export interface ParticleSettings {
  /** Particles per side of the simulation texture: the count is this squared. */
  partCount: number;
  /** How solid you look: 0 loose drifting dust, 1 a sharp portrait. */
  partSolid: number;
  /** How far behind the glass you stand, in window heights. */
  partDepth: number;
  /** Size of the figure, 1 fills the window. */
  partSize: number;
  /** How much the figure bulges towards you, 0 flat. */
  partRelief: number;
  /** Size of each particle, 1 is normal. */
  partDot: number;
  /** How restless the loose dust is, 0 to 1. */
  partDust: number;
  /** How much moving fast smears your shape, 0 to 1. */
  partSmear: number;
  /** Seconds between automatic shatters, 0 for never. */
  partShatterEvery: number;
  /** Reach of a hand's push and pull, 1 is normal. */
  partHandSize: number;
  /** Strength of a hand's push and pull, 1 is normal. */
  partHandForce: number;
  /** How long a pointing finger's sparkler trail lasts, 0 for none. */
  partTrail: number;
  /** Show a small glow where each hand is. */
  partShowHands: boolean;
  partColourMode: ParticleColourMode;
  /** Colour for the one-colour mode. */
  partTint: string;
}

export const PARTICLE_DEFAULTS: ParticleSettings = {
  partCount: 448,
  partSolid: 0.6,
  partDepth: 0.6,
  partSize: 1,
  partRelief: 0.5,
  partDot: 1,
  partDust: 0.5,
  partSmear: 0.6,
  partShatterEvery: 0,
  partHandSize: 1,
  partHandForce: 1,
  partTrail: 1,
  partShowHands: true,
  partColourMode: "camera",
  partTint: "#7fd6ff",
};

export interface ParticleDeps {
  renderer: THREE.WebGLRenderer;
  hands: HandTracker;
  /** The latest cutout of the tracked person, and whether it's recent. */
  cutout: () => { cut: Cutout; fresh: boolean } | null;
  /** The canvas the scene is drawn on, for playing with the mouse. */
  canvas: HTMLCanvasElement;
}

export interface ParticleRoom extends Room {
  /** Breaks the figure apart; it gathers again a moment later. */
  shatter(): void;
}

/** Hands plus the mouse. */
const HANDS = 3;
/** Points remembered along a pointing finger's path. */
const TRAIL = 48;
/** Share of particles that join the sparkler trail. */
const SPARK_SHARE = 0.08;
/** The viewer's usual distance from the screen, in window heights: sets how big the figure must be to fill the view. */
const VIEW_DISTANCE = 3.5;
/** How long a shatter keeps the figure apart, in seconds. */
const SHATTER_HOLD = 1.3;
const SHATTER_RETURN = 1.2;

const POSE = { none: 0, palm: 1, point: 2, fist: 3 } as const;

/** Shared GLSL: hashes, noise and where a particle belongs. */
const COMMON_GLSL = /* glsl */ `
  #define HANDS ${HANDS}
  #define TRAIL ${TRAIL}
  uniform sampler2D uMask;
  uniform sampler2D uImage;
  uniform vec2 uVideoScale;
  uniform vec3 uStatueC;
  uniform vec2 uStatueSize;
  uniform float uRelief, uPerson, uSide, uTime, uTrailLife, uUnit;
  uniform vec4 uTrail[TRAIL];

  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453); }
  float h3(vec2 p) { return fract(sin(dot(p, vec2(419.2, 371.9))) * 43758.5453); }

  // A smooth random field in 3D, for the dust to drift along.
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
  }
  vec3 noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y), u.z);
  }

  // The point of the picture this particle owns (0..1, y up, as seen in a mirror).
  vec2 homeUv(vec2 ref) { return ref + (vec2(h1(ref), h2(ref)) - 0.5) / uSide; }
  // From the picture to the webcam image: flipped like a mirror and cropped to fill.
  vec2 imageUv(vec2 m) {
    vec2 c = (m - 0.5) * uVideoScale;
    return vec2(0.5 - c.x, 0.5 + c.y);
  }
  // How much a point of the picture is you (the mask's rows run top to bottom).
  float personAt(vec2 m) {
    vec2 uv = imageUv(m);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).r;
  }
  // How far inside your outline a point is, 0 at the edge to 1 deep inside: makes the relief round.
  float interior(vec2 m) {
    float s = 0.0;
    for (int ring = 1; ring <= 3; ring++) {
      float r = 0.025 * float(ring * ring);
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.0472 + float(ring) * 0.5;
        s += personAt(m + vec2(cos(a) * uStatueSize.y / uStatueSize.x, sin(a)) * r * 0.5);
      }
    }
    return s / 18.0;
  }
  vec3 statuePoint(vec2 m, float depth) {
    return uStatueC + vec3((m - 0.5) * uStatueSize, depth);
  }
  bool isSpark(vec2 ref) { return h3(ref) < ${SPARK_SHARE.toFixed(3)}; }
  vec4 sparkSlot(vec2 ref) { return uTrail[int(h1(ref + 7.0) * float(TRAIL))]; }
`;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function createParticles(winW: number, winH: number, settings: ParticleSettings, deps: ParticleDeps): ParticleRoom {
  const { renderer, hands, cutout, canvas } = deps;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  // Everything is sized by the window, so a TV gets the same picture as a laptop.
  const unit = winH;
  const aspect = winW / winH;
  const side = Math.max(64, Math.round(settings.partCount));
  const count = side * side;

  // ---------- Where the dust rests: a random spot in a box behind the glass ----------
  const rest = new Float32Array(count * 4);
  const restDepth = () => unit * (settings.partDepth + 1.2);
  for (let i = 0; i < count; i++) {
    rest[i * 4] = (Math.random() - 0.5) * winW * 1.6;
    rest[i * 4 + 1] = (Math.random() - 0.5) * winH * 1.6;
    // Depth as a share, so the box follows the depth setting.
    rest[i * 4 + 2] = Math.random();
    rest[i * 4 + 3] = Math.random();
  }
  const restTexture = keep(new THREE.DataTexture(rest, side, side, THREE.RGBAFormat, THREE.FloatType));
  restTexture.needsUpdate = true;

  // ---------- Simulation state: positions and velocities, ping-ponged ----------
  const makeTarget = () =>
    keep(
      new THREE.WebGLRenderTarget(side, side, {
        type: THREE.FloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      }),
    );
  let posRead = makeTarget();
  let posWrite = makeTarget();
  let velRead = makeTarget();
  let velWrite = makeTarget();

  // Until a person is seen: an empty mask and a plain picture.
  const blankMask = keep(new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType));
  blankMask.needsUpdate = true;
  const blankImage = keep(new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1));
  blankImage.needsUpdate = true;
  let maskTexture: THREE.DataTexture | null = null;
  let imageTexture: THREE.CanvasTexture | null = null;
  let cutVersion = -1;

  const videoScale = new THREE.Vector2(1, 1);
  const statueC = new THREE.Vector3();
  const statueSize = new THREE.Vector2();
  const trail = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, 0, 0, 999));
  const handUniform = Array.from({ length: HANDS }, () => new THREE.Vector4());
  const burstUniform = Array.from({ length: HANDS }, () => new THREE.Vector4());

  const shared = {
    uMask: { value: blankMask as THREE.Texture },
    uImage: { value: blankImage as THREE.Texture },
    uVideoScale: { value: videoScale },
    uStatueC: { value: statueC },
    uStatueSize: { value: statueSize },
    uRelief: { value: 0 },
    uPerson: { value: 0 },
    uSide: { value: side },
    uTime: { value: 0 },
    uTrailLife: { value: 1 },
    uUnit: { value: unit },
    uTrail: { value: trail },
  };

  const simCommon = {
    ...shared,
    uPos: { value: posRead.texture as THREE.Texture },
    uVel: { value: velRead.texture as THREE.Texture },
    uRest: { value: restTexture },
    uRestDepth: { value: restDepth() },
    uDt: { value: 0 },
    uReset: { value: 1 },
  };

  const velMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: {
        ...simCommon,
        uK: { value: 20 },
        uNoise: { value: 0.5 },
        uHand: { value: handUniform },
        uBurst: { value: burstUniform },
        uHandR: { value: 0.15 },
        uForce: { value: 1 },
        uHold: { value: 0 },
        uKick: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPos, uVel, uRest;
        uniform float uDt, uReset, uK, uNoise, uHandR, uForce, uHold, uKick, uRestDepth;
        varying vec2 vUv;
        ${COMMON_GLSL}
        uniform vec4 uHand[HANDS];
        uniform vec4 uBurst[HANDS];
        void main() {
          if (uReset > 0.5) { gl_FragColor = vec4(0.0); return; }
          vec4 P = texture2D(uPos, vUv);
          vec3 p = P.xyz;
          vec3 v = texture2D(uVel, vUv).xyz;
          vec4 R = texture2D(uRest, vUv);
          vec2 m = homeUv(vUv);

          // Where it wants to be: in your outline, or resting in the dust.
          float inside = smoothstep(0.35, 0.65, personAt(m)) * uPerson;
          vec3 restP = vec3(R.xy, -0.03 * uUnit - R.z * uRestDepth);
          vec3 drift = noise3(restP / uUnit * 1.5 + vec3(0.0, 0.0, uTime * 0.07)) * 0.25 * uUnit * (0.3 + uNoise);
          vec3 target = restP + drift;
          float k = 1.2;
          if (inside > 0.01) {
            float bulge = pow(interior(m), 0.7);
            vec3 col = texture2D(uImage, imageUv(m)).rgb;
            float lum = dot(col, vec3(0.3, 0.55, 0.15));
            vec3 statue = statuePoint(m, (bulge * 0.8 + lum * 0.2) * uRelief);
            target = mix(target, statue, inside);
            k = mix(k, uK, inside);
          }
          // Sparks follow the trail a pointing finger leaves, falling as they age.
          if (isSpark(vUv)) {
            vec4 s = sparkSlot(vUv);
            if (s.w < uTrailLife) {
              vec3 jitter = (vec3(h1(vUv + 3.0), h2(vUv + 3.0), h3(vUv + 3.0)) - 0.5) * uUnit * (0.01 + 0.06 * s.w);
              target = s.xyz + jitter - vec3(0.0, s.w * s.w * 0.1 * uUnit, 0.0);
              k = 60.0;
            }
          }

          float follow = 1.0 - uHold;
          vec3 a = (target - p) * k * follow;
          // Just short of critical damping: a little overshoot looks alive.
          a -= v * 2.0 * sqrt(k) * mix(0.25, 0.8, follow);
          // Restlessness: loose dust wanders, a solid figure only shimmers.
          a += noise3(p / uUnit * 4.0 + vec3(uTime * 0.3, 0.0, R.w * 10.0)) * uUnit * uNoise * mix(3.0, 0.6, inside);

          for (int i = 0; i < HANDS; i++) {
            vec4 h = uHand[i];
            vec3 d = p - h.xyz;
            float r = length(d) + 1e-5;
            vec3 dir = d / r;
            if (h.w > 0.5 && h.w < 1.5) {
              // Open palm: a gust that blows particles away, mostly back into the room.
              float f = 1.0 - r / uHandR;
              if (f > 0.0) a += normalize(dir + vec3(0.0, 0.0, -0.6)) * f * f * uForce * 90.0 * uUnit;
            } else if (h.w > 2.5) {
              // Fist: pull particles into a swirling ball around the hand.
              float reach = uHandR * 1.1 * sqrt(uForce);
              float c = 1.0 - smoothstep(reach * 0.6, reach, r);
              if (c > 0.0) {
                float shell = uHandR * 0.25 * (0.3 + 0.9 * h1(vUv + 9.0));
                // Drawn in hard, and steered towards a steady spin (not a growing one), so it holds together as a ball.
                a += -dir * (r - shell) * 160.0 * uForce * c;
                vec3 axis = normalize(vec3(0.3, 1.0, 0.2) + (vec3(h1(vUv + 2.0), h2(vUv + 2.0), h3(vUv + 2.0)) - 0.5) * 0.8);
                vec3 spin = cross(axis, dir) * min(r, shell * 2.0) * 7.0;
                a += (spin - v) * 6.0 * c;
                a -= (target - p) * k * follow * c;
              }
            }
            // A fist opening: everything near flies outwards.
            vec4 b = uBurst[i];
            if (b.w > 0.5) {
              vec3 e = p - b.xyz;
              float re = length(e) + 1e-5;
              float f = 1.0 - re / (uHandR * 1.2);
              // Mostly sideways and back into the room, so the burst doesn't fill the glass.
              vec3 kick = e / re + (vec3(h1(vUv), h2(vUv), h3(vUv)) - 0.5) * 0.8;
              kick.z = kick.z * 0.4 - 0.3;
              if (f > 0.0) v += normalize(kick) * sqrt(f) * uUnit * 3.5 * uForce;
            }
          }

          // Shattering: one kick outwards, then gravity while the figure lets go.
          if (uKick > 0.5) {
            vec3 away = normalize(p - uStatueC + (vec3(h1(vUv), h2(vUv), h3(vUv)) - 0.5) * uUnit * 0.6);
            // Sideways and back into the room, never out at the viewer.
            away.z = -abs(away.z) * 0.6 - 0.15;
            v += away * uUnit * (0.3 + 1.1 * h2(vUv + 1.0));
          }
          a.y -= uHold * 3.0 * uUnit;

          v += a * uDt;
          float speed = length(v);
          float maxSpeed = 12.0 * uUnit;
          if (speed > maxSpeed) v *= maxSpeed / speed;
          gl_FragColor = vec4(v, inside);
        }`,
    }),
  );

  const posMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: { ...simCommon, uNewVel: { value: velWrite.texture as THREE.Texture } },
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPos, uNewVel, uRest;
        uniform float uDt, uReset, uRestDepth;
        varying vec2 vUv;
        ${COMMON_GLSL}
        void main() {
          if (uReset > 0.5) {
            vec4 R = texture2D(uRest, vUv);
            gl_FragColor = vec4(R.xy, -0.03 * uUnit - R.z * uRestDepth, 0.0);
            return;
          }
          vec4 P = texture2D(uPos, vUv);
          vec4 V = texture2D(uNewVel, vUv);
          // w: how much of you this particle is showing, eased so colours blend as it flies.
          float w = mix(P.w, V.w, 1.0 - exp(-uDt * 6.0));
          gl_FragColor = vec4(P.xyz + V.xyz * uDt, w);
        }`,
    }),
  );

  const simScene = new THREE.Scene();
  const simQuad = new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2)), velMaterial);
  simQuad.frustumCulled = false;
  simScene.add(simQuad);
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------- Drawing: one point per particle ----------
  const refs = new Float32Array(count * 2);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = y * side + x;
      refs[i * 2] = (x + 0.5) / side;
      refs[i * 2 + 1] = (y + 0.5) / side;
    }
  }
  const pointGeometry = keep(new THREE.BufferGeometry());
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  pointGeometry.setAttribute("aRef", new THREE.BufferAttribute(refs, 2));
  const tint = new THREE.Color(settings.partTint);
  const pointUniforms = {
    ...shared,
    uPos: { value: posRead.texture as THREE.Texture },
    uDot: { value: 1 },
    uViewH: { value: 1 },
    uMode: { value: 0 },
    uTint: { value: tint },
  };
  const pointMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: pointUniforms,
      vertexShader: /* glsl */ `
        uniform sampler2D uPos;
        uniform float uDot, uViewH;
        uniform int uMode;
        uniform vec3 uTint;
        attribute vec2 aRef;
        varying vec3 vColour;
        ${COMMON_GLSL}
        vec3 heat(float t) {
          t = clamp(t, 0.0, 1.0);
          return mix(mix(vec3(0.05, 0.0, 0.15), vec3(0.9, 0.1, 0.05), smoothstep(0.0, 0.45, t)),
                     mix(vec3(1.0, 0.55, 0.05), vec3(1.0, 1.0, 0.85), smoothstep(0.7, 1.0, t)), smoothstep(0.4, 0.75, t));
        }
        void main() {
          vec4 P = texture2D(uPos, aRef);
          vec2 m = homeUv(aRef);
          vec3 cam = texture2D(uImage, imageUv(m)).rgb;
          float lum = dot(cam, vec3(0.3, 0.55, 0.15));
          // You: the picture, one colour shaded by brightness, or a glow by brightness and nearness.
          vec3 you = cam;
          if (uMode == 1) you = uTint * (0.25 + 1.3 * lum);
          else if (uMode == 2) you = heat(lum * 0.7 + (P.z - uStatueC.z) / max(uRelief, 1e-3) * 0.4);
          // Loose dust: faint, dimmer the deeper it is.
          float deep = clamp(-P.z / (uUnit * 2.5), 0.0, 1.0);
          // Most specks are faint; a few catch the light and twinkle.
          float glint = 0.18 + 1.2 * pow(h1(aRef + 5.0), 8.0) * (0.6 + 0.4 * sin(uTime * (1.0 + 3.0 * h2(aRef + 5.0)) + h3(aRef) * 6.28));
          vec3 dust = (uMode == 1 ? uTint * 0.5 : uMode == 2 ? vec3(0.5, 0.12, 0.05) : vec3(0.45, 0.55, 0.7)) * (0.6 - 0.4 * deep) * glint;
          vColour = mix(dust, you, P.w);
          float size = uDot * mix(0.7, 1.0, P.w);
          if (isSpark(aRef)) {
            vec4 s = sparkSlot(aRef);
            float life = 1.0 - s.w / max(uTrailLife, 1e-3);
            if (life > 0.0) {
              vColour = mix(vColour, mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.95, 0.75), life) * 3.0, smoothstep(0.0, 0.2, life));
              size *= 1.0 + 1.5 * life;
            }
          }
          vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 1e-3), 1.0, 48.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColour;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          // A little roundness, like a grain catching light from the front.
          gl_FragColor = vec4(vColour * (0.75 + 0.35 * (1.0 - r2)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const points = new THREE.Points(pointGeometry, pointMaterial);
  points.frustumCulled = false;
  group.add(points);

  // A soft glow where each hand is, so you can see what you're touching.
  const markerPositions = new Float32Array(HANDS * 3);
  const markerInfo = new Float32Array(HANDS * 2); // pose, visible
  const markerGeometry = keep(new THREE.BufferGeometry());
  markerGeometry.setAttribute("position", new THREE.BufferAttribute(markerPositions, 3).setUsage(THREE.DynamicDrawUsage));
  markerGeometry.setAttribute("aInfo", new THREE.BufferAttribute(markerInfo, 2).setUsage(THREE.DynamicDrawUsage));
  const markerMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: { uSizePx: { value: 60 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uSizePx;
        attribute vec2 aInfo;
        varying vec2 vInfo;
        void main() {
          vInfo = aInfo;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aInfo.y > 0.5 ? uSizePx : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vInfo;
        void main() {
          float r = length(gl_PointCoord * 2.0 - 1.0);
          if (r > 1.0) discard;
          // Palm: a cool ring; fist: a hot core; point: a small bright spark.
          vec3 col = vInfo.x > 2.5 ? vec3(1.0, 0.45, 0.15) : vInfo.x > 1.5 ? vec3(1.0, 0.9, 0.6) : vec3(0.5, 0.8, 1.0);
          float a = vInfo.x > 1.5 ? exp(-r * r * 6.0) : smoothstep(0.08, 0.0, abs(r - 0.8)) * 0.8 + exp(-r * r * 12.0) * 0.15;
          gl_FragColor = vec4(col * a * 0.6, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const markers = new THREE.Points(markerGeometry, markerMaterial);
  markers.frustumCulled = false;
  markers.renderOrder = 2;
  group.add(markers);

  // ---------- The mouse: drag to push, Shift-drag or right-drag to pull ----------
  let pointer: { x: number; y: number; pull: boolean } | null = null;
  const toWindow = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width - 0.5) * winW, y: (0.5 - (e.clientY - rect.top) / rect.height) * winH };
  };
  const onDown = (e: PointerEvent) => {
    if (e.target !== canvas) return;
    pointer = { ...toWindow(e), pull: e.button === 2 || e.shiftKey };
  };
  const onMove = (e: PointerEvent) => {
    if (pointer) Object.assign(pointer, toWindow(e));
  };
  const onUp = () => (pointer = null);
  const onMenu = (e: Event) => {
    if (e.target === canvas) e.preventDefault();
  };
  window.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("contextmenu", onMenu);

  // ---------- Per-frame state ----------
  let lastTime = -1;
  let clock = 0;
  let reset = true;
  let person = 0;
  let motion = 0;
  const lastViewer = new THREE.Vector3();
  let hadViewer = false;
  let shatterAt = -1e9;
  let shatterQueued = false;
  let nextAutoShatter = -1;
  let trailHead = 0;
  let lastTrailAt = 0;
  /** What each hand slot did last frame, to notice a fist opening. */
  const lastPose: number[] = new Array(HANDS).fill(POSE.none);
  const lastHandPos = Array.from({ length: HANDS }, () => new THREE.Vector3());
  const handPos = new THREE.Vector3();

  const syncPictureTextures = (cut: Cutout) => {
    if (cut.version === cutVersion) return;
    cutVersion = cut.version;
    if (!imageTexture || imageTexture.image !== cut.image) {
      imageTexture?.dispose();
      imageTexture = new THREE.CanvasTexture(cut.image);
      imageTexture.colorSpace = THREE.SRGBColorSpace;
      shared.uImage.value = imageTexture;
    }
    imageTexture.needsUpdate = true;
    if (!maskTexture || maskTexture.image.width !== cut.maskWidth || maskTexture.image.height !== cut.maskHeight) {
      maskTexture?.dispose();
      maskTexture = new THREE.DataTexture(cut.mask, cut.maskWidth, cut.maskHeight, THREE.RedFormat, THREE.UnsignedByteType);
      maskTexture.minFilter = THREE.LinearFilter;
      maskTexture.magFilter = THREE.LinearFilter;
      maskTexture.unpackAlignment = 1;
      shared.uMask.value = maskTexture;
    }
    maskTexture.image.data = cut.mask;
    maskTexture.needsUpdate = true;
  };

  /** A point of the picture (0..1, y up) as seen on your figure, a little in front of it like a real hand. */
  const onStatue = (mx: number, my: number, out: THREE.Vector3) =>
    out.set(statueC.x + (mx - 0.5) * statueSize.x, statueC.y + (my - 0.5) * statueSize.y, statueC.z + shared.uRelief.value * 1.2);

  const room: ParticleRoom = {
    group,
    // Grains thrown out of the glass would fill the view as blurry blobs.
    clipAtWindow: true,
    background: new THREE.Color(0x020306),
    shatter() {
      shatterQueued = true;
    },
    update(timeS, eye, viewer) {
      const dt = lastTime < 0 ? 0 : Math.min(1 / 30, Math.max(0, timeS - lastTime));
      lastTime = timeS;
      // The room's own clock only moves forwards, so a shatter can never get stuck.
      clock += dt;

      // The figure: standing `partDepth` behind the glass, big enough to fill the view from the usual distance.
      const depth = settings.partDepth * unit;
      const grow = (1 + settings.partDepth / VIEW_DISTANCE) * settings.partSize;
      statueC.set(0, 0, -depth);
      statueSize.set(winW * grow, winH * grow);
      shared.uRelief.value = settings.partRelief * 0.35 * unit;
      shared.uTime.value = timeS;
      shared.uTrailLife.value = Math.max(0.001, settings.partTrail * 1.5);
      simCommon.uRestDepth.value = restDepth();

      // The person: their mask and picture, eased in and out as they come and go.
      const seen = cutout();
      if (seen && seen.cut.version > 0 && seen.cut.maskWidth > 0) {
        syncPictureTextures(seen.cut);
        const ia = seen.cut.image.width / Math.max(1, seen.cut.image.height);
        if (ia > aspect) videoScale.set(aspect / ia, 1);
        else videoScale.set(1, ia / aspect);
      }
      const present = seen?.fresh ? 1 : 0;
      person += (present - person) * (1 - Math.exp(-dt * (present ? 3 : 1.5)));
      shared.uPerson.value = person;

      // Moving fast loosens the figure, so it smears and trails behind you.
      if (viewer && hadViewer && dt > 0) {
        const speed = viewer.distanceTo(lastViewer) / dt;
        motion += (Math.min(1, speed / 0.6) - motion) * (1 - Math.exp(-dt * (speed / 0.6 > motion ? 8 : 1.5)));
      } else {
        motion *= Math.exp(-dt * 1.5);
      }
      hadViewer = !!viewer;
      if (viewer) lastViewer.copy(viewer);
      const solid = settings.partSolid;
      velMaterial.uniforms.uK.value = (3 + 60 * solid * solid) * (1 - 0.85 * motion * settings.partSmear);
      velMaterial.uniforms.uNoise.value = (1 - solid) * 0.9 * (0.2 + settings.partDust) + 0.03;

      // Shattering: on request, or every so often.
      if (settings.partShatterEvery > 0) {
        if (nextAutoShatter < 0) nextAutoShatter = clock + settings.partShatterEvery;
        if (clock >= nextAutoShatter && person > 0.5) {
          shatterQueued = true;
        }
      } else {
        nextAutoShatter = -1;
      }
      let kick = 0;
      if (shatterQueued) {
        shatterQueued = false;
        shatterAt = clock;
        kick = 1;
        if (settings.partShatterEvery > 0) nextAutoShatter = clock + settings.partShatterEvery;
      }
      const since = clock - shatterAt;
      const hold = since < SHATTER_HOLD ? 1 : Math.max(0, 1 - (since - SHATTER_HOLD) / SHATTER_RETURN);
      velMaterial.uniforms.uHold.value = hold * hold;
      velMaterial.uniforms.uKick.value = kick;

      // Hands and the mouse.
      const handR = 0.3 * unit * grow * settings.partHandSize;
      velMaterial.uniforms.uHandR.value = handR;
      velMaterial.uniforms.uForce.value = settings.partHandForce;
      const now = performance.now();
      const handList = now - hands.seenAt < 300 ? hands.hands.slice(0, 2) : [];
      for (let i = 0; i < HANDS; i++) {
        let pose: number = POSE.none;
        if (i < 2 && handList[i]) {
          const hand = handList[i];
          onStatue(0.5 + (1 - hand.x - 0.5) / videoScale.x, 0.5 + (1 - hand.y - 0.5) / videoScale.y, handPos);
          pose = POSE[hand.pose];
        } else if (i === 2 && pointer) {
          // The mouse acts where it points from the eye, at the figure's depth.
          const e = eye ?? new THREE.Vector3(0, 0, VIEW_DISTANCE * unit);
          const zt = statueC.z + shared.uRelief.value;
          const t = (e.z - zt) / Math.max(1e-4, e.z);
          handPos.set(e.x + (pointer.x - e.x) * t, e.y + (pointer.y - e.y) * t, zt);
          pose = pointer.pull ? POSE.fist : POSE.palm;
        }
        // Light smoothing against jitter.
        if (pose !== POSE.none && lastPose[i] !== POSE.none) handPos.lerp(lastHandPos[i], 0.35);
        handUniform[i].set(handPos.x, handPos.y, handPos.z, pose);
        // A fist that opens (or a hand that vanishes mid-fist) bursts.
        const burst = lastPose[i] === POSE.fist && pose !== POSE.fist;
        burstUniform[i].set(lastHandPos[i].x, lastHandPos[i].y, lastHandPos[i].z, burst ? 1 : 0);
        if (pose === POSE.point && settings.partTrail > 0 && now - lastTrailAt > 12) {
          trail[trailHead].set(handPos.x, handPos.y, handPos.z, 0);
          trailHead = (trailHead + 1) % TRAIL;
          lastTrailAt = now;
        }
        lastPose[i] = pose;
        if (pose !== POSE.none) lastHandPos[i].copy(handPos);
        markerPositions.set([handPos.x, handPos.y, handPos.z], i * 3);
        markerInfo.set([pose, pose !== POSE.none && settings.partShowHands ? 1 : 0], i * 2);
      }
      for (const t of trail) t.w += dt;
      markerGeometry.attributes.position.needsUpdate = true;
      markerGeometry.attributes.aInfo.needsUpdate = true;

      // Step the simulation: velocities first, then positions with the new velocities.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      pointUniforms.uViewH.value = buffer.y;
      markerMaterial.uniforms.uSizePx.value = buffer.y * 0.09;
      pointUniforms.uDot.value = (statueSize.y / side) * 2.2 * settings.partDot;
      pointUniforms.uMode.value = Math.max(0, PARTICLE_COLOUR_MODES.findIndex((c) => c.id === settings.partColourMode));
      tint.set(settings.partTint);

      simCommon.uDt.value = dt;
      simCommon.uReset.value = reset ? 1 : 0;
      reset = false;
      const previous = renderer.getRenderTarget();
      velMaterial.uniforms.uPos.value = posRead.texture;
      velMaterial.uniforms.uVel.value = velRead.texture;
      simQuad.material = velMaterial;
      renderer.setRenderTarget(velWrite);
      renderer.render(simScene, simCamera);
      posMaterial.uniforms.uPos.value = posRead.texture;
      posMaterial.uniforms.uNewVel.value = velWrite.texture;
      simQuad.material = posMaterial;
      renderer.setRenderTarget(posWrite);
      renderer.render(simScene, simCamera);
      renderer.setRenderTarget(previous);
      [posRead, posWrite] = [posWrite, posRead];
      [velRead, velWrite] = [velWrite, velRead];
      pointUniforms.uPos.value = posRead.texture;
    },
    dispose() {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("contextmenu", onMenu);
      maskTexture?.dispose();
      imageTexture?.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
  return room;
}
