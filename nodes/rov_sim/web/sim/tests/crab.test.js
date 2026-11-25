// The green crab and the Pushable base class (ported from test_crab.py). Behaviour, not exact paths: the JS crab has its own random numbers.
// Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS } from "../physics.js";
import { distanceToRov } from "../shape.js";
import { Pushable } from "../pushable.js";
import { Crab, addTo as addCrabs } from "../crab.js";
import { addTo as addRings } from "../rings.js";
import { addTo as addFish } from "../fishbrain.js";

const DT = 1 / 60;
const SHELF = POOL_REGIONS.reduce((a, b) => (b[4] < a[4] ? b : a)), FLOOR = SHELF[4];

function make(crabs = 1, opts = {}) {
  const r = new Rov({ buoyancy: 0.0, tool: "nose", ...opts });
  addCrabs(r, crabs);
  return [r, r.props.filter((p) => p.type === "crab")];
}
const insideShelf = (c, slack = 1e-6) => SHELF[0] - slack <= c.x && c.x <= SHELF[1] + slack && SHELF[2] - slack <= c.y && c.y <= SHELF[3] + slack;
function putRovOnShelf(r, x, y, yaw = 0.0) { r.x = x; r.y = y; r.yaw = yaw; r.depth = FLOOR - 0.28 - 0.002; }   // resting on the floor
const minGap = (r, c) => distanceToRov(r, [c.x, c.y, -FLOOR + 0.02])[0] - c.RADIUS;

test("the crab crawls on the floor of the shallow end", () => {
  const [r, [c]] = make();
  r.x = -2.5; r.y = -1.0;
  const xs = [], ys = [], modes = new Set(); let top = 0;
  for (let i = 0; i < 60 * 240; i++) {
    r.step(DT);
    assert.ok(insideShelf(c), `left the shallow end at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
    xs.push(c.x); ys.push(c.y); modes.add(c.mode); top = Math.max(top, c.speed);
  }
  assert.ok(Math.max(...xs) - Math.min(...xs) > 0.4 || Math.max(...ys) - Math.min(...ys) > 0.4, "the crab barely moved in 4 minutes");
  assert.ok(modes.has("pause") && modes.has("walk"), `it should sit and crawl: ${[...modes]}`);
  assert.ok(top <= Crab.SCUTTLE + 1e-9 && top < 0.1, `crawls at ${top.toFixed(2)} m/s`);
  assert.ok(Math.abs(c.state().depth - (FLOOR - 0.02)) < 1e-9, "it stays on the floor");
});

test("the crab walks sideways: the claws point a quarter turn from the way it goes", () => {
  const [r, [c]] = make();
  r.x = -2.5; r.y = -1.0;
  let checked = 0, last = [c.x, c.y];
  for (let i = 0; i < 60 * 120; i++) {
    r.step(DT);
    if (c.mode === "walk" && i % 30 === 0 && Math.hypot(c.x - last[0], c.y - last[1]) > 1e-5) {
      const heading = Math.atan2(c.y - last[1], c.x - last[0]);
      const err = Math.abs(((c.yaw - heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (Math.abs(err - Math.PI / 2) < 0.5) checked++;
    }
    if (i % 30 === 0) last = [c.x, c.y];
  }
  assert.ok(checked > 5, `only ${checked} samples with the claws a quarter turn from the direction of travel`);
});

test("the ROV pushes the crab out of the way", () => {
  const [r, [c]] = make();
  c.x = 1.8; c.y = 2.6; c.timer = 1e9;
  putRovOnShelf(r, 1.8 - 0.9, 2.6, 0.0);
  const startX = c.x;
  let touched = 0, worst = 0;
  r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0);
  for (let i = 0; i < 60 * 6; i++) { r.step(DT); if (c.pushed) touched++; worst = Math.min(worst, minGap(r, c)); assert.ok(insideShelf(c)); }
  assert.ok(touched > 0, "the ROV drove through the crab without touching it");
  assert.ok(c.x > startX + 0.25, `the crab was only moved ${(c.x - startX).toFixed(2)} m along the ROV's path`);
  assert.ok(worst > -0.02, `the crab ended up ${(-worst * 100).toFixed(1)} cm inside the ROV`);
});

test("a ROV passing well above the crab does not touch it", () => {
  const [r, [c]] = make();
  c.x = 1.8; c.y = 2.6; c.timer = 1e9;
  r.x = 0.9; r.y = 2.6; r.yaw = 0.0; r.depth = 0.30;
  r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0);
  for (let i = 0; i < 60 * 5; i++) { r.step(DT); assert.ok(!c.pushed, "a ROV high above the floor pushed the crab"); }
});

test("the crab cannot outrun the ROV", () => {
  for (const offset of [0, 7]) {
    const [r, [c]] = make(1);
    c.seed += offset; c.reset();
    putRovOnShelf(r, SHELF[0] + 0.3, SHELF[2] + 0.3);
    let contacts = 0, top = 0;
    for (let i = 0; i < 60 * 60; i++) {
      let err = Math.atan2(c.y - r.y, c.x - r.x) - r.yaw;
      err = ((err + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      r.set_cmd("t1", Math.max(-1, Math.min(1, 1 - 1.5 * err))); r.set_cmd("t2", Math.max(-1, Math.min(1, 1 + 1.5 * err)));
      r.step(DT);
      if (c.pushed) contacts++;
      top = Math.max(top, c.speed);
      assert.ok(insideShelf(c));
    }
    assert.ok(contacts > 0, `offset ${offset}: the ROV never got to the crab in a minute`);
    assert.ok(top <= Crab.SCUTTLE + 1e-9);
  }
});

test("the crab scuttles away when the ROV gets close, and not before", () => {
  const [r, [c]] = make();
  c.x = 1.8; c.y = 3.0; c.timer = 1e9;
  putRovOnShelf(r, 1.8, 2.0);
  for (let i = 0; i < 30; i++) r.step(DT);
  assert.equal(c.mode, "pause", `it should not mind a ROV that far away (${c.mode}, gap ${c.gap.toFixed(2)})`);
  r.x = 1.8; r.y = 2.7;
  for (let i = 0; i < 120; i++) { r.step(DT); r.x = 1.8; r.y = 2.7; r.u = r.v = 0.0; }
  assert.ok(c.mode === "scuttle" || c.gap > Crab.SCARE_AT, "a close ROV should send it scuttling");
  assert.ok(c.y >= 3.0 - 1e-6, "it should move away from the ROV, not toward it");
});

test("the crab stays inside the shallow end even when shoved hard", () => {
  const [r, [c]] = make();
  for (const [cx, cy] of [[SHELF[1] - 0.2, SHELF[3] - 0.2], [SHELF[0] + 0.2, SHELF[3] - 0.2], [SHELF[1] - 0.2, SHELF[2] + 0.2]]) {
    c.x = cx; c.y = cy; c.timer = 1e9;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      putRovOnShelf(r, c.x - Math.cos(heading) * 0.7, c.y - Math.sin(heading) * 0.7, heading);
      r.u = r.v = 0.0;
      r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0);
      for (let i = 0; i < 60 * 3; i++) { r.step(DT); assert.ok(insideShelf(c), `pushed out of the shallow end: (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`); }
      r.set_cmd("t1", 0.0); r.set_cmd("t2", 0.0);
    }
  }
});

test("the Pushable base class works on its own (a rock that never moves by itself)", () => {
  class Rock extends Pushable { constructor(x, y) { super(x, y); this.type = "rock"; } }
  const r = new Rov({ buoyancy: 0.0, tool: "nose" });
  const rock = new Rock(1.8, 2.6);
  r.props.push(rock);
  putRovOnShelf(r, 0.9, 2.6);
  r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0);
  for (let i = 0; i < 60 * 5; i++) r.step(DT);
  assert.ok(rock.x > 2.0, `the rock should have been pushed along (x=${rock.x.toFixed(2)})`);
  assert.equal(rock.state().type, "rock");
  assert.ok(SHELF[0] <= rock.x && rock.x <= SHELF[1]);
  r.reset();
  assert.deepEqual([rock.x, rock.y], [1.8, 2.6], "Reset puts it back");
});

test("Reset puts the crabs back, two crabs start apart, and the state is plain data", () => {
  const [r] = make(2);
  r.x = -2.5; r.y = -1.0;
  const first = r.props.map((p) => [p.x, p.y]);
  for (let i = 0; i < 60 * 30; i++) r.step(DT);
  r.reset();
  assert.deepEqual(r.props.map((p) => [p.x, p.y]), first);
  assert.notDeepEqual(first[0].map((v) => +v.toFixed(3)), first[1].map((v) => +v.toFixed(3)), "two crabs start in different places");
  const crabs = JSON.parse(JSON.stringify(r.state())).props.filter((p) => p.type === "crab");
  assert.equal(crabs.length, 2);
  for (const k of ["x", "y", "depth", "yaw", "speed", "moving", "color", "r"]) assert.ok(k in crabs[0], `missing ${k}`);
});

test("crabs coexist with rings and fish, and everything runs at 60 Hz", () => {
  const r = new Rov({ buoyancy: 0.0, tool: "claw" });
  addRings(r, 3); addFish(r, 1); addCrabs(r, 3);
  putRovOnShelf(r, 1.0, 2.0);
  const t = performance.now();
  for (let i = 0; i < 600; i++) { r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT); }
  const ms = (performance.now() - t) / 600;
  assert.ok(ms < 5.0, `${ms.toFixed(2)} ms per step is too slow for 60 Hz`);
  const types = r.state().props.map((p) => p.type);
  assert.equal(types.filter((x) => x === "ring").length, 3);
  assert.equal(types.filter((x) => x === "fish").length, 1);
  assert.equal(types.filter((x) => x === "crab").length, 3);
});
