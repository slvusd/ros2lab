// items.js — the competition props the ROV can carry, and the ones it flies over. Sizes from the 2026 prop building instructions (metres):
//   basket star : a 1/2" PVC "H" (10 cm crossbar, four 5 cm stubs) with an O-ball (about 10 cm across) cable-tied on top          -> carry it by the ball (nose) or the H (claw)
//   coral       : a 1/2" tee with 30 cm pipe cleaners (trunk and branches), about 25-30 cm tall                                    -> carry it by the branches
//   crab        : a 1 1/2" end cap (5 cm) with 30 cm pipe-cleaner legs and claws, about 30 cm across                                -> carry it by the legs (nose) or the cap (claw)
// More (crab, markers, sensors, connectors ...) are added phase by phase. Every one is worth points only when it is on the deck (`scoreId`).
import { Carryable } from "../common/carry.js";
import { at, frame } from "./layout.js";

export class BasketStar extends Carryable {
  static RADIUS = 0.075; static BODY_HIGH = 0.05;
  constructor(id, label, scoreId, u, v, yaw = 0) {
    const [x, y] = at(u, v);
    super(id, "basket_star", x, y, [{ id: "ball", up: 0.08, r: 0.07, kind: "lattice" }, { id: "h", up: 0.015, r: 0.05, kind: "claw" }], yaw);
    this.label = label; this.scoreId = scoreId;
  }
}
export class Coral extends Carryable {
  static RADIUS = 0.05; static BODY_HIGH = 0.10;
  constructor(id, label, scoreId, u, v, yaw = 0) {
    const [x, y] = at(u, v);
    super(id, "coral", x, y, [{ id: "branches", up: 0.20, r: 0.08, kind: "branch" }, { id: "tee", up: 0.03, r: 0.04, kind: "claw" }], yaw);
    this.label = label; this.scoreId = scoreId;
  }
}

export class MissionCrab extends Carryable {
  static RADIUS = 0.07; static BODY_HIGH = 0.04;
  constructor(id, label, scoreId, u, v, yaw = 0) {
    const [x, y] = at(u, v);
    super(id, "crab", x, y, [{ id: "legs", up: 0.04, r: 0.09, kind: "branch" }, { id: "cap", up: 0.02, r: 0.04, kind: "claw" }], yaw);
    this.label = label; this.scoreId = scoreId;
  }
}

/** The transect: a 3.1 m "I" of 1/2" PVC on the floor, running out from the wall (0.5 m to 3.6 m). Flying along it, staying over it from one end to the other, scores. */
export class Transect {
  static LENGTH = 3.1; static HALF_WIDTH = 0.27;                            // the ROV is about 0.5 m wide: its plan view must overlap the pipe
  static END_ZONE = 0.35;                                                   // m: within this of an end it counts as being "at" that end
  static LEAVE = 0.6;                                                       // m past an end the run is over
  constructor(u0 = 0.5) {
    this.type = "m_transect";
    this.u0 = u0;
    this.reset();
  }
  /** The two ends in world coordinates [x, y]: A (near the wall) and B. */
  ends() { const f = frame(); return [[f.wallX - this.u0, f.midY], [f.wallX - this.u0 - Transect.LENGTH, f.midY]]; }
  reset() { this.armed = null; this.done = false; this.s = 0.0; this.d = 0.0; }
  /** Where the ROV is along the pipe (s, 0..LENGTH from end A) and how far to the side (d). */
  locate(rov) {
    const [a, b] = this.ends(), L = Transect.LENGTH;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const dx = rov.x - a[0], dy = rov.y - a[1];
    return [dx * ux + dy * uy, -dx * uy + dy * ux];
  }
  step(rov, dt) {
    const L = Transect.LENGTH, Z = Transect.END_ZONE;
    const [s, d] = this.locate(rov);
    this.s = s; this.d = d;
    const over = Math.abs(d) <= Transect.HALF_WIDTH && s >= -Transect.LEAVE && s <= L + Transect.LEAVE;
    if (!over) { this.armed = null; return; }                              // left the pipe: start again from an end
    if (this.armed === null) { if (s <= Z) this.armed = "A"; else if (s >= L - Z) this.armed = "B"; }            // starts from either end
    else if (this.armed === "A" && s >= L - Z) this.done = true;
    else if (this.armed === "B" && s <= Z) this.done = true;
  }
  state() { const [a, b] = this.ends(); return { type: this.type, a, b, armed: this.armed, done: this.done, length: Transect.LENGTH }; }
}
