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

test("the Current button's setCurrent puts the water outlets in and takes them out again, and does nothing twice", () => {
  const jets = () => b.link.world.state().props.filter((p) => p.type === "jets").length;
  assert.equal(jets(), 0, "off at the start (no ?current=on)");
  b.setCurrent(true); assert.equal(jets(), 1);
  b.setCurrent(true); assert.equal(jets(), 1, "turning it on twice does not add a second pair");
  b.setCurrent(false); assert.equal(jets(), 0);
  b.setCurrent(false); assert.equal(jets(), 0);
  b.setCurrent(true);
  b.reset();
  assert.equal(jets(), 1, "Reset does not remove the jets");
});
