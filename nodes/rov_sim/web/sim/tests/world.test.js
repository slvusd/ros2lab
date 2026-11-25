// The browser's loop: commands from the page, fixed steps, reset, buoyancy button. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { World, DT } from "../world.js";

test("a keyboard command drives the ROV, and Reset puts it back", () => {
  const w = new World();
  w.advance(0);
  w.command({ t1: 0.8, t2: 0.8, t3: 0, t4: 0, claw: 0 });
  for (let ms = 16; ms <= 2000; ms += 16) w.advance(ms);
  assert.ok(w.state().x > -1.0, "did not move forward");
  assert.equal(w.state().t1, 0.8);
  w.reset();
  const s = w.state();
  assert.equal(s.x, -1.5); assert.equal(s.depth, 0.8); assert.equal(s.t1, 0);
});

test("a slow frame is capped (slow motion, not a freeze or a jump)", () => {
  const w = new World();
  w.advance(0);
  w.command({ t1: 1, t2: 1 });
  w.advance(10_000);                                    // a 10 s hiccup
  assert.ok(w.state().x < -1.5 + 4 * DT * 3, "caught up the whole hiccup in one go");
});

test("the Buoyancy button changes whether it floats", () => {
  const w = new World();
  w.setBuoyancy("negative");
  assert.ok(w.state().buoyancy < 0);
  w.setBuoyancy("nonsense");
  assert.ok(w.state().buoyancy < 0, "an unknown mode must be ignored");
});

test("state() has everything the page reads", () => {
  const s = new World().state();
  for (const k of ["x", "y", "depth", "yaw", "t1", "t2", "t3", "t4", "claw", "speed", "splash_n", "floor_n", "props", "tool", "pitch", "imu", "buoyancy", "regions", "keys", "ros", "joys", "joy_topics"])
    assert.ok(k in s, `missing ${k}`);
  assert.equal(s.tool, "nose");
});

test("the Tool button switches between claw and nose", () => {
  const w = new World();
  w.setTool("claw"); assert.equal(w.state().tool, "claw");
  w.setTool("nose"); assert.equal(w.state().tool, "nose");
  w.setTool("hook"); assert.equal(w.state().tool, "nose", "an unknown tool must be ignored");
});

test("the N key reaches the world: a ring appears, unless the rings add-on is missing", async () => {
  const { dropRing } = await import("../rings.js");
  const w = new World();
  assert.equal(w.dropRing(0, 0), null, "no rings add-on: nothing happens");
  w.ringDropper = dropRing;
  const ring = w.dropRing(0.5, 0.25);
  assert.ok(ring);
  assert.equal(w.state().props.filter((p) => p.type === "ring").length, 1);
});
