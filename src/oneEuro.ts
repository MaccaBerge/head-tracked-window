// One Euro filter: heavy smoothing when the signal is still (kills jitter),
// light smoothing when it moves fast (keeps latency low).
// https://gery.casiez.net/1euro/

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
