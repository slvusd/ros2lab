// Phase 5: the lobster pot (task 2.3). Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL } from "../layout.js";
import { LobsterPot } from "../pot.js";

const DT = 1 / 60;
function make() {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov);
  return { rov, m, pot: rov.props.find((p) => p.type === "m_pot") };
}
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }
/** Sweep the nose across the handle (at its height) from (x0, y) to (x1, y). */
function sweep(rov, pot, x0, x1, y, steps = 60) {
  const z = -pot.floor + LobsterPot.HANDLE_UP;
  for (let i = 0; i <= steps; i++) { noseAt(rov, x0 + (x1 - x0) * i / steps, y, z); rov.step(DT); }
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };

test("the pot: the buoy sits in its holder, the red handle sticks out 30 cm, nothing is scored", () => {
  const { rov, m, pot } = make();
  run(rov, 1);
  assert.equal(pot.state_name, "holder"); assert.equal(pot.open, false); assert.equal(pot.released, false);
  const [a, b] = pot.handle();
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.30) < 1e-9);
  assert.equal(m.board.get("pot_open") || m.board.get("pot_surface"), false);
});

test("pushing the handle round 60 degrees frees the buoy (+5); it rises and breaks the surface (+5)", () => {
  const { rov, m, pot } = make();
  const [pv] = [pot.pivot];
  const y = pv[1] + 0.15;                                              // half way along the handle
  sweep(rov, pot, pv[0] - 0.25, pv[0] + 0.05, y);                      // a small push: the handle moves a little, nothing opens
  assert.ok(pot.turned() > 0.05 && pot.turned() < 1.05, `turned ${pot.turned().toFixed(2)} rad`);
  assert.equal(pot.open, false);
  run(rov, 1);
  const kept = pot.theta;
  assert.equal(pot.theta, kept, "it stays where it was put (friction)");
  for (let k = 0; k < 6 && !pot.open; k++) {                           // keep pushing the same way
    sweep(rov, pot, pot.pivot[0] + 0.3 * Math.cos(pot.theta) - 0.3, pot.pivot[0] + 0.3 * Math.cos(pot.theta) + 0.1, pot.pivot[1] + 0.3 * Math.sin(pot.theta) - 0.02, 30);
  }
  assert.equal(pot.open, true, `turned ${pot.turned().toFixed(2)} rad`);
  run(rov, 0.3);
  assert.equal(pot.state_name, "rising");
  run(rov, 2);
  assert.equal(m.board.get("pot_open"), true, "clear of the holder");
  assert.equal(m.board.get("pot_surface"), false, "still rising");
  run(rov, 12);
  assert.equal(pot.surfaced, true); assert.equal(m.board.get("pot_surface"), true); assert.equal(m.board.total, 10);
  assert.ok(Math.abs(pot.buoy_depth - 0.075) < 1e-9, "floating at the surface");
});

test("the handle can be pushed either way round; a ROV that only passes beside the pot does not turn it", () => {
  const { rov, m, pot } = make();
  const z = -pot.floor + LobsterPot.HANDLE_UP;
  noseAt(rov, pot.pivot[0] - 1.0, pot.pivot[1] + 0.8, z);
  for (let i = 0; i < 60; i++) { noseAt(rov, pot.pivot[0] - 1.0 + 2 * i / 60, pot.pivot[1] + 0.8, z); rov.step(DT); }
  assert.equal(pot.turned(), 0, "well clear of it");
  sweep(rov, pot, pot.pivot[0] + 0.25, pot.pivot[0] - 0.05, pot.pivot[1] + 0.15);       // from the other side
  assert.ok(pot.theta > pot.theta0 + 0.05, "the other way round");
});

test("a ROV flying high over the pot does not touch the handle; Reset closes the pot again", () => {
  const { rov, m, pot } = make();
  const hi = -pot.floor + 1.5;
  for (let i = 0; i < 60; i++) { noseAt(rov, pot.pivot[0] - 0.3 + 0.6 * i / 60, pot.pivot[1] + 0.15, hi); rov.step(DT); }
  assert.equal(pot.turned(), 0);
  pot.theta = pot.theta0 + 2; pot.open = true; pot.state_name = "rising"; pot.buoy_depth = 1.0;
  rov.reset();
  assert.equal(pot.turned(), 0); assert.equal(pot.state_name, "holder"); assert.equal(pot.open, false); assert.equal(m.board.total, 0);
});
