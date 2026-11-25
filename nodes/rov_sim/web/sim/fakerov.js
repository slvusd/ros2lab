// fakerov.js — a crude stand-in ROV for M1.2 (plumbing test only). Replaced by physics.js in M1.3.
// Same state() keys as the real one, so the page cannot tell the difference.
export const POOL_REGIONS = [[-3, 3, -1.5, 1.5, 2.0], [0.5, 3.0, 1.5, 4.0, 1.0]];   // x0, x1, y0, y1, depth

export class FakeRov {
  constructor() { this.cmd = { t1: 0, t2: 0, t3: 0, t4: 0 }; this.claw = 0; this.clawTarget = 0; this.reset(); }
  reset() { this.x = -1.5; this.y = 0; this.depth = 0.8; this.yaw = 0; this.speed = 0; for (const k in this.cmd) this.cmd[k] = 0; }
  setCmd(n, v) { this.cmd[n] = Math.max(-1, Math.min(1, v)); }
  step(dt) {
    const { t1, t2, t3, t4 } = this.cmd;
    this.yaw += (t1 - t2) * 0.8 * dt;                      // turn right (t1 > t2) = clockwise = yaw decreases
    this.speed = ((t1 + t2) / 2) * 1.5;
    this.x += Math.cos(this.yaw) * this.speed * dt;
    this.y += Math.sin(this.yaw) * this.speed * dt;
    this.depth -= ((t3 + t4) / 2) * 0.6 * dt;
    this.x = Math.max(-2.7, Math.min(2.7, this.x));
    this.y = Math.max(-1.2, Math.min(1.2, this.y));
    this.depth = Math.max(0.15, Math.min(1.9, this.depth));
  }
  state() {
    return { x: this.x, y: this.y, depth: this.depth, yaw: this.yaw, t1: this.cmd.t1, t2: this.cmd.t2, t3: this.cmd.t3, t4: this.cmd.t4,
      claw: 0, speed: Math.abs(this.speed), splash_n: 0, splash_v: 0, floor_n: 0, floor_v: 0, props: [], tool: "nose", pitch: 0,
      imu: null, buoyancy: 0, regions: POOL_REGIONS.map((r) => [...r]) };
  }
}
