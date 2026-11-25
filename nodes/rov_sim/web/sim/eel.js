// eel.js — an easter egg (browser version only; not documented on purpose). To remove it: delete this file and ../eel.js, and the eel lines in backend-local.js / app.js.
// The physics only sees a prop (reset / step / state) that keeps every command at zero while the ROV is stunned.
//   idle   not there     chase   swims at the ROV     bite   at the ROV for a moment (flash)     leave   swims back into its outlet
// The body is a chain of points: the head leads and every point follows the one in front of it.
import { POOL_REGIONS, clamp, floorAt, nearestIn } from "./physics.js";

export class Eel {
  static SEGMENTS = 18;                 // points in the body
  static GAP = 0.085;                   // m between points: the eel is about 1.4 m long
  static SPEED = [0.9, 1.8];            // m/s: how fast it swims at first / at most (it speeds up while it chases, so it always catches the ROV)
  static SPEED_UP = 0.08;               // m/s gained every second of the chase
  static TURN = 3.0;                    // rad/s: how fast the head can turn
  static BITE_AT = 0.30;                // m: head this close to the ROV's middle and it bites
  static BITE_TIME = 0.5;               // s of flash
  static STUN = [5.0, 10.0];            // s the ROV is dead and smoking after the bite, then everything works again
  static MARGIN = 0.12;                 // keeps this far from the pool's walls and floor

  constructor() {
    this.type = "eel";
    this.reset();
  }

  reset() {
    this.mode = "idle";
    this.t = 0.0;                       // seconds in this mode
    this.chase_t = 0.0;
    this.stun = 0.0;                    // seconds of being dead and smoking still to go
    this.locked = false;                // true while stunned: the ROV ignores every command
    this.dir = [0.0, -1.0, 0.0];        // where the head points (x, y, depth)
    this.segs = [];
    this.phase = 0.0;                   // swimming wiggle / coil turn
    this.outlet = null;
  }

  /** The lower outlet (the deeper of the two), from the jets add-on if the pool has one, else a spot in the middle of the far wall. */
  _outlet(rov) {
    const jets = rov.props.find((p) => p.type === "jets");
    if (jets && jets.outlets.length) return jets.outlets.reduce((a, b) => (b.depth > a.depth ? b : a));
    const main = POOL_REGIONS.reduce((a, b) => (b[4] > a[4] ? b : a));
    return { x: (main[0] + main[1]) / 2, y: main[3], depth: main[4] * 2 / 3, dx: 0.0, dy: -1.0 };
  }

  /** The L key. Does nothing while the eel is already out or the ROV is still smoking. Returns true if the eel started. */
  summon(rov) {
    if (this.mode !== "idle" || this.stun > 0) return false;
    const o = this.outlet = this._outlet(rov);
    this.mode = "chase"; this.t = 0.0; this.chase_t = 0.0;
    this.dir = [o.dx, o.dy, 0.0];
    this.segs = Array.from({ length: Eel.SEGMENTS }, () => [o.x, o.y, o.depth]);       // all in the nozzle; the head pulls them out
    return true;
  }

  _head() { return this.segs[0]; }

  /** Swim the head toward `target` (x, y, depth) at `speed`, turning at most TURN rad/s, and keep it in the water. */
  _swim(target, speed, dt) {
    const h = this._head(), E = Eel;
    let want = [target[0] - h[0], target[1] - h[1], target[2] - h[2]];
    const n = Math.hypot(...want) || 1;
    want = want.map((v) => v / n);
    const cur = this.dir, dot = clamp(cur[0] * want[0] + cur[1] * want[1] + cur[2] * want[2], -1, 1);
    const ang = Math.acos(dot), k = ang < 1e-6 ? 1 : Math.min(1, E.TURN * dt / ang);
    let d = cur.map((v, i) => v + (want[i] - v) * k);
    const dn = Math.hypot(...d) || 1;
    this.dir = d = d.map((v) => v / dn);
    h[0] += d[0] * speed * dt; h[1] += d[1] * speed * dt; h[2] += d[2] * speed * dt;
    [h[0], h[1]] = nearestIn(POOL_REGIONS, h[0], h[1], E.MARGIN);
    h[2] = clamp(h[2], E.MARGIN, Math.max(E.MARGIN, floorAt(h[0], h[1]) - E.MARGIN));
  }

  /** Every point follows the one before it, keeping GAP between them. */
  _follow() {
    const G = Eel.GAP;
    for (let i = 1; i < this.segs.length; i++) {
      const a = this.segs[i - 1], b = this.segs[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.hypot(dx, dy, dz);
      if (d > G) { const f = G / d; b[0] = a[0] + dx * f; b[1] = a[1] + dy * f; b[2] = a[2] + dz * f; }
    }
  }

  step(rov, dt) {
    const E = Eel, centre = [rov.x, rov.y, rov.depth];
    if (this.stun > 0) {                                                  // dead and smoking, then alive again
      this.stun -= dt;
      if (this.stun <= 0) { this.stun = 0.0; this.locked = false; } else this._lock(rov);
    }
    if (this.mode === "idle") return;
    this.t += dt; this.phase += dt;
    if (this.mode === "chase") {
      this.chase_t += dt;
      this._swim(centre, Math.min(E.SPEED[1], E.SPEED[0] + E.SPEED_UP * this.chase_t), dt);
      this._follow();
      const h = this._head();
      if (Math.hypot(h[0] - centre[0], h[1] - centre[1], h[2] - centre[2]) < E.BITE_AT) {
        this.mode = "bite"; this.t = 0.0;
        this.stun = E.STUN[0] + (E.STUN[1] - E.STUN[0]) * Math.random();
        this.locked = true; this._lock(rov);
      }
    } else if (this.mode === "bite") {
      const h = this._head(), d = [centre[0] - h[0], centre[1] - h[1], centre[2] - h[2]], n = Math.hypot(...d) || 1;
      for (let j = 0; j < 3; j++) h[j] += d[j] / n * Math.min(n, 0.5 * dt);   // the head stays on the ROV
      this._follow();
      if (this.t >= E.BITE_TIME) { this.mode = "leave"; this.t = 0.0; }
    } else if (this.mode === "leave") {
      const o = this.outlet;
      this._swim([o.x, o.y + 0.25, o.depth], E.SPEED[1], dt);
      this._follow();
      const h = this._head();
      if (Math.hypot(h[0] - o.x, h[1] - o.y, h[2] - o.depth) < 0.3 || this.t > 25) { this.mode = "idle"; this.segs = []; }
    }
  }

  /** Stunned: every thruster and the claw stay off. */
  _lock(rov) {
    for (const k of Object.keys(rov.cmd)) rov.cmd[k] = 0.0;
    rov.claw_target = rov.claw;
  }

  state() {
    return { type: "eel", mode: this.mode, t: this.t, locked: this.locked, zap: this.mode === "bite" ? 1 : 0, dead: this.stun > 0,
      dir: [...this.dir], phase: this.phase, segs: this.segs.map((s) => [...s]) };
  }
}

/** Put the (sleeping) eel in the pool. */
export function addTo(rov) { rov.props.push(new Eel()); }

/** The L key: the eel comes out of the lower outlet. Returns true if it started. */
export function summon(rov) { const e = rov.props.find((p) => p.type === "eel"); return e ? e.summon(rov) : false; }
