// cable.js — a cable that is only DRAWN and checked (no rope physics): the line from where it is anchored along the path its free end really took.
// The path is a trail of points left behind the end; backing up over the trail takes it in again (so the cable "retracts"). Used for the 2 m and 4 m cables of the 2026 mission.
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export class Cable {
  /** anchor(): world [x, y, z up] of the fixed end; end(): [x, y, z] of the free end, or null when it is not in the water (on the deck); length: metres of cable. */
  constructor(id, anchor, end, length) {
    this.type = "m_cable"; this.id = id; this.anchor = anchor; this.end = end; this.length = length;
    this.reset();
  }
  reset() { this.trail = []; this.path = 0; }
  step() {
    const e = this.end();
    if (!e) { this.trail = []; this.path = 0; return; }
    const a = this.anchor();
    if (!this.trail.length) this.trail.push(a);
    while (this.trail.length > 1 && d3(e, this.trail[this.trail.length - 2]) < 0.12) this.trail.pop();         // backed up over its own trail: take the cable in
    if (d3(e, this.trail[this.trail.length - 1]) > 0.10) this.trail.push([e[0], e[1], e[2]]);
    this.trail[0] = a;                                                                                          // (the anchor can move: the sensor was set down somewhere else)
    let p = 0; const pts = this.points();
    for (let i = 1; i < pts.length; i++) p += d3(pts[i - 1], pts[i]);
    this.path = p;
  }
  /** The polyline: anchor, the trail, the free end. */
  points() { const e = this.end(); return e ? [...this.trail, e] : []; }
  get taut() { return this.path > this.length; }
  state() { return { type: this.type, id: this.id, pts: this.points().slice(-160), length: this.length, path: this.path, taut: this.taut }; }
}
