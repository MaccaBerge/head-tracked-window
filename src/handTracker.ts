// Types only: the MediaPipe library is loaded the first time hands are needed.
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Indices into the 21-point hand.
const WRIST = 0;
const TIPS = [8, 12, 16, 20]; // index, middle, ring, little finger
const KNUCKLES = [6, 10, 14, 18]; // the middle joint of each of those fingers
const PALM = [0, 5, 9, 17];
const MIDDLE_BASE = 9;

/** What a hand is doing: an open palm wipes wide, a pointing finger draws, a fist does nothing. */
export type HandPose = "palm" | "point" | "fist";

export interface Hand {
  /** Where it acts, in webcam image coordinates (0..1, as the camera sees it, not mirrored). */
  x: number;
  y: number;
  pose: HandPose;
  /** Size of the hand in the image: wrist to the base of the middle finger, as a share of the image height. */
  size: number;
  /** Which hand, as the model labels it. */
  side: string;
}

/**
 * Finds the viewer's hands in the webcam image and what they're doing.
 * Runs on the head tracker's video, only while `enabled` (it costs time).
 */
export class HandTracker {
  enabled = false;
  hands: Hand[] = [];
  /** Time the hands were last updated. */
  seenAt = 0;
  status: "off" | "loading" | "ready" | "failed" = "off";
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;

  constructor(private video: HTMLVideoElement) {}

  private async load(): Promise<void> {
    this.status = "loading";
    try {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.status = "ready";
    } catch {
      this.status = "failed";
    }
  }

  /** Call once per rendered frame. */
  update(now: number): void {
    if (!this.enabled) {
      this.hands = [];
      return;
    }
    if (this.video.readyState < 2) return;
    if (this.status === "off") void this.load();
    if (!this.landmarker) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const result = this.landmarker.detectForVideo(this.video, now);
    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
    this.hands = result.landmarks.map((lm, i) => describe(lm, aspect, result.handedness[i]?.[0]?.categoryName ?? ""));
    this.seenAt = now;
  }
}

function describe(lm: NormalizedLandmark[], aspect: number, side: string): Hand {
  // Distances measured with x stretched to the image's shape, so they're fair in both directions.
  const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const wrist = lm[WRIST];
  // A finger is straight when its tip is well beyond its middle joint, seen from the wrist.
  const straight = TIPS.map((tip, i) => dist(wrist, lm[tip]) > dist(wrist, lm[KNUCKLES[i]]) * 1.2);
  const others = straight.slice(1).filter(Boolean).length;
  const pose: HandPose = straight[0] && others <= 1 ? "point" : others >= 2 ? "palm" : "fist";
  let x = 0;
  let y = 0;
  if (pose === "point") {
    x = lm[TIPS[0]].x;
    y = lm[TIPS[0]].y;
  } else {
    for (const i of PALM) {
      x += lm[i].x / PALM.length;
      y += lm[i].y / PALM.length;
    }
  }
  return { x, y, pose, size: dist(wrist, lm[MIDDLE_BASE]), side };
}
