// What the page and the tracking worker (trackerWorker.ts) say to each other.
import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Hand } from "./handTracker";

/** Where the person mask comes from. */
export type CutoutModel = "pose" | "segmenter";
export const CUTOUT_MODELS: { id: CutoutModel; name: string }[] = [
  { id: "segmenter", name: "Segmenter" },
  { id: "pose", name: "Pose mask" },
];

export interface PersonDebug {
  /** Normalised image coordinates (0..1) of the point between the eyes. */
  u: number;
  v: number;
  /** Normalised image coordinates of the two shoulders. */
  shoulders: [number, number, number, number];
  locked: boolean;
}

/** What the page wants done with each frame; read from the settings every frame. */
export interface FrameOptions {
  /** Horizontal field of view of the webcam, in degrees. */
  cameraHfovDeg: number;
  wantCutout: boolean;
  cutoutModel: CutoutModel;
  cutoutSkeleton: boolean;
  cutoutFit: number;
  /** Send back the body shape, for the preview. */
  wantGate: boolean;
  wantHands: boolean;
}

export type ToWorker =
  | { type: "init"; wasmPath: string }
  | { type: "frame"; frame: ImageBitmap; now: number; options: FrameOptions };

export interface FrameResult {
  type: "result";
  /** The page's clock when the frame was taken. */
  now: number;
  /** Someone is locked: "tracking"; nobody: "searching". */
  status: "searching" | "tracking";
  head: { x: number; y: number; z: number } | null;
  people: PersonDebug[];
  body: { landmarks: NormalizedLandmark[]; world: Landmark[] } | null;
  /** Metres per pixel of focal length for the locked person, for calibration. */
  lockRatio: number | null;
  /** Set when the locked person was seen in this frame. */
  seen: boolean;
  /** A new cutout: the frame handed back (so picture and mask match) and its mask. */
  cutout: { frame: ImageBitmap; mask: Uint8Array; width: number; height: number } | null;
  cutoutInfo: string;
  /** The body shape the mask was clipped to, when asked for. */
  gate: ImageBitmap | null;
  hands: Hand[] | null;
  handsStatus: "off" | "loading" | "ready" | "failed";
}

export type FromWorker =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | FrameResult;
