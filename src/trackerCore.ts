// Runs inside the tracking worker (trackerWorker.ts): no page, no DOM.
// The MediaPipe library is loaded when the worker starts.
import type {
  HandLandmarker,
  ImageSegmenter,
  Landmark,
  MPMask,
  NormalizedLandmark,
  PoseLandmarker,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { BodyGate } from "./bodyGate";
import { describeHand, type Hand } from "./handTracker";
import { MaskCleaner } from "./maskCleaner";
import { OneEuroFilter } from "./oneEuro";
import type { CutoutModel, FrameOptions, FrameResult, PersonDebug } from "./trackerMessages";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
/**
 * A model made for cutting people out. It labels each pixel as background,
 * hair, body skin, face skin, clothes or accessories, and is much cleaner
 * than the mask the pose model gives as a side product.
 */
const SEGMENTER_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

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

type Fileset = Awaited<ReturnType<typeof import("@mediapipe/tasks-vision").FilesetResolver.forVisionTasks>>;
type ModelStatus = "off" | "loading" | "ready" | "failed";

/**
 * Finds one viewer's eye position in each webcam frame, using a body pose
 * model, and optionally cuts them out and finds their hands.
 *
 * A body model keeps hold of a person at living-room distances and when they
 * turn their head, where a face model would lose them. It also gives the rest
 * of the body (hands, shoulders) for interaction.
 *
 * Output is in "camera space", in metres: origin at the lens, +x to the
 * viewer's right, +y up, +z out of the screen towards the viewer.
 */
export class TrackerCore {
  private fileset: Fileset | null = null;
  private landmarker: PoseLandmarker | null = null;
  private segmenter: ImageSegmenter | null = null;
  private segmenterStatus: ModelStatus = "off";
  private hands: HandLandmarker | null = null;
  private handsStatus: ModelStatus = "off";
  /** Which model made the masks the cleaner is averaging, so switching starts afresh. */
  private maskSource: CutoutModel | null = null;
  /** Each MediaPipe task may draw in its own WebGL context; how to read masks from each. */
  private maskReaders = new Map<WebGL2RenderingContext, { fb: WebGLFramebuffer | null; read: MaskRead | null }>();
  private rawMask = new Uint8Array(0);
  private cleaner = new MaskCleaner();
  private gate = new BodyGate();
  private cutoutInfo = "waiting for a person";
  private cleanMs = 0;
  private segmentMs = 0;
  private lastSeen = 0;
  private lastDetect = 0;
  private lock: Candidate | null = null;
  private misses = 0;
  private fx = new OneEuroFilter(1.0, 12);
  private fy = new OneEuroFilter(1.0, 12);
  private fz = new OneEuroFilter(0.5, 3);
  private head: { x: number; y: number; z: number } | null = null;
  private body: FrameResult["body"] = null;
  /** The frame's mask, filled in by whichever model ran. */
  private mask: { data: Uint8Array; width: number; height: number } | null = null;
  private options!: FrameOptions;
  /** MediaPipe's Wasm module factory, kept so each model can be created (see `useLoader`). */
  private moduleFactory: unknown = null;
  private segmenterError = "";
  /** Models are created one after another, as each one takes the loader's factory off the global object. */
  private creating: Promise<unknown> = Promise.resolve();

  async init(wasmPath: string): Promise<void> {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    // The ES module build of the Wasm loader: a module worker can't load the classic one.
    this.fileset = await FilesetResolver.forVisionTasks(wasmPath, true);
    const fileset = this.fileset;
    this.landmarker = await this.create(() => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      // Two, so a second person is seen and can be deliberately ignored.
      numPoses: 2,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
      // A per-person mask of which pixels belong to them, for cutouts.
      outputSegmentationMasks: true,
    }));
  }

  /** Runs everything asked for on one frame. The frame is handed back with a new cutout, otherwise closed. */
  async process(frame: ImageBitmap, now: number, options: FrameOptions): Promise<FrameResult> {
    this.options = options;
    const w = frame.width;
    const h = frame.height;
    this.mask = null;
    let people: PersonDebug[] = [];
    let chosen: Candidate | null = null;
    let lockedLandmarks: NormalizedLandmark[] | null = null;
    let useSegmenter = false;

    if (this.landmarker) {
      // The callback form lets us read the masks without MediaPipe copying them first.
      this.landmarker.detectForVideo(frame, now, (result) => {
        ({ people, chosen } = this.pose(result, now, w, h));
        const c = chosen as Candidate | null;
        if (!c || !options.wantCutout) return;
        lockedLandmarks = c.landmarks;
        useSegmenter = options.cutoutModel === "segmenter" && this.segmenterStatus !== "failed";
        if (useSegmenter) return;
        // The pose model's own mask, one per person it found; it only lives until this callback ends.
        const mask = result.segmentationMasks?.[c.index];
        if (!mask) this.cutoutInfo = `model gave no mask (${result.segmentationMasks?.length ?? 0} masks)`;
        else this.capture(mask, false, c.landmarks, "pose");
      });
    }

    // The segmenter runs after the pose model has finished with this frame,
    // and cuts out whoever the skeleton says is the locked person.
    const lm = lockedLandmarks as NormalizedLandmark[] | null;
    if (lm && useSegmenter) {
      if (this.segmenterStatus === "off") void this.loadSegmenter();
      if (this.segmenter) {
        const t0 = performance.now();
        this.segmenter.segmentForVideo(frame, now, (result) => {
          // Confidence of "background": everything else (hair, skin, clothes, accessories) is the person.
          const background = result.confidenceMasks?.[0];
          if (!background) this.cutoutInfo = "segmenter gave no mask";
          else this.capture(background, true, lm, "segmenter");
        });
        const ms = performance.now() - t0;
        this.segmentMs = this.segmentMs ? this.segmentMs + 0.1 * (ms - this.segmentMs) : ms;
      } else {
        this.cutoutInfo = "loading the person segmenter";
      }
    }

    let hands: Hand[] | null = null;
    if (options.wantHands) {
      if (this.handsStatus === "off") void this.loadHands();
      if (this.hands) {
        const result = this.hands.detectForVideo(frame, now);
        hands = result.landmarks.map((l, i) => describeHand(l, w / h, result.handedness[i]?.[0]?.categoryName ?? ""));
      }
    }

    const gate = options.wantGate && this.mask && options.cutoutSkeleton ? await this.gate.snapshot() : null;
    const made = this.mask as { data: Uint8Array; width: number; height: number } | null;
    if (!made) frame.close();
    return {
      type: "result",
      now,
      status: this.lock ? "tracking" : "searching",
      head: this.head,
      people,
      body: this.body,
      lockRatio: this.lock?.ratio ?? null,
      seen: chosen !== null,
      cutout: made ? { frame, mask: made.data, width: made.width, height: made.height } : null,
      cutoutInfo: this.cutoutInfo,
      gate,
      hands,
      handsStatus: this.handsStatus,
    };
  }

  /** Picks the locked person out of everyone the pose model found and updates the eye position. */
  private pose(
    result: PoseLandmarkerResult,
    now: number,
    w: number,
    h: number,
  ): { people: PersonDebug[]; chosen: Candidate | null } {
    const candidates: Candidate[] = [];
    result.landmarks.forEach((lm, i) => {
      const world = result.worldLandmarks[i];
      const c = world && this.measure(lm, world, w, h, i);
      if (c) candidates.push(c);
    });

    const f = this.focalPx(w);
    const chosen = this.choose(candidates, now, f);
    const people = candidates.map((c) => ({
      u: c.px / w,
      v: c.py / h,
      shoulders: [
        c.landmarks[L_SHOULDER].x,
        c.landmarks[L_SHOULDER].y,
        c.landmarks[R_SHOULDER].x,
        c.landmarks[R_SHOULDER].y,
      ] as [number, number, number, number],
      locked: c === chosen,
    }));

    if (!chosen) {
      if (!this.lock) {
        this.head = null;
        this.body = null;
      }
      return { people, chosen };
    }

    const dt = this.lastDetect ? (now - this.lastDetect) / 1000 : 0;
    this.lastDetect = now;
    this.lastSeen = now;
    this.body = { landmarks: chosen.landmarks, world: chosen.world };
    const z = f * chosen.ratio;
    // The camera faces the viewer, so image-right is the viewer's left.
    const x = (-(chosen.px - w / 2) * z) / f;
    const y = (-(chosen.py - h / 2) * z) / f;
    this.head = {
      x: this.fx.filter(x, dt),
      y: this.fy.filter(y, dt),
      z: this.fz.filter(z, dt),
    };
    return { people, chosen };
  }

  /** Focal length of the webcam in pixels, from its horizontal field of view. */
  private focalPx(width: number): number {
    const hfov = (this.options.cameraHfovDeg * Math.PI) / 180;
    return width / 2 / Math.tan(hfov / 2);
  }

  /**
   * MediaPipe loads its Wasm loader for every model it creates and reads the
   * factory it leaves on the global object, then clears it. In a module
   * worker the loader is an ES module, which the browser runs only once, so
   * the second model would find nothing. We load it ourselves once and put
   * the factory back before each model is created.
   */
  private async useLoader(): Promise<void> {
    if (!this.fileset) return;
    if (!this.moduleFactory) {
      const loader = await import(/* @vite-ignore */ this.fileset.wasmLoaderPath);
      this.moduleFactory = loader.default;
    }
    (globalThis as { ModuleFactory?: unknown }).ModuleFactory = this.moduleFactory;
  }

  /** Creates a model once any model being created before it is done. */
  private create<T>(make: () => Promise<T>): Promise<T> {
    const next = this.creating.then(async () => {
      await this.useLoader();
      return make();
    });
    this.creating = next.catch(() => undefined);
    return next;
  }

  /** Loads the person segmenter the first time it's wanted. */
  private async loadSegmenter(): Promise<void> {
    if (!this.fileset) return;
    this.segmenterStatus = "loading";
    try {
      const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const fileset = this.fileset;
      this.segmenter = await this.create(() =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: SEGMENTER_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        }),
      );
      this.segmenterStatus = "ready";
    } catch (e) {
      this.segmenterStatus = "failed";
      this.segmenterError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Loads the hand model the first time hands are wanted. */
  private async loadHands(): Promise<void> {
    if (!this.fileset) return;
    this.handsStatus = "loading";
    try {
      const { HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = this.fileset;
      this.hands = await this.create(() =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
      );
      this.handsStatus = "ready";
    } catch {
      this.handsStatus = "failed";
    }
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

  /**
   * Turns a model's mask into the locked person's cleaned cutout mask.
   * @param invert The mask says where the person is not (the segmenter's background).
   */
  private capture(mask: MPMask, invert: boolean, lm: NormalizedLandmark[], source: CutoutModel): void {
    try {
      const n = mask.width * mask.height;
      if (this.rawMask.length !== n) this.rawMask = new Uint8Array(n);
      this.readMask(mask, this.rawMask);
      if (invert) for (let i = 0; i < n; i++) this.rawMask[i] = 255 - this.rawMask[i];

      // Averaging masks from two different models would blur them together.
      if (source !== this.maskSource) {
        this.maskSource = source;
        this.cleaner.reset();
      }

      const t0 = performance.now();
      // Nothing outside a body shape around the skeleton can be the person (see bodyGate.ts).
      if (this.options.cutoutSkeleton) {
        this.gate.draw(lm, mask.width, mask.height, this.options.cutoutFit);
        this.gate.apply(this.rawMask, mask.width, mask.height);
      }
      // Steady the outline and drop stray blobs (see maskCleaner.ts).
      this.cleaner.clean(this.rawMask, mask.width, mask.height);
      this.cleanMs = performance.now() - t0;
      // A copy: the cleaner reuses its buffer, and this one is handed to the page.
      const data = this.cleaner.output.slice();
      this.mask = { data, width: this.cleaner.width, height: this.cleaner.height };

      let inside = 0;
      for (let i = 0; i < data.length; i++) if (data[i] > 127) inside++;
      const share = (100 * inside) / Math.max(1, data.length);
      const model =
        source === "segmenter"
          ? `segmenter ${this.segmentMs.toFixed(0)} ms`
          : this.segmenterError
            ? `pose mask (segmenter failed: ${this.segmenterError})`
            : "pose mask";
      this.cutoutInfo = `${model}, ${share.toFixed(0)}% person, cleanup ${this.cleanMs.toFixed(1)} ms`;
    } catch (e) {
      this.cutoutInfo = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
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
    let reader = this.maskReaders.get(gl);
    if (!reader) {
      reader = { fb: gl.createFramebuffer(), read: null };
      this.maskReaders.set(gl, reader);
      gl.getExtension("EXT_color_buffer_float");
      gl.getExtension("EXT_color_buffer_half_float");
    }

    const texture = mask.getAsWebGLTexture();
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, reader.fb);
    try {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`mask texture can't be read (status ${status})`);

      // Try the format that worked last time first, then the candidates.
      const candidates: MaskRead[] = reader.read ? [reader.read] : maskReadCandidates(gl);
      for (const read of candidates) {
        gl.getError(); // clear any error left over from before
        const buffer = read.buffer(n * read.channels);
        gl.readPixels(0, 0, mask.width, mask.height, read.format, read.type, buffer);
        if (gl.getError() !== gl.NO_ERROR) continue;
        reader.read = read;
        read.toBytes(buffer, read.channels, out, n);
        return;
      }
      reader.read = null;
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
