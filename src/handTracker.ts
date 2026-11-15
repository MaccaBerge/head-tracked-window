import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Indices into the 21-point hand.
const WRIST = 0;
const TIPS = [8, 12, 16, 20]; // index, middle, ring, little finger
const KNUCKLES = [6, 10, 14, 18]; // the middle joint of each of those fingers
const PALM = [0, 5, 9, 17];
const MIDDLE_BASE = 9;

/** What a hand is doing: an open palm, a pointing finger or a fist. */
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
 * The viewer's hands and what they're doing. The hand model runs in the
 * tracking worker alongside the pose model (see trackerWorker.ts), only while
 * `enabled` (it costs time); the head tracker fills this in with its results.
 */
export class HandTracker {
  enabled = false;
  hands: Hand[] = [];
  /** Time the hands were last updated. */
  seenAt = 0;
  status: "off" | "loading" | "ready" | "failed" = "off";

  /** Call once per rendered frame. */
  update(_now: number): void {
    if (!this.enabled) this.hands = [];
  }
}

/** Works out a hand's pose and where it acts, from the hand model's 21 landmarks. */
export function describeHand(lm: NormalizedLandmark[], aspect: number, side: string): Hand {
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
