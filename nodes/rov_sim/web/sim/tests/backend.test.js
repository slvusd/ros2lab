// The browser backend (backend-local.js) imported in Node: what the page is told it can do, and the live Current toggle. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";

const b = await import("../../backend-local.js");

test("the browser version reports the IMU (the panel), the claw, rings, crabs and the current as available, and no joysticks", () => {
  assert.equal(b.features.imu, true);
  assert.equal(b.features.claw, true);
  assert.equal(b.features.rings, true);
  assert.equal(b.features.crabs, true);
  assert.equal(b.features.current, true, "available (the Current button), even when it starts off");
  assert.equal(b.features.joys, false);
});

test("the outlets are always in the wall; the Current button's setCurrent only starts and stops the water", () => {
  const jets = () => b.link.world.state().props.filter((p) => p.type === "jets");
  assert.equal(jets().length, 1, "the two outlets are in the wall even though the water is off (no ?current=on)");
  assert.equal(jets()[0].on, false);
  assert.equal(jets()[0].outlets.length, 2);
  assert.deepEqual(b.link.world.rov._water(), [0, 0, 0], "no water moving while it is off");
  b.setCurrent(true);  assert.equal(jets().length, 1); assert.equal(jets()[0].on, true);
  b.setCurrent(true);  assert.equal(jets().length, 1, "turning it on twice does not add a second pair");
  b.setCurrent(false); assert.equal(jets().length, 1, "the outlets stay"); assert.equal(jets()[0].on, false);
  b.setCurrent(true);
  b.reset();
  assert.equal(jets()[0].on, true, "Reset does not turn the water off");
});

test("the Pool button's setPoolSize resizes the main pool and puts everything back inside it (and back again)", () => {
  const world = b.link.world, DT = 1 / 60;
  const mainOf = () => world.state().regions.reduce((a, c) => (c[4] > a[4] ? c : a));
  const inPool = (x, y) => world.state().regions.some((r) => r[0] - 1e-6 <= x && x <= r[1] + 1e-6 && r[2] - 1e-6 <= y && y <= r[3] + 1e-6);
  assert.equal(typeof b.setPoolSize, "function");
  for (const [L, W] of [[2, 3], [1, 2], [2, 1], [1, 1]]) {
    world.rov.x = 2.5; world.rov.y = 0.3;                              // somewhere else, to see that it is put back
    b.setPoolSize(L, W);
    const m = mainOf(), s = world.state();
    assert.equal(m[1] - m[0], 6 * L, `${L}x${W}: length`);
    assert.equal(m[3] - m[2], 3 * W, `${L}x${W}: width`);
    assert.equal(s.x, -1.5); assert.equal(s.y, 0, "the ROV is back at the start");
    const jets = s.props.find((p) => p.type === "jets");
    assert.ok(jets.outlets.every((o) => o.y === m[3]), `${L}x${W}: the outlets moved to the new side wall`);
    for (let i = 0; i < 60 * 20; i++) world.advance(i * 16.7);          // let everything move for a while
    for (const p of world.state().props.filter((q) => ["ring", "fish", "crab"].includes(q.type))) assert.ok(inPool(p.x, p.y), `${L}x${W}: a ${p.type} is outside the pool at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  }
  const m = mainOf();
  assert.deepEqual([m[0], m[1], m[2], m[3]], [-3, 3, -1.5, 1.5], "back to the normal pool");
});
