// clock.js — the countdown clock of a timed mission run. No DOM, no three.js (it runs in Node tests).
//   ready   waiting for the first move (the clock shows the full time)     running   counting down     over   time is up (the run is finished until Reset)
export class RunClock {
  constructor(total = 600) {
    this.total = total;
    this.reset();
  }
  reset() { this.state = "ready"; this.remaining = this.total; this.elapsed = 0.0; }
  /** The run begins (the ROV made its first move, or the Start key). Does nothing when it already began. */
  start() { if (this.state === "ready") this.state = "running"; }
  step(dt) {
    if (this.state !== "running") return;
    this.elapsed += dt;
    this.remaining = Math.max(0.0, this.total - this.elapsed);
    if (this.remaining <= 0.0) this.state = "over";
  }
  get over() { return this.state === "over"; }
  /** "m:ss" for the page (rounded up, so 0:00 is only shown when it is really over). */
  text() { const s = Math.ceil(this.remaining - 1e-9); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  data() { return { state: this.state, remaining: this.remaining, elapsed: this.elapsed, total: this.total, text: this.text() }; }
}
