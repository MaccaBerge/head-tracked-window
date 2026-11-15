/**
 * Steadies the person mask over time and drops stray blobs.
 *
 * A port of MaskCleaner from projector_fun/shadow_physics.py. The model's
 * per-pixel confidence flickers from frame to frame. Averaging it over a few
 * frames, and requiring a clear change before a pixel flips, keeps the
 * outline calm. Small specks are opened away, and only the main blob (plus
 * any others at least a quarter of its size) is kept.
 *
 * It works at a reduced resolution, which keeps it fast; the edges are
 * softened afterwards so the enlarged mask doesn't look blocky.
 */
export class MaskCleaner {
  /** Output width and height. */
  width = 0;
  height = 0;
  /** The cleaned mask, 0 or 255 with softened edges, rows top to bottom. */
  output = new Uint8Array(0);

  private average = new Float32Array(0);
  private solid = new Uint8Array(0);
  private scratch = new Uint8Array(0);
  private labels = new Int32Array(0);
  private stack = new Int32Array(0);
  private fresh = true;

  constructor(
    /**
     * Shrink factor in each direction. 3 turns a 1280×720 mask into 426×240,
     * which cleans in about 3.5 ms on an M1 (2 takes about 7 ms).
     */
    private step = 3,
    /** How much of the previous average is kept each frame. */
    private smoothing = 0.6,
    /** A pixel turns on above this... */
    private on = 0.6,
    /** ...off below this, and otherwise keeps its state. */
    private off = 0.4,
    /** Blobs smaller than this share of the largest are dropped. */
    private minShare = 0.25,
  ) {}

  reset(): void {
    this.fresh = true;
  }

  /** Cleans a full-resolution mask of bytes 0..255. */
  clean(raw: Uint8Array, rawWidth: number, rawHeight: number): void {
    const s = this.step;
    const w = Math.floor(rawWidth / s);
    const h = Math.floor(rawHeight / s);
    const n = w * h;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.average = new Float32Array(n);
      this.solid = new Uint8Array(n);
      this.scratch = new Uint8Array(n);
      this.output = new Uint8Array(n);
      this.labels = new Int32Array(n);
      this.stack = new Int32Array(n);
      this.fresh = true;
    }

    // Shrink (averaging each block), then blend into the running average.
    const keep = this.fresh ? 0 : this.smoothing;
    const norm = 1 / (255 * s * s);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = 0; dy < s; dy++) {
          const row = (y * s + dy) * rawWidth + x * s;
          for (let dx = 0; dx < s; dx++) sum += raw[row + dx];
        }
        const i = y * w + x;
        const v = sum * norm;
        const a = keep * this.average[i] + (1 - keep) * v;
        this.average[i] = a;
        if (this.fresh) this.solid[i] = a > 0.5 ? 1 : 0;
        else if (a > this.on) this.solid[i] = 1;
        else if (a < this.off) this.solid[i] = 0;
      }
    }
    this.fresh = false;

    // Opening with a small cross: erode, then dilate. Removes specks and
    // hairline bridges without changing the outline much.
    this.morph(this.solid, this.scratch, w, h, false);
    this.morph(this.scratch, this.output, w, h, true);
    this.keepMainBlobs(this.output, w, h);
    this.soften(this.output, w, h);
  }

  /** 3×3 cross erosion (grow = false) or dilation (grow = true). */
  private morph(src: Uint8Array, dst: Uint8Array, w: number, h: number, grow: boolean): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const c = src[i];
        const l = x > 0 ? src[i - 1] : c;
        const r = x < w - 1 ? src[i + 1] : c;
        const u = y > 0 ? src[i - w] : c;
        const d = y < h - 1 ? src[i + w] : c;
        dst[i] = grow ? c | l | r | u | d : c & l & r & u & d;
      }
    }
  }

  /** Labels connected blobs (8-way) and clears those much smaller than the largest. */
  private keepMainBlobs(mask: Uint8Array, w: number, h: number): void {
    const labels = this.labels;
    const stack = this.stack;
    labels.fill(0);
    const areas: number[] = [0];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || labels[start]) continue;
      const label = areas.length;
      let area = 0;
      let top = 0;
      stack[top++] = start;
      labels[start] = label;
      while (top) {
        const i = stack[--top];
        area++;
        const x = i % w;
        const y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (mask[j] && !labels[j]) {
              labels[j] = label;
              stack[top++] = j;
            }
          }
        }
      }
      areas.push(area);
    }
    if (areas.length <= 2) return; // one blob or none
    const minArea = this.minShare * Math.max(...areas);
    for (let i = 0; i < w * h; i++) {
      if (mask[i] && areas[labels[i]] < minArea) mask[i] = 0;
    }
  }

  /** Turns 0/1 into 0/255 with a small blur, so the edge fades over a pixel or two. */
  private soften(mask: Uint8Array, w: number, h: number): void {
    const tmp = this.scratch;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = x > 0 ? mask[i - 1] : mask[i];
        const r = x < w - 1 ? mask[i + 1] : mask[i];
        tmp[i] = l + 2 * mask[i] + r; // 0..4
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const u = y > 0 ? tmp[i - w] : tmp[i];
        const d = y < h - 1 ? tmp[i + w] : tmp[i];
        mask[i] = ((u + 2 * tmp[i] + d) * 255) >> 4; // 0..16 -> 0..255
      }
    }
  }
}
