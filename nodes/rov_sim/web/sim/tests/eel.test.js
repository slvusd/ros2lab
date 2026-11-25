// eel.js: press L, an eel comes out of the lower outlet, chases the ROV, shocks it, and the ROV is dead until Reset. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { World, DT } from "../world.js";
import { Rov, POOL_REGIONS, floorAt } from "../physics.js";
import * as eelMod from "../eel.js";
import { Eel } from "../eel.js";
import * as currentMod from "../current.js";

function make() {
  const rov = new Rov({ tool: "nose" });
  currentMod.addTo(rov, false);
  eelMod.addTo(rov);
  return { rov, world: new World(rov), eel: rov.props.find((p) => p.type === "eel") };
}
const run = (world, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) world.rov.step(DT); };

test("the eel sleeps until summoned; summoned it starts in the LOWER outlet and swims out", () => {
  const { rov, world, eel } = make();
  run(world, 1);
  assert.equal(eel.mode, "idle"); assert.equal(eel.state().segs.length, 0);
  assert.equal(eelMod.summon(rov), true);
  const low = rov.props.find((p) => p.type === "jets").outlets.reduce((a, b) => (b.depth > a.depth ? b : a));
  assert.ok(eel.segs.every((s) => s[0] === low.x && s[1] === low.y && s[2] === low.depth), "every point of the body is in the nozzle at first");
  assert.equal(eelMod.summon(rov), false, "L again while it is out does nothing");
  run(world, 1.0);
  assert.equal(eel.mode, "chase");
  const tail = eel.segs.at(-1), head = eel.segs[0];
  assert.ok(Math.hypot(head[0] - low.x, head[1] - low.y, head[2] - low.depth) > 0.5, "the head has swum out");
});

test("it catches a ROV that drives away, shocks it, and the ROV is dead: no command moves it", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  world.command({ t1: 1, t2: 1 });                       // the ROV tries to flee at full speed
  let grabbed = -1;
  for (let i = 0; i < 60 * 40 && grabbed < 0; i++) { rov.step(DT); if (eel.mode === "shock") grabbed = i * DT; }
  assert.ok(grabbed > 0, "the eel catches even a ROV that is driving away");
  assert.equal(eel.locked, true);
  world.command({ t1: 0, t2: 0 }); world.command({ t1: 1, t2: 1, t3: 1, t4: 1, claw: 1 });
  run(world, 6);
  for (const k of Object.keys(rov.cmd)) assert.equal(rov.cmd[k], 0, `${k} stays off`);
  assert.equal(rov.claw_target, rov.claw, "the claw stays where it is");
  assert.ok(Math.hypot(rov.u, rov.v) < 0.05, "no thrust: it has coasted to a stop");
});

test("the shock lasts a few seconds, then the eel swims back into the outlet and is gone; the ROV stays dead until Reset", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  for (let i = 0; i < 60 * 40 && eel.mode !== "shock"; i++) rov.step(DT);
  assert.equal(eel.mode, "shock");
  assert.equal(eel.state().zap, 1);
  const centre = [rov.x, rov.y, rov.depth];
  run(world, 1.5);
  const near = eel.segs.map((s) => Math.hypot(s[0] - rov.x, s[1] - rov.y, s[2] - rov.depth));
  assert.ok(Math.max(...near) < 0.7, `the whole body is wrapped round the ROV (${Math.max(...near).toFixed(2)} m)`);
  run(world, Eel.SHOCK_TIME);
  assert.equal(eel.mode, "leave"); assert.equal(eel.state().zap, 0);
  run(world, 25);
  assert.equal(eel.mode, "gone");
  assert.equal(eel.locked, true, "still dead");
  assert.equal(eelMod.summon(rov), false);
  rov.reset();
  assert.equal(eel.mode, "idle"); assert.equal(eel.locked, false);
  world.command({ t1: 0.5, t2: 0.5 });
  run(world, 1);
  assert.ok(rov.u > 0.01, "after Reset the ROV drives again");
  assert.equal(eelMod.summon(rov), true, "and the eel can be called again");
});

test("the eel stays inside the water and its body keeps together", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  for (let i = 0; i < 60 * 12; i++) {
    rov.step(DT);
    const segs = eel.segs;
    if (!segs.length) continue;
    for (const [x, y, d] of segs.slice(0, 1)) assert.ok(d >= 0 && d <= floorAt(x, y) + 1e-6, `the head is under water and above the floor (${d.toFixed(2)})`);
    for (let k = 1; k < segs.length; k++) assert.ok(Math.hypot(...segs[k].map((v, j) => v - segs[k - 1][j])) <= Eel.GAP * 1.05 + 0.2, `no gap in the body (${i}, ${eel.mode}, seg ${k}: ${Math.hypot(...segs[k].map((v, j) => v - segs[k - 1][j])).toFixed(2)})`);
  }
});
