// The three steps cut into the shallow end's outer wall (ported from test_stairs.py). Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS, POOL_WATER, floorAt, setPool, makeStairs } from "../physics.js";
import * as ringsMod from "../rings.js";
import * as crabMod from "../crab.js";
import * as fishMod from "../fishbrain.js";

const DT = 1 / 60;
const stairs = () => POOL_REGIONS.slice(POOL_WATER.length);
const SHELF = () => POOL_WATER.reduce((a, b) => (b[4] < a[4] ? b : a));
const inStairs = (x, y) => stairs().some((r) => r[0] - 1e-6 <= x && x <= r[1] + 1e-6 && r[2] - 1e-6 <= y && y <= r[3] + 1e-6);

test("three steps in the outer wall of the shallow end, in every pool size", () => {
  for (const [L, W] of [[1, 1], [2, 1], [1, 2], [2, 3]]) {
    setPool(L, W);
    const [first, second, third] = stairs(), shelf = SHELF();
    assert.equal(stairs().length, 3);
    assert.ok(Math.abs(first[0] - shelf[1]) < 1e-9 && Math.abs(second[0] - first[1]) < 1e-9 && Math.abs(third[0] - second[1]) < 1e-9, "one after the other, going out from the shelf's end wall");
    assert.ok(third[4] > 0.34 && third[4] < second[4] && second[4] < first[4] && first[4] < shelf[4], "each shallower than the one before; even the top step takes a whole ring under the water");
    const mid = (shelf[2] + shelf[3]) / 2;
    assert.ok(Math.abs((first[2] + first[3]) / 2 - mid) < 1e-9 && first[3] - first[2] <= shelf[3] - shelf[2] - 0.19, "in the middle of the wall");
  }
  setPool(1, 1);
  assert.deepEqual(makeStairs([[0, 1, 0, 0.5, 1]]).length, 0, "a shelf too narrow for the notch gets none");
});

test("the ROV can drive onto the first step", () => {
  setPool(1, 1);
  const r = new Rov({ buoyancy: 1.5, tool: "nose" }), [first, , third] = stairs(), shelf = SHELF();
  [r.x, r.y, r.depth, r.yaw] = [shelf[1] - 1.0, (first[2] + first[3]) / 2, 0.3, 0.0];
  r.set_cmd("t1", 0.5); r.set_cmd("t2", 0.5);
  for (let i = 0; i < 60 * 8; i++) r.step(DT);
  assert.ok(r.x > first[0] + 0.3, `it is over the first step (x ${r.x.toFixed(2)})`);
  assert.ok(inStairs(r.x, r.y) && r.x < third[1] + 0.05, "and stopped by the end wall of the stairs");
});

test("a ring lies on a step", () => {
  setPool(1, 1);
  for (const step of stairs()) {
    const r = new Rov({ buoyancy: 0.0, tool: "nose" });
    ringsMod.addTo(r, 1);
    const ring = r.props.find((p) => p.type === "ring");
    [ring.x, ring.y, ring.yaw, ring.depth] = [(step[0] + step[1]) / 2, (step[2] + step[3]) / 2, Math.PI / 2, 0.2];
    for (let i = 0; i < 60 * 5; i++) r.step(DT);
    assert.ok(Math.abs(ring.depth - (step[4] - ring.R - ring.TUBE)) < 0.02, `the ring rests on the step (${ring.depth.toFixed(2)} m)`);
    assert.ok(inStairs(ring.x, ring.y));
  }
  assert.equal(floorAt((stairs()[2][0] + stairs()[2][1]) / 2, (stairs()[2][2] + stairs()[2][3]) / 2), stairs()[2][4]);
});

test("the crab and the fish stay out of the stairs", () => {
  setPool(1, 1);
  const r = new Rov({ buoyancy: 1.5, tool: "nose" });
  crabMod.addTo(r, 3); fishMod.addTo(r, 1);
  for (let i = 0; i < 60 * 90; i++) {
    r.step(DT);
    for (const p of r.props) if (p.type === "crab" || p.type === "fish") assert.ok(!inStairs(p.x, p.y), `a ${p.type} is on the stairs at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  }
  const crab = r.props.find((p) => p.type === "crab");
  [crab.x, crab.y, crab.pvx] = [SHELF()[1] - 0.2, (stairs()[0][2] + stairs()[0][3]) / 2, 1.0];
  for (let i = 0; i < 60 * 3; i++) { r.step(DT); assert.ok(!inStairs(crab.x, crab.y), "the crab was shoved onto the stairs"); }
});
