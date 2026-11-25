// world.js — the browser's own simulation loop: no DOM, no three.js (so it also runs in Node tests).
// It owns the commands from the page (the keyboard), steps the ROV at a fixed 1/60 s, and produces state().
// M1.2: the ROV here is a crude stand-in (FakeRov). M1.3 replaces it with the real port of rov_physics.py.
import { FakeRov } from "./fakerov.js";

export const DT = 1 / 60, MAX_STEPS = 4;      // never try to catch up more than 4 steps per frame (slow machine: slow motion, not a freeze)

export class World {
  constructor(rov = new FakeRov()) {
    this.rov = rov;
    this.commands = {};                         // latest keyboard command from the page: {t1..t4, claw}
    this._prev = {};
    this.keys = true;
    this._acc = 0;
    this._last = null;
  }
  /** The page's keyboard command: apply only the channels whose value CHANGED (same rule as apply_keyboard in Python). */
  command(c) {
    this.commands = c;
    for (const k of ["t1", "t2", "t3", "t4"]) {
      if ((c[k] ?? 0) !== (this._prev[k] ?? 0)) this.rov.setCmd(k, c[k] ?? 0);
    }
    if ((c.claw ?? 0) !== (this._prev.claw ?? 0)) this.rov.clawTarget = Math.max(0, Math.min(1, c.claw ?? 0));
    this._prev = { ...c };
  }
  reset() { this.rov.reset(); this.commands = {}; this._prev = {}; }
  /** Advance by wall-clock time `now` (ms), in fixed steps. */
  advance(now) {
    if (this._last === null) this._last = now;
    this._acc += Math.min((now - this._last) / 1000, MAX_STEPS * DT);
    this._last = now;
    while (this._acc >= DT) { this.rov.step(DT); this._acc -= DT; }
  }
  /** Skip the time that passed while nobody was running us (tab hidden). */
  pause() { this._last = null; }
  state() { return { ...this.rov.state(), keys: this.keys, ros: false, joys: [[0, 0], [0, 0]], joy_topics: [] }; }
}
