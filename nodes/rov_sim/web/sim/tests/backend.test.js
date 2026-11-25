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
