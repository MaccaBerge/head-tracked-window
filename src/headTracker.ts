import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandTracker } from "./handTracker";
import { activeProfile, type Settings } from "./settings";
import type { FromWorker, FrameOptions, FrameResult, PersonDebug, ToWorker } from "./trackerMessages";

export { CUTOUT_MODELS, type CutoutModel, type PersonDebug } from "./trackerMessages";

/** "idle": the camera hasn't been started yet (it waits for a click unless access was already granted). */
export type TrackerStatus = "idle" | "loading" | "searching" | "tracking" | "no-camera";

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

/**
 * Finds one viewer's eye position with the webcam. The page side of the
 * tracker: it runs the camera and hands each new frame to the tracking
 * worker (trackerWorker.ts, trackerCore.ts), which does the actual work off
 * the main thread, so the room keeps drawing at the display's rate.
 *
 * Output is in "camera space", in metres: origin at the lens, +x to the
 * viewer's right, +y up, +z out of the screen towards the viewer.
 */
export class HeadTracker {
  readonly video = document.createElement("video");
  status: TrackerStatus = "idle";
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
  /** The body shape the last mask was clipped to, while it's shown over the preview. */
  gateImage: ImageBitmap | null = null;
  /** Webcam frames the worker finished per second, for the panel. */
  trackingFps = 0;

  private worker: Worker | null = null;
  /** A frame is with the worker; new ones are skipped until it answers. */
  private busy = false;
  private lastVideoTime = -1;
  private lockRatio: number | null = null;
  private cutoutCtx: CanvasRenderingContext2D | null = null;
  private fpsCount = 0;
  private fpsSince = 0;

  constructor(
    private settings: Settings,
    private hands: HandTracker,
  ) {
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<void> {
    // Already starting or running.
    if (this.status !== "idle" && this.status !== "no-camera") return;
    this.status = "loading";
    this.error = "";
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
    this.startWorker();
  }

  private startWorker(): void {
    this.worker?.terminate();
    const worker = new Worker(new URL("./trackerWorker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.busy = false;
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    worker.onerror = (event) => {
      this.status = "no-camera";
      this.error = `tracking worker: ${event.message || "failed to start"}`;
    };
    // An absolute address: the worker resolves paths against its own script, not the page.
    const wasmPath = new URL(`${import.meta.env.BASE_URL}mediapipe-wasm`, location.href).href;
    this.post({ type: "init", wasmPath });
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  /** Call once per rendered frame; sends the webcam's newest frame when the worker is free. */
  update(now: number): void {
    if (!this.worker || this.busy || (this.status !== "searching" && this.status !== "tracking")) return;
    if (this.video.readyState < 2 || !this.video.videoWidth) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.busy = true;
    const options: FrameOptions = {
      cameraHfovDeg: activeProfile(this.settings).cameraHfovDeg,
      wantCutout: this.wantCutout,
      cutoutModel: this.settings.cutoutModel,
      cutoutSkeleton: this.settings.cutoutSkeleton,
      cutoutFit: this.settings.cutoutFit,
      wantGate: this.wantCutout && this.settings.cutoutShowShape,
      wantHands: this.hands.enabled,
    };
    // A snapshot of this frame: the video moves on while the worker is busy.
    createImageBitmap(this.video).then(
      (frame) => this.post({ type: "frame", frame, now, options }, [frame]),
      () => (this.busy = false),
    );
  }

  private receive(message: FromWorker): void {
    if (message.type === "ready") {
      this.status = "searching";
      return;
    }
    if (message.type === "failed") {
      this.status = "no-camera";
      this.error = message.error;
      return;
    }
    this.busy = false;
    if (message.type === "skipped") {
      // Shown in the panel; tracking carries on with the next frame.
      this.status = "searching";
      this.error = `tracking: ${message.error}`;
      return;
    }
    this.error = "";
    this.apply(message);
  }

  private apply(r: FrameResult): void {
    this.fpsCount++;
    if (r.now - this.fpsSince >= 1000) {
      this.trackingFps = (this.fpsCount * 1000) / (r.now - this.fpsSince);
      this.fpsCount = 0;
      this.fpsSince = r.now;
    }
    this.status = r.status;
    this.head = r.head;
    this.people = r.people;
    this.body = r.body;
    this.lockRatio = r.lockRatio;
    if (r.seen) this.lastSeen = r.now;
    this.cutoutInfo = r.cutoutInfo;
    if (r.cutout) this.keepCutout(r.cutout);
    if (r.gate) {
      this.gateImage?.close();
      this.gateImage = r.gate;
    }
    if (r.hands) {
      this.hands.hands = r.hands;
      this.hands.seenAt = r.now;
    }
    this.hands.status = r.handsStatus;
  }

  /** Copies the frame the worker handed back into the cutout canvas, so picture and mask match exactly. */
  private keepCutout(c: NonNullable<FrameResult["cutout"]>): void {
    if (!this.cutout) {
      const image = document.createElement("canvas");
      this.cutoutCtx = image.getContext("2d");
      this.cutout = { image, mask: new Uint8Array(0), maskWidth: 0, maskHeight: 0, version: 0 };
    }
    const cut = this.cutout;
    if (cut.image.width !== c.frame.width || cut.image.height !== c.frame.height) {
      cut.image.width = c.frame.width;
      cut.image.height = c.frame.height;
    }
    this.cutoutCtx?.drawImage(c.frame, 0, 0);
    c.frame.close();
    cut.mask = c.mask;
    cut.maskWidth = c.width;
    cut.maskHeight = c.height;
    cut.version++;
  }

  /**
   * Solve the webcam's field of view from a known viewer distance.
   * Returns the new horizontal FOV in degrees, or null if nobody is tracked.
   */
  calibrateFov(trueDistanceM: number): number | null {
    if (this.status !== "tracking" || !this.lockRatio) return null;
    const f = trueDistanceM / this.lockRatio;
    const hfov = 2 * Math.atan(this.video.videoWidth / 2 / f);
    return (hfov * 180) / Math.PI;
  }
}
