import {
  FilesetResolver,
  PoseLandmarker,
  type Landmark,
  type MPMask,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { MaskCleaner } from "./maskCleaner";
import { OneEuroFilter } from "./oneEuro";
import { activeProfile, type Settings } from "./settings";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

// Indices into the 33-point body pose.
const EYE_POINTS = [1, 2, 3, 4, 5, 6]; // inner, centre and outer of both eyes
const L_EYE_OUTER = 3;
const R_EYE_OUTER = 6;
const L_EAR = 7;
const R_EAR = 8;
const L_SHOULDER = 11;
const R_SHOULDER = 12;

/** Body parts of known real-world size, used to judge distance. */
const RULERS: [number, number][] = [
  [L_SHOULDER, R_SHOULDER],
  [L_EAR, R_EAR],
  [L_EYE_OUTER, R_EYE_OUTER],
];

/** How long the locked person may be missing before we lock onto someone else. */
const RELOCK_AFTER_MS = 1500;
/** Rough width of a head in metres, used to scale the "same person?" test. */
const HEAD_WIDTH_M = 0.16;

export type TrackerStatus = "loading" | "searching" | "tracking" | "no-camera";

export interface PersonDebug {
  /** Normalised image coordinates (0..1) of the point between the eyes. */
  u: number;
  v: number;
  /** Normalised image coordinates of the two shoulders. */
  shoulders: [number, number, number, number];
  locked: boolean;
}

/** The locked person cut out of the webcam image. */
export interface Cutout {
  /** The webcam frame the mask was made from. */
  image: HTMLCanvasElement;
  /** How much each pixel belongs to the person: 0 background, 255 person. Rows run top to bottom. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  /** Goes up by one every time a new frame is written. */
  version: number;
}

interface Candidate {
  /** Which of the model's detected poses this is. */
  index: number;
  /** Video-pixel coordinates of the point between the eyes. */
  px: number;
  py: number;
  /** Metres of distance per pixel of focal length: distance = focal * ratio. */
  ratio: number;
  landmarks: NormalizedLandmark[];
  world: Landmark[];
}

/**
 * Finds one viewer's eye position with the webcam, using a body pose model.
 *
 * A body model keeps hold of a person at living-room distances and when they
 * turn their head, where a face model would lose them. It also gives the rest
 * of the body (hands, shoulders) for interaction later.
 *
 * Output is in "camera space", in metres: origin at the lens, +x to the
 * viewer's right, +y up, +z out of the screen towards the viewer.
 */
export class HeadTracker {
  readonly video = document.createElement("video");
  status: TrackerStatus = "loading";
  error = "";
  /** Filtered eye position, or null while nobody is locked. */
  head: { x: number; y: number; z: number } | null = null;
  /** Everyone seen in the last frame (for the preview). */
  people: PersonDebug[] = [];
  /** Full body pose of the locked viewer: image landmarks and metric 3D landmarks. */
  body: { landmarks: NormalizedLandmark[]; world: Landmark[] } | null = null;
  /** Time of the last frame in which the locked person was seen. */
  lastSeen = 0;
  /** Set to true to have the locked person cut out of each frame (costs a little time). */
  wantCutout = false;
  /** Latest cutout of the locked person, while `wantCutout` is on. */
  cutout: Cutout | null = null;
  /** What the cutout is doing, for the panel. */
  cutoutInfo = "waiting for a person";

  private landmarker: PoseLandmarker | null = null;
  private cutoutCtx: CanvasRenderingContext2D | null = null;
  private maskGl: WebGL2RenderingContext | null = null;
  private maskFb: WebGLFramebuffer | null = null;
  private maskRead: MaskRead | null = null;
  private rawMask = new Uint8Array(0);
  private cleaner = new MaskCleaner();
  /** How long the last cleanup took, in milliseconds. */
  cleanMs = 0;
  private lastVideoTime = -1;
  private lastDetect = 0;
  private lock: Candidate | null = null;
  private misses = 0;
  private fx = new OneEuroFilter(1.0, 12);
  private fy = new OneEuroFilter(1.0, 12);
  private fz = new OneEuroFilter(0.5, 3);

  constructor(private settings: Settings) {
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
    } catch (e) {
      this.status = "no-camera";
      this.error = e instanceof Error ? e.message : String(e);
      return;
    }
    try {
      const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        // Two, so a second person is seen and can be deliberately ignored.
        numPoses: 2,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        // A per-person mask of which pixels belong to them, for cutouts.
        outputSegmentationMasks: true,
      });
      this.status = "searching";
    } catch (e) {
      this.status = "no-camera";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Focal length of the webcam in pixels, from its horizontal field of view. */
  private focalPx(): number {
    const hfov = (activeProfile(this.settings).cameraHfovDeg * Math.PI) / 180;
    return this.video.videoWidth / 2 / Math.tan(hfov / 2);
  }

  /** Call once per rendered frame; runs detection only when the webcam has a new frame. */
  update(now: number): void {
    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return;

    // The callback form runs straight away and lets us read the masks
    // without MediaPipe copying them first.
    this.landmarker.detectForVideo(this.video, now, (result) => this.process(result, now, w, h));
  }

  private process(result: PoseLandmarkerResult, now: number, w: number, h: number): void {
    const candidates: Candidate[] = [];
    result.landmarks.forEach((lm, i) => {
      const world = result.worldLandmarks[i];
      const c = world && this.measure(lm, world, w, h, i);
      if (c) candidates.push(c);
    });

    const f = this.focalPx();
    const chosen = this.choose(candidates, now, f);
    this.people = candidates.map((c) => ({
      u: c.px / w,
      v: c.py / h,
      shoulders: [
        c.landmarks[L_SHOULDER].x,
        c.landmarks[L_SHOULDER].y,
        c.landmarks[R_SHOULDER].x,
        c.landmarks[R_SHOULDER].y,
      ],
      locked: c === chosen,
    }));

    if (!chosen) {
      if (!this.lock) {
        this.status = "searching";
        this.head = null;
        this.body = null;
      }
      return;
    }

    const dt = this.lastDetect ? (now - this.lastDetect) / 1000 : 0;
    this.lastDetect = now;
    this.lastSeen = now;
    this.status = "tracking";
    this.body = { landmarks: chosen.landmarks, world: chosen.world };
    if (this.wantCutout) {
      const mask = result.segmentationMasks?.[chosen.index];
      if (!mask) {
        this.cutoutInfo = `model gave no mask (${result.segmentationMasks?.length ?? 0} masks)`;
      } else {
        try {
          this.captureCutout(mask);
        } catch (e) {
          this.cutoutInfo = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    const z = f * chosen.ratio;
    // The camera faces the viewer, so image-right is the viewer's left.
    const x = (-(chosen.px - w / 2) * z) / f;
    const y = (-(chosen.py - h / 2) * z) / f;
    this.head = {
      x: this.fx.filter(x, dt),
      y: this.fy.filter(y, dt),
      z: this.fz.filter(z, dt),
    };
  }

  /**
   * Turns one detected body into an eye position and a distance measure.
   *
   * Distance comes from "rulers": the model reports each body part both in
   * image pixels and in real metres, so (metres across) / (pixels across)
   * gives distance per unit of focal length. Shoulders, ears and eyes are
   * blended, weighted by how visible and how large on screen each one is, so
   * the estimate stays steady when one of them leaves the frame.
   */
  private measure(
    lm: NormalizedLandmark[],
    world: Landmark[],
    w: number,
    h: number,
    index: number,
  ): Candidate | null {
    let px = 0;
    let py = 0;
    for (const i of EYE_POINTS) {
      px += lm[i].x * w;
      py += lm[i].y * h;
    }
    px /= EYE_POINTS.length;
    py /= EYE_POINTS.length;

    let ratioSum = 0;
    let weightSum = 0;
    for (const [a, b] of RULERS) {
      const pixels = Math.hypot((lm[a].x - lm[b].x) * w, (lm[a].y - lm[b].y) * h);
      // Only the part of the real-world span that lies across the image
      // counts; this keeps the estimate right when the body is turned.
      const metres = Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y);
      if (pixels < 3 || metres < 0.01) continue;
      const vis = Math.min(lm[a].visibility ?? 1, lm[b].visibility ?? 1);
      const weight = vis * vis * pixels;
      ratioSum += weight * (metres / pixels);
      weightSum += weight;
    }
    if (weightSum < 1e-3) return null;
    return { index, px, py, ratio: ratioSum / weightSum, landmarks: lm, world };
  }

  /** Keeps a copy of this webcam frame and the locked person's mask over it. */
  private captureCutout(mask: MPMask): void {
    if (!this.cutout) {
      const image = document.createElement("canvas");
      this.cutoutCtx = image.getContext("2d");
      this.cutout = { image, mask: new Uint8Array(0), maskWidth: 0, maskHeight: 0, version: 0 };
    }
    const c = this.cutout;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (c.image.width !== vw || c.image.height !== vh) {
      c.image.width = vw;
      c.image.height = vh;
    }
    // The image is copied now, so it matches the mask exactly even though
    // the video moves on to its next frame before this one is drawn.
    this.cutoutCtx?.drawImage(this.video, 0, 0, vw, vh);

    const n = mask.width * mask.height;
    if (this.rawMask.length !== n) this.rawMask = new Uint8Array(n);
    this.readMask(mask, this.rawMask);

    // Steady the outline and drop stray blobs (see maskCleaner.ts).
    const t0 = performance.now();
    this.cleaner.clean(this.rawMask, mask.width, mask.height);
    this.cleanMs = performance.now() - t0;
    c.mask = this.cleaner.output;
    c.maskWidth = this.cleaner.width;
    c.maskHeight = this.cleaner.height;
    c.version++;

    let inside = 0;
    for (let i = 0; i < c.mask.length; i++) if (c.mask[i] > 127) inside++;
    const share = (100 * inside) / Math.max(1, c.mask.length);
    this.cutoutInfo = `${share.toFixed(0)}% person, cleanup ${this.cleanMs.toFixed(1)} ms`;
  }

  /**
   * Copies a mask into `out` as bytes (0 to 255).
   *
   * With the GPU delegate the mask lives in a WebGL texture. MediaPipe's own
   * getAsFloat32Array() assumes a float texture, and when the browser stored
   * it some other way the read is refused and the mask comes back all zeros.
   * Instead we ask WebGL which formats it will read this texture in, and use
   * one of those.
   */
  private readMask(mask: MPMask, out: Uint8Array): void {
    const n = mask.width * mask.height;
    if (mask.hasFloat32Array() || !mask.hasWebGLTexture() || !mask.canvas) {
      const data = mask.getAsFloat32Array();
      for (let i = 0; i < n; i++) out[i] = data[i] * 255;
      return;
    }
    const gl = mask.canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) throw new Error("no WebGL2 context for the mask");
    if (gl !== this.maskGl) {
      this.maskGl = gl;
      this.maskFb = gl.createFramebuffer();
      this.maskRead = null;
      gl.getExtension("EXT_color_buffer_float");
      gl.getExtension("EXT_color_buffer_half_float");
    }

    const texture = mask.getAsWebGLTexture();
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb);
    try {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`mask texture can't be read (status ${status})`);

      // Try the format that worked last time first, then the candidates.
      const candidates: MaskRead[] = this.maskRead ? [this.maskRead] : maskReadCandidates(gl);
      for (const read of candidates) {
        gl.getError(); // clear any error left over from before
        const buffer = read.buffer(n * read.channels);
        gl.readPixels(0, 0, mask.width, mask.height, read.format, read.type, buffer);
        if (gl.getError() !== gl.NO_ERROR) continue;
        this.maskRead = read;
        read.toBytes(buffer, read.channels, out, n);
        return;
      }
      this.maskRead = null;
      throw new Error(
        `no readable format (texture reads as format ${gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)}, ` +
          `type ${gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)})`,
      );
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    }
  }

  /**
   * Sticky lock: keep following the same person by continuity of position.
   * Other people are ignored until the locked person has been gone for a
   * while; then the closest person in view is picked up.
   */
  private choose(candidates: Candidate[], now: number, f: number): Candidate | null {
    if (this.lock) {
      let best: Candidate | null = null;
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = Math.hypot(c.px - this.lock.px, c.py - this.lock.py);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      // Same person if they have not jumped further than a few head-widths.
      const headPx = HEAD_WIDTH_M / this.lock.ratio;
      if (best && bestDist < 2.5 * headPx * (1 + this.misses)) {
        this.lock = best;
        this.misses = 0;
        return best;
      }
      this.misses++;
      if (now - this.lastSeen < RELOCK_AFTER_MS) return null;
      this.lock = null;
      this.misses = 0;
    }

    let closest: Candidate | null = null;
    for (const c of candidates) {
      if (!closest || f * c.ratio < f * closest.ratio) closest = c;
    }
    if (closest) {
      this.lock = closest;
      this.misses = 0;
      this.cleaner.reset();
      this.fx.reset();
      this.fy.reset();
      this.fz.reset();
      this.lastDetect = 0;
    }
    return closest;
  }

  /**
   * Solve the webcam's field of view from a known viewer distance.
   * Returns the new horizontal FOV in degrees, or null if nobody is tracked.
   */
  calibrateFov(trueDistanceM: number): number | null {
    if (this.status !== "tracking" || !this.lock) return null;
    const f = trueDistanceM / this.lock.ratio;
    const hfov = 2 * Math.atan(this.video.videoWidth / 2 / f);
    return (hfov * 180) / Math.PI;
  }
}

/** One way of reading a texture back from WebGL. */
interface MaskRead {
  format: number;
  type: number;
  channels: number;
  /** A (reused) buffer of the right type and length. */
  buffer(length: number): ArrayBufferView;
  /** Converts the first channel of what was read to bytes 0..255. */
  toBytes(src: ArrayBufferView, channels: number, out: Uint8Array, n: number): void;
}

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 0x8000 ? -v : v;
}

function reader(
  format: number,
  type: number,
  channels: number,
  make: (length: number) => Float32Array | Uint8Array | Uint16Array,
  scale: (v: number) => number,
): MaskRead {
  let buf: Float32Array | Uint8Array | Uint16Array | null = null;
  return {
    format,
    type,
    channels,
    buffer(length) {
      if (!buf || buf.length !== length) buf = make(length);
      return buf;
    },
    toBytes(src, ch, out, n) {
      const a = src as Float32Array | Uint8Array | Uint16Array;
      for (let i = 0; i < n; i++) out[i] = Math.min(255, Math.max(0, scale(a[i * ch])));
    },
  };
}

/** Ways to read a mask texture, most likely to work first. */
function maskReadCandidates(gl: WebGL2RenderingContext): MaskRead[] {
  const channelsOf = (format: number) =>
    format === gl.RED ? 1 : format === gl.RG ? 2 : format === gl.RGB ? 3 : 4;
  const forType = (format: number, type: number): MaskRead | null => {
    const ch = channelsOf(format);
    if (type === gl.FLOAT) return reader(format, type, ch, (l) => new Float32Array(l), (v) => v * 255);
    if (type === gl.UNSIGNED_BYTE) return reader(format, type, ch, (l) => new Uint8Array(l), (v) => v);
    if (type === gl.HALF_FLOAT) return reader(format, type, ch, (l) => new Uint16Array(l), (v) => halfToFloat(v) * 255);
    return null;
  };
  const list: MaskRead[] = [];
  // The pair the browser says it prefers for this texture.
  const preferred = forType(
    gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number,
    gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number,
  );
  if (preferred) list.push(preferred);
  // The pairs WebGL2 always allows: floats for float textures, bytes for byte textures.
  list.push(forType(gl.RGBA, gl.FLOAT)!, forType(gl.RGBA, gl.UNSIGNED_BYTE)!);
  return list;
}
