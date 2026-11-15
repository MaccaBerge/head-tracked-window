import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Indices into the 33-point body pose.
const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_PINKY = 17;
const R_PINKY = 18;
const L_INDEX = 19;
const R_INDEX = 20;
const L_THUMB = 21;
const R_THUMB = 22;
const L_HIP = 23;
const R_HIP = 24;
const L_KNEE = 25;
const R_KNEE = 26;
const L_ANKLE = 27;
const R_ANKLE = 28;
const L_HEEL = 29;
const R_HEEL = 30;
const L_FOOT = 31;
const R_FOOT = 32;

/** The gate is drawn at this fraction of the mask's resolution: plenty for a soft body shape. */
const SCALE = 0.25;

/**
 * A rough body shape drawn around the tracked person's skeleton, used to clip
 * the person mask. Segmentation models sometimes count a chair, a sofa or a
 * patch of wall next to you as "person"; anything outside this shape can't be
 * you, so it's dropped before the mask is cleaned up.
 *
 * The shape is generous (rounded bands along the limbs, a filled torso and a
 * head big enough for hair), sized by the width of your shoulders, so it
 * follows you at any distance. `fit` makes it wider or tighter.
 */
export class BodyGate {
  /** The last shape drawn, white where you may be, in webcam image coordinates. An offscreen canvas, as this runs in the tracking worker. */
  readonly canvas = new OffscreenCanvas(16, 16);
  private ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private columns = new Int32Array(0);
  private rows = new Int32Array(0);
  private mapFor = "";

  /** Draws the body shape for these landmarks, for a mask of the given size. */
  draw(lm: NormalizedLandmark[], maskWidth: number, maskHeight: number, fit: number): void {
    const gw = Math.max(16, Math.round(maskWidth * SCALE));
    const gh = Math.max(16, Math.round(maskHeight * SCALE));
    if (this.canvas.width !== gw || this.canvas.height !== gh) {
      this.canvas.width = gw;
      this.canvas.height = gh;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, gw, gh);

    type P = [number, number];
    const at = (i: number): P => [lm[i].x * gw, lm[i].y * gh];
    const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // A point beyond b, continuing the line from a.
    const beyond = (a: P, b: P, k: number): P => [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k];

    const shoulders = mid(at(L_SHOULDER), at(R_SHOULDER));
    const hips = mid(at(L_HIP), at(R_HIP));
    const ears = mid(at(L_EAR), at(R_EAR));
    // The body's scale: shoulder width, unless you're turned sideways and it
    // shrinks, when the ears and torso length take over.
    const s = Math.max(
      dist(at(L_SHOULDER), at(R_SHOULDER)),
      2.4 * dist(at(L_EAR), at(R_EAR)),
      0.5 * dist(shoulders, hips),
      4,
    );
    const unit = s * fit;

    ctx.fillStyle = ctx.strokeStyle = "#fff";
    ctx.lineCap = ctx.lineJoin = "round";
    // A soft edge, so clipped outlines don't look cut with scissors.
    ctx.filter = `blur(${Math.max(1, unit * 0.06).toFixed(1)}px)`;
    const band = (points: P[], width: number) => {
      ctx.lineWidth = width * unit;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const p of points.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    };

    // Torso: the shoulder-hip quadrilateral, filled and padded.
    const torso = [at(L_SHOULDER), at(R_SHOULDER), at(R_HIP), at(L_HIP)];
    ctx.beginPath();
    torso.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.55 * unit;
    ctx.stroke();

    // Neck and head: centred a little above the ears, big enough for hair.
    band([shoulders, ears], 0.75);
    const headCentre = beyond(shoulders, ears, 0.2);
    ctx.beginPath();
    ctx.arc(headCentre[0], headCentre[1], 0.75 * unit, 0, Math.PI * 2);
    ctx.fill();
    band([ears, at(NOSE)], 0.9);

    // Arms and hands. The hand reaches past the knuckle landmarks to cover the fingertips.
    for (const [sh, el, wr, pi, ix, th] of [
      [L_SHOULDER, L_ELBOW, L_WRIST, L_PINKY, L_INDEX, L_THUMB],
      [R_SHOULDER, R_ELBOW, R_WRIST, R_PINKY, R_INDEX, R_THUMB],
    ]) {
      band([at(sh), at(el)], 0.55);
      band([at(el), at(wr)], 0.45);
      const knuckles = mid(at(pi), at(ix));
      band([at(wr), beyond(at(wr), knuckles, 1)], 0.5);
      band([at(wr), beyond(at(wr), at(th), 0.6)], 0.3);
    }

    // Legs and feet.
    for (const [hp, kn, an, he, ft] of [
      [L_HIP, L_KNEE, L_ANKLE, L_HEEL, L_FOOT],
      [R_HIP, R_KNEE, R_ANKLE, R_HEEL, R_FOOT],
    ]) {
      band([at(hp), at(kn)], 0.75);
      band([at(kn), at(an)], 0.55);
      band([at(he), at(ft)], 0.4);
      band([at(an), at(ft)], 0.4);
    }
    ctx.filter = "none";
  }

  /** A copy of the last shape drawn, to show over the camera preview. */
  snapshot(): Promise<ImageBitmap> {
    return createImageBitmap(this.canvas);
  }

  /** Scales each mask pixel by how much it lies inside the last shape drawn. */
  apply(mask: Uint8Array, width: number, height: number): void {
    const gw = this.canvas.width;
    const gh = this.canvas.height;
    const gate = this.ctx.getImageData(0, 0, gw, gh).data;
    // Which gate pixel each mask column and row falls in, worked out once per size.
    const key = `${width}x${height}:${gw}x${gh}`;
    if (key !== this.mapFor) {
      this.mapFor = key;
      this.columns = Int32Array.from({ length: width }, (_, x) => Math.min(gw - 1, Math.floor((x * gw) / width)));
      this.rows = Int32Array.from({ length: height }, (_, y) => Math.min(gh - 1, Math.floor((y * gh) / height)) * gw);
    }
    const columns = this.columns;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const gateRow = this.rows[y];
      for (let x = 0; x < width; x++) {
        const g = gate[(gateRow + columns[x]) * 4 + 3];
        if (g === 255) continue;
        mask[row + x] = (mask[row + x] * g) / 255;
      }
    }
  }
}
