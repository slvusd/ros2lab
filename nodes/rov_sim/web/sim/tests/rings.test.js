// Ring tests, ported from test_physics.py (bumping, picking up with the nose and the claw, carrying, the fish threading rings).
// Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS } from "../physics.js";
import { distanceToRov } from "../shape.js";
import { addTo as addRings, dropRing, MAX_RINGS } from "../rings.js";
import { addTo as addFish } from "../fishbrain.js";
import { Rng } from "../rng.js";

const DT = 1 / 60;
const run = (r, seconds, cmd = {}) => {
  for (const [k, v] of Object.entries(cmd)) r.set_cmd(k, v);
  for (let i = 0, n = Math.floor(seconds / DT); i < n; i++) r.step(DT);
  for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, 0);
};
function withProps(tool = "claw", { rings = 1, fish = 0, buoyancy = 0.0, ...kw } = {}) {
  const r = new Rov({ tool, buoyancy, ...kw });
  addRings(r, rings);
  if (fish) addFish(r, fish);
  return r;
}
const ringsOf = (r) => r.props.filter((p) => p.type === "ring");
const deg = (rad) => (rad * 180 / Math.PI).toFixed(1);

test("a ring is pushed, not passed through", () => {
  const r = withProps("claw", { speed: 2.0 });         // speed 2.0: as strong as the red / green thrusters were before their default was halved
  const [ring] = ringsOf(r);
  r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.6;
  ring.x = 0.9; ring.y = 0.0; ring.yaw = Math.PI / 2;
  run(r, 3, { t1: 0.6, t2: 0.6 });
  assert.ok(ring.x > 1.5 && ring.x > r.x, `ring ended at x=${ring.x.toFixed(2)} with the ROV at ${r.x.toFixed(2)}`);
});

test("catching a ring by its corner spins it the right way (mirrored hits spin opposite ways)", () => {
  const turns = [];
  for (const side of [+1, -1]) {
    const r = withProps("claw");
    const [ring] = ringsOf(r);
    r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.55;
    ring.x = 1.0; ring.y = 0.36 * side; ring.yaw = Math.PI / 2;
    const y0 = ring.yaw;
    run(r, 3.5, { t1: 0.5, t2: 0.5 });
    turns.push(ring.yaw - y0);
  }
  assert.ok(Math.abs(turns[0]) > 0.3 && Math.abs(turns[1]) > 0.3, `turns ${turns}`);
  assert.ok(turns[0] * turns[1] < 0, "mirrored hits should spin the ring in opposite directions");
});

test("the nose passing through the hole is not a collision", () => {
  const r = withProps("nose");
  const [ring] = ringsOf(r);
  r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.55;
  ring.x = 0.9; ring.y = 0.0; ring.yaw = Math.PI / 2;
  for (let i = 0, n = Math.floor(0.9 / DT); i < n; i++) { r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT); }
  assert.ok(Math.abs(ring.x - 0.9) < 0.01 && Math.abs(ring.y) < 0.01, "a nose passing cleanly through the hole moved the ring");
});

test("a pushed ring coasts, then stops", () => {
  const r = withProps("claw");
  const [ring] = ringsOf(r);
  r.x = -2.5; r.y = -1.0;
  ring.x = 0.0; ring.y = 0.0; ring.vx = 1.0;
  for (let i = 0; i < 60 * 3; i++) r.step(DT);
  const d3 = ring.x;
  for (let i = 0; i < 60 * 2; i++) r.step(DT);
  assert.ok(d3 > 0.1 && d3 < 0.5 && Math.abs(ring.x - d3) < 0.01, `coasted ${d3.toFixed(2)} m then moved ${(ring.x - d3).toFixed(3)} m more`);
});

test("a ring cannot be pushed through a wall", () => {
  const r = withProps("claw");
  const [ring] = ringsOf(r);
  r.x = 1.5; r.y = 0.0; r.yaw = 0.0; r.depth = 1.6;
  ring.x = 2.4; ring.y = 0.0;
  run(r, 5, { t1: 0.9, t2: 0.9 });
  assert.ok(ring.x + ring.R <= 3.0 + 1e-6 && r.x < 3.0, `ring x ${ring.x.toFixed(2)}, ROV x ${r.x.toFixed(2)}`);
});

test("nothing ends up inside the ROV", () => {
  const r = withProps("claw");
  const [ring] = ringsOf(r);
  r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.55;
  ring.x = 0.9; ring.y = 0.0; ring.yaw = 0.0;
  run(r, 3, { t1: 1.0, t2: 1.0 });
  const closest = Math.min(...ring._hoop().map((p) => distanceToRov(r, p)[0]));
  assert.ok(closest > ring.TUBE - 0.005, `ring overlaps the ROV by ${((ring.TUBE - closest) * 100).toFixed(1)} cm`);
});

test("rings do not overlap each other", () => {
  const r = withProps("claw", { rings: 2 });
  const [a, b] = ringsOf(r);
  a.x = 0.0; a.y = 0.0; b.x = 0.03; b.y = 0.0;
  a.yaw = b.yaw = Math.PI / 2;
  r.x = -2.5; r.y = -1.0;
  for (let i = 0; i < 120; i++) r.step(DT);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0.039, "rings still overlap");
});

test("the nose lifts and carries a ring, tilting the ROV", () => {
  const r = withProps("nose");
  const [ring] = ringsOf(r);
  r.x = ring.x - 0.60; r.y = ring.y; r.yaw = 0.0; r.depth = 1.55;
  run(r, 0.9, { t1: 0.5, t2: 0.5 });
  run(r, 0.5);
  assert.ok(ring.hooked, "nose did not hook the ring");
  run(r, 2.0, { t3: 0.7, t4: 0.7 });
  assert.ok(ring.hooked && ring.depth < 1.3, `ring did not lift (depth ${ring.depth.toFixed(2)})`);
  assert.ok(r.pitch > 0.07 && r.pitch < 0.14, `ROV did not tilt under the ring (${deg(r.pitch)} deg)`);
  run(r, 1.5, { t1: 0.5, t2: 0.5 });
  assert.ok(ring.hooked, "ring came off while being carried");
});

test("a ring stays on the nose through manoeuvres", () => {
  const rng = new Rng(4), uni = (a, b) => rng.uniform(a, b);
  for (let trial = 0; trial < 6; trial++) {
    const r = withProps("nose");
    const [ring] = ringsOf(r);
    r.x = -1.5; r.y = 0.0; r.yaw = 0.0;
    const hold = (target, extra = {}) => {
      const v = Math.max(-1, Math.min(1, -1.8 * (target - r.depth) - 0.6 * r.w - 0.15));
      r.set_cmd("t3", v); r.set_cmd("t4", v);
      for (const [k, val] of Object.entries(extra)) r.set_cmd(k, val);
      r.step(DT);
    };
    for (let i = 0; i < 60 * 8; i++) hold(1.62);
    while (!ring.hooked && r.x < 2.0) hold(1.62, { t1: 0.5, t2: 0.5 });
    for (let i = 0; i < 30; i++) hold(1.62);
    assert.ok(ring.hooked, `trial ${trial}: never hooked`);
    for (let i = 0; i < 60 * 3; i++) { r.set_cmd("t3", 0.8); r.set_cmd("t4", 0.8); r.step(DT); }
    let cmds = {};
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 90 === 0) cmds = { t1: uni(-0.6, 0.6), t2: uni(-0.6, 0.6), t3: uni(-0.2, 0.7), t4: uni(-0.2, 0.7) };
      for (const [k, v] of Object.entries(cmds)) r.set_cmd(k, v);
      r.step(DT);
      assert.ok(ring.hooked, `trial ${trial}: the ring slid off the nose after ${(i / 60).toFixed(0)} s of manoeuvring`);
    }
  }
});

test("the claw grabs, holds and releases a ring", () => {
  const r = withProps("claw");
  const [ring] = ringsOf(r);
  r.x = -1.0; r.y = 0.0; r.yaw = 0.0; r.depth = 1.5;
  ring.x = r.x + 0.5; ring.y = r.y - ring.R; ring.depth = r.depth + 0.25;
  r.claw = r.claw_target = 1.0;
  for (let i = 0; i < 20; i++) r.step(DT);
  r.claw_target = 0.0;
  for (let i = 0; i < 60; i++) r.step(DT);
  assert.ok(ring.held && r.claw_holder === ring, "claw did not grip the ring");
  run(r, 3, { t3: 0.6, t4: 0.6 });
  assert.ok(ring.held && ring.depth < 1.0, "ring did not come up with the ROV");
  r.claw_target = 1.0;
  for (let i = 0; i < 30; i++) r.step(DT);
  assert.ok(!ring.held && r.claw_holder === null, "claw did not let go");
});

test("the claw holds only one ring", () => {
  const r = withProps("claw", { rings: 2 });
  const [a, b] = ringsOf(r);
  r.x = -1.0; r.y = 0.0; r.yaw = 0.0; r.depth = 1.5;
  for (const ring of [a, b]) { ring.x = r.x + 0.5; ring.y = r.y - ring.R; ring.yaw = Math.PI / 2; ring.depth = r.depth + 0.25; }
  r.claw = r.claw_target = 1.0;
  for (let i = 0; i < 20; i++) r.step(DT);
  r.claw_target = 0.0;
  for (let i = 0; i < 60; i++) r.step(DT);
  assert.equal([a.held, b.held].filter(Boolean).length, 1, `held: ${[a.held, b.held]}`);
});

test("a ring is carried over the step to the shallow end and left there", () => {
  const r = withProps("nose");
  const [ring] = ringsOf(r);
  r.x = 1.8; r.y = -0.2; r.yaw = Math.PI / 2; r.depth = 1.55;
  ring.x = 1.8; ring.y = 0.4; ring.yaw = 0.0;
  run(r, 0.9, { t1: 0.5, t2: 0.5 });
  run(r, 0.5);
  run(r, 2.2, { t3: 0.7, t4: 0.7 });
  run(r, 1.0);
  run(r, 6.0, { t1: 0.5, t2: 0.5 });
  run(r, 1.0);
  assert.ok(ring.hooked && ring.y > 1.7, `ring not carried over the step (y=${ring.y.toFixed(2)}, hooked=${ring.hooked})`);
  run(r, 3.0, { t3: -0.4, t4: -0.4 });
  run(r, 1.5);
  run(r, 2.5, { t1: -0.6, t2: -0.6 });
  assert.ok(!ring.hooked && Math.abs(ring.depth - (1.0 - ring.R - ring.TUBE)) < 0.02, `ring depth ${ring.depth.toFixed(2)}`);
});

test("two rings on the nose tilt twice as much", () => {
  const r = withProps("nose", { rings: 2, speed: 2.0 });
  const [a, b] = ringsOf(r);
  a.x = 0.8; a.y = 0.0; a.yaw = Math.PI / 2;
  b.x = 1.5; b.y = 0.0; b.yaw = Math.PI / 2;
  r.x = -1.5; r.y = 0.0; r.yaw = 0.0; r.depth = 1.62;
  const hold = (extra) => {
    const v = Math.max(-1, Math.min(1, -1.8 * (1.62 - r.depth) - 0.6 * r.w));
    r.set_cmd("t3", v); r.set_cmd("t4", v);
    for (const [k, val] of Object.entries(extra)) r.set_cmd(k, val);
    r.step(DT);
  };
  for (let i = 0; i < 60 * 3; i++) hold({});
  for (let i = 0; i < 60 * 5; i++) hold({ t1: 0.4, t2: 0.4 });
  assert.ok(a.hooked && b.hooked, `hooked: ${a.hooked}, ${b.hooked}`);
  for (let i = 0; i < 60 * 3; i++) { r.set_cmd("t1", 0); r.set_cmd("t2", 0); r.set_cmd("t3", 0.8); r.set_cmd("t4", 0.8); r.step(DT); }
  for (let i = 0; i < 60; i++) r.step(DT);
  assert.ok(a.lifting && b.lifting, "the nose should be carrying both rings");
  assert.ok(r.pitch > 0.17 && r.pitch < 0.26, `two rings should tilt about 11 degrees, got ${deg(r.pitch)}`);
});

test("the fish threads the rings now and then", () => {
  const r = withProps("claw", { rings: 3, fish: 1 });
  const fish = r.props.find((p) => p.type === "fish");
  r.x = -2.5; r.y = -1.0; r.depth = 1.0; r.yaw = 0.0;
  let through = 0;
  const side = new Map();
  for (let i = 0; i < 60 * 600; i++) {
    r.step(DT);
    for (const ring of ringsOf(r)) {
      const nx = -Math.sin(ring.yaw), ny = Math.cos(ring.yaw);
      const sNow = (fish.x - ring.x) * nx + (fish.y - ring.y) * ny;
      const inHole = Math.hypot((fish.x - ring.x) * Math.cos(ring.yaw) + (fish.y - ring.y) * Math.sin(ring.yaw), fish.depth - ring.depth) < ring.R - ring.TUBE;
      if (side.has(ring) && side.get(ring) * sNow < 0 && inHole) through++;
      side.set(ring, sNow);
    }
  }
  assert.ok(through >= 3, `swam through a ring only ${through} times in 10 minutes`);
});

test("physics with rings and a fish runs fast enough for 60 Hz", () => {
  const r = withProps("claw", { rings: 3, fish: 1, buoyancy: 1.5 });
  r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.6;
  const t = performance.now();
  for (let i = 0; i < 600; i++) { r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT); }
  const ms = (performance.now() - t) / 600;
  assert.ok(ms < 5.0, `${ms.toFixed(2)} ms per step is too slow for 60 Hz`);
});

test("dropping a ring: it starts at the surface, sinks to the floor, every ring knows it, the pool holds at most 10", () => {
  const r = withProps("nose", { rings: 3 });
  r.x = -2.5; r.y = -1.0;
  const ring = dropRing(r, 0.0, 0.5);
  assert.ok(ring && r.props.includes(ring) && ring.transient);
  assert.ok(Math.abs(ring.depth - (ring.R + ring.TUBE)) < 1e-9, "starts at the surface");
  for (let i = 0; i < 60 * 2; i++) r.step(DT);
  assert.ok(ring.depth > ring.R + ring.TUBE && ring.depth < ring.floor, `after 2 s it is sinking (depth ${ring.depth.toFixed(2)})`);
  for (let i = 0; i < 60 * 14; i++) r.step(DT);
  assert.ok(Math.abs(ring.depth - ring.floor) < 1e-6, `ends on the floor (depth ${ring.depth.toFixed(2)}, floor ${ring.floor.toFixed(2)})`);
  assert.ok(ringsOf(r).every((p) => p.others.includes(ring)), "every ring must know the new one");
  let n = 0;
  while (dropRing(r, 0.0, -0.5 + 0.1 * n)) { n++; assert.ok(n < 50); }
  assert.equal(ringsOf(r).length, MAX_RINGS);
  assert.equal(MAX_RINGS, 10);
});

test("a dropped ring asked for outside the pool lands inside it; the state describes it like any ring", () => {
  const r = withProps("nose", { rings: 0 });
  const ring = dropRing(r, 50, 50);
  const [x, y] = [ring.x, ring.y];
  assert.ok(POOL_REGIONS.some((q) => q[0] <= x && x <= q[1] && q[2] <= y && y <= q[3]), `(${x}, ${y}) is outside the pool`);
  const st = r.state().props[0];
  assert.equal(st.type, "ring"); assert.ok("color" in st && "yaw" in st);
});

test("Reset removes dropped rings (and nothing keeps colliding with them)", () => {
  const r = withProps("nose", { rings: 3 });
  r.x = -2.5; r.y = -1.0;
  dropRing(r, 0.0, 0.0); dropRing(r, 0.1, 0.0);
  assert.equal(ringsOf(r).length, 5);
  r.reset();
  assert.equal(ringsOf(r).length, 3);
  assert.ok(r.props.every((p) => !p.transient));
  for (let i = 0; i < 120; i++) r.step(DT);                 // no ghost collisions, no errors
});

test("the ring cap is the same number as in the Python reference", async () => {
  const { readFileSync } = await import("node:fs");
  const py = readFileSync(new URL("../../../rov_props.py", import.meta.url), "utf8");
  assert.equal(Number(py.match(/^MAX_RINGS = (\d+)/m)[1]), MAX_RINGS);
});
