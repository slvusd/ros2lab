// eel.js — OPTIONAL joke add-on (browser version only): press L and an electric eel swims out of the lower water outlet, chases the ROV, wraps round it and
// shocks it. The ROV is then dead (no thrusters, no claw, nothing: only Reset brings it back); the eel lets go and swims back into the outlet.
// To remove it: delete this file and ../eel.js, and the addTo() call in backend-local.js. Nothing else knows about it: the physics only sees a prop
// (reset / step / state) that, while it holds the ROV, keeps every command at zero.
//   idle    not there                       chase   swims at the ROV (a little faster the longer it takes)      shock   coiled round the ROV, zapping
//   leave   swims back to its outlet        gone    inside the outlet again; the ROV stays dead until Reset
// The body is a chain of points: the head leads and every point follows the one in front of it, so it pours out of the nozzle like a real eel.
import { POOL_REGIONS, clamp, floorAt, nearestIn } from "./physics.js";

export class Eel {
  static SEGMENTS = 18;                 // points in the body
  static GAP = 0.085;                   // m between points: the eel is about 1.4 m long
  static SPEED = [0.9, 1.8];            // m/s: how fast it swims at first / at most (it speeds up while it chases, so it always catches the ROV)
  static SPEED_UP = 0.08;               // m/s gained every second of the chase
  static TURN = 3.0;                    // rad/s: how fast the head can turn
  static GRAB_AT = 0.34;                // m: head this close to the ROV's middle and it wraps round
  static SHOCK_TIME = 4.0;              // s of zapping
  static COIL_R = 0.36;                 // m: radius of the coil round the ROV
  static MARGIN = 0.12;                 // keeps this far from the pool's walls and floor

  constructor() {
    this.type = "eel";
    this.reset();
  }

  reset() {
    this.mode = "idle";
    this.t = 0.0;                       // seconds in this mode
    this.chase_t = 0.0;
    this.locked = false;                // true from the grab on: the ROV ignores every command (until Reset)
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

  /** The L key. Does nothing while the eel is already out (or the ROV is already dead). Returns true if the eel started. */
  summon(rov) {
    if (this.mode !== "idle") return false;
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
    if (this.mode === "idle" || this.mode === "gone") { if (this.locked) this._lock(rov); return; }
    const E = Eel, centre = [rov.x, rov.y, rov.depth];
    this.t += dt; this.phase += dt;
    if (this.mode === "chase") {
      this.chase_t += dt;
      this._swim(centre, Math.min(E.SPEED[1], E.SPEED[0] + E.SPEED_UP * this.chase_t), dt);
      this._follow();
      const h = this._head();
      if (Math.hypot(h[0] - centre[0], h[1] - centre[1], h[2] - centre[2]) < E.GRAB_AT) { this.mode = "shock"; this.t = 0.0; this.locked = true; }
    } else if (this.mode === "shock") {
      const n = this.segs.length;                                    // the body winds round the ROV in a spiral, the head on top
      this.segs.forEach((s, i) => {
        const a = this.phase * 1.2 + i * 0.55, r = E.COIL_R, up = (0.5 - i / (n - 1)) * 0.55;
        const x = centre[0] + Math.cos(a) * r, y = centre[1] + Math.sin(a) * r;
        const to = [x, y, clamp(centre[2] - up, 0.04, Math.max(0.04, floorAt(x, y) - 0.04))];                 // (never out of the water or into the floor)
        const k = 1 - Math.exp(-dt * 7);
        for (let j = 0; j < 3; j++) s[j] += (to[j] - s[j]) * k;
      });
      this.dir = [Math.cos(this.phase * 1.2 + 0.55), Math.sin(this.phase * 1.2 + 0.55), 0.0];
      if (this.t >= E.SHOCK_TIME) { this.mode = "leave"; this.t = 0.0; }
    } else if (this.mode === "leave") {
      const o = this.outlet;
      this._swim([o.x, o.y + 0.25, o.depth], E.SPEED[0] * 1.2, dt);
      this._follow();
      const h = this._head();
      if (Math.hypot(h[0] - o.x, h[1] - o.y, h[2] - o.depth) < 0.3 || this.t > 25) { this.mode = "gone"; this.segs = []; }
    }
    if (this.locked) this._lock(rov);
  }

  /** The ROV is dead: every thruster and the claw stay where they are (off). */
  _lock(rov) {
    for (const k of Object.keys(rov.cmd)) rov.cmd[k] = 0.0;
    rov.claw_target = rov.claw;
  }

  /** `zap` is 1 while the eel is shocking (the page makes the sparks); `dead` once the ROV was shocked (the page makes the smoke). */
  state() {
    return {
      type: "eel", mode: this.mode, t: this.t, locked: this.locked, zap: this.mode === "shock" ? 1 : 0, dead: this.locked,
      dir: [...this.dir], phase: this.phase, segs: this.segs.map((s) => [...s]),
    };
  }
}

/** Put the (sleeping) eel in the pool: it only comes out when the L key is pressed. */
export function addTo(rov) { rov.props.push(new Eel()); }

/** The L key: the eel comes out of the lower outlet. Returns true if it started. */
export function summon(rov) { const e = rov.props.find((p) => p.type === "eel"); return e ? e.summon(rov) : false; }
