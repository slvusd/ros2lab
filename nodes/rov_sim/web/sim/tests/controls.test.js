// controls.js: keys and the switch box -> thruster commands. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { computeCommand, switchValues, SWITCHES, GAME_KEYS } from "../../controls.js";

const cmd = (keys = [], pointer = [0, 0, 0], claw = 0) => computeCommand(new Set(keys), pointer, claw);

test("the keyboard behaves as before", () => {
  assert.deepEqual(cmd(), { t1: 0, t2: 0, t3: 0, t4: 0, claw: 0 });
  assert.deepEqual(cmd(["KeyW"]), { t1: 0.8, t2: 0.8, t3: 0, t4: 0, claw: 0 });
  assert.deepEqual(cmd(["KeyD"]), { t1: 0.8, t2: -0.8, t3: 0, t4: 0, claw: 0 }, "D turns right: left thruster forward");
  assert.deepEqual(cmd(["KeyR"]), { t1: 0, t2: 0, t3: 0.8, t4: 0.8, claw: 0 });
  assert.deepEqual(cmd(["KeyI"]), { t1: 0, t2: 0, t3: 0.8, t4: -0.8, claw: 0 }, "I trims the nose up");
  assert.equal(cmd([], [0, 0, 0], 0.5).claw, 0.5);
});

test("each switch drives its own thruster(s) at FULL power, like an H-bridge", () => {
  assert.deepEqual(cmd(["Digit2"]), { t1: 1, t2: 0, t3: 0, t4: 0, claw: 0 });          // 2 = left forward
  assert.deepEqual(cmd(["Digit1"]), { t1: -1, t2: 0, t3: 0, t4: 0, claw: 0 });         // 1 = left reverse
  assert.deepEqual(cmd(["Equal"]), { t1: 0, t2: 1, t3: 0, t4: 0, claw: 0 });           // = right forward
  assert.deepEqual(cmd(["Minus"]), { t1: 0, t2: -1, t3: 0, t4: 0, claw: 0 });          // - right reverse
  assert.deepEqual(cmd(["Period"]), { t1: 0, t2: 0, t3: 1, t4: 1, claw: 0 });          // . up
  assert.deepEqual(cmd(["Semicolon"]), { t1: 0, t2: 0, t3: -1, t4: -1, claw: 0 });     // ; down
});

test("both keys of a pair cancel; the three switches are independent", () => {
  assert.deepEqual(switchValues(new Set(["Digit1", "Digit2"])), [0, 0, 0]);
  assert.deepEqual(switchValues(new Set(["Digit2", "Minus", "Period"])), [1, -1, 1]);
  assert.deepEqual(cmd(["Digit2", "Minus", "Period"]), { t1: 1, t2: -1, t3: 1, t4: 1, claw: 0 });
});

test("the mouse switch wins over keys, and a switch only overrides its own thrusters", () => {
  assert.deepEqual(cmd(["KeyW"], [0, 0, 0]), { t1: 0.8, t2: 0.8, t3: 0, t4: 0, claw: 0 });
  assert.deepEqual(cmd(["KeyW"], [-1, 0, 0]), { t1: -1, t2: 0.8, t3: 0, t4: 0, claw: 0 }, "left switch reverse, W still drives the right thruster");
  assert.deepEqual(cmd(["Digit2"], [-1, 0, 0]).t1, -1, "the mouse beats the key");
  assert.deepEqual(cmd(["KeyI"], [0, 0, 1]), { t1: 0, t2: 0, t3: 1, t4: 1, claw: 0 }, "up switch overrides the trim keys");
});

test("every switch key is a game key (so the page grabs it) and none clashes with another control", () => {
  const keys = SWITCHES.flatMap((s) => [s.minus, s.plus]);
  assert.equal(new Set(keys).size, 6);
  for (const k of keys) assert.ok(GAME_KEYS.has(k), k);
  for (const k of keys) assert.ok(!["KeyV", "KeyB", "KeyT", "KeyH", "KeyX"].includes(k), `${k} clashes`);
});
