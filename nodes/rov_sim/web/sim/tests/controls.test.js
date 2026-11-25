// controls.js: keys and the switch box -> thruster commands. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { computeCommand, switchValues, SWITCHES, GAME_KEYS } from "../../controls.js";

const cmd = (keys = [], pointer = [0, 0, 0], claw = 0, opts = {}) => computeCommand(new Set(keys), pointer, claw, opts);
const T = (t1, t2, t3, t4, claw = 0) => ({ t1, t2, t3, t4, claw });

test("the extra keyboard keys (non-H mode) mix the thrusters at 80%", () => {
  assert.deepEqual(cmd(), T(0, 0, 0, 0));
  assert.deepEqual(cmd(["KeyW"]), T(0.8, 0.8, 0, 0));
  assert.deepEqual(cmd(["KeyS"]), T(-0.8, -0.8, 0, 0));
  assert.deepEqual(cmd(["KeyD"]), T(0.8, -0.8, 0, 0), "D turns right: left thruster forward");
  assert.deepEqual(cmd(["KeyA"]), T(-0.8, 0.8, 0, 0));
  assert.deepEqual(cmd(["KeyR"]), T(0, 0, 0.8, 0.8));
  assert.deepEqual(cmd(["KeyF"]), T(0, 0, -0.8, -0.8));
  assert.deepEqual(cmd(["ShiftLeft"]), T(0.8, 0.8, 0, 0), "Shift = forward");
  assert.deepEqual(cmd(["ShiftRight"]), T(0.8, 0.8, 0, 0), "either Shift key");
  assert.deepEqual(cmd(["Space"]), T(-0.8, -0.8, 0, 0), "Space = reverse");
  assert.deepEqual(cmd(["Space", "KeyW"]), T(0, 0, 0, 0), "forward and reverse cancel");
  assert.deepEqual(cmd(["ShiftLeft", "KeyD"]), T(0.8, 0, 0, 0), "Shift + D: forward and turn right (the left thruster is clamped at full, the right one cancels)");
  assert.deepEqual(cmd(["KeyI"]), T(0, 0, 0.8, -0.8), "I trims the nose up");
  assert.deepEqual(cmd(["KeyZ"]), T(0.8, 0, 0, 0));
  assert.deepEqual(cmd(["KeyC"]), T(0, 0.8, 0, 0));
  assert.equal(cmd([], [0, 0, 0], 0.5).claw, 0.5);
});

test("red: keys 1 (reverse) and 2 (forward), green: arrows left / right, up/down: arrows down / up, all at FULL power", () => {
  assert.deepEqual(cmd(["Digit2"]), T(1, 0, 0, 0));
  assert.deepEqual(cmd(["Digit1"]), T(-1, 0, 0, 0));
  assert.deepEqual(cmd(["ArrowRight"]), T(0, 1, 0, 0));
  assert.deepEqual(cmd(["ArrowLeft"]), T(0, -1, 0, 0));
  assert.deepEqual(cmd(["ArrowUp"]), T(0, 0, 1, 1));
  assert.deepEqual(cmd(["ArrowDown"]), T(0, 0, -1, -1));
});

test("the arrow keys no longer drive forward / turn", () => {
  for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    const c = cmd([k]);
    assert.ok(c.t1 === 0 || c.t2 === 0, `${k} must move one switch only, got ${JSON.stringify(c)}`);
  }
  assert.deepEqual(cmd(["ArrowUp"]), T(0, 0, 1, 1), "up is only the up/down switch, not 'forward'");
});

test("H-bridge only mode: the extra keys do nothing, the switches still work", () => {
  const h = { hOnly: true };
  for (const k of ["KeyW", "KeyS", "KeyA", "KeyD", "KeyR", "KeyF", "KeyZ", "KeyC", "KeyI", "KeyK", "Space", "ShiftLeft"]) assert.deepEqual(cmd([k], [0, 0, 0], 0, h), T(0, 0, 0, 0), k);
  assert.deepEqual(cmd(["Digit2", "ArrowLeft", "ArrowUp", "KeyW"], [0, 0, 0], 0, h), T(1, -1, 1, 1));
  assert.equal(cmd([], [0, 0, 0], 0.5, h).claw, 0.5, "the claw is not an H-bridge: it still works");
});

test("both keys of a pair cancel; the three switches are independent", () => {
  assert.deepEqual(switchValues(new Set(["Digit1", "Digit2"])), [0, 0, 0]);
  assert.deepEqual(switchValues(new Set(["ArrowLeft", "ArrowRight"])), [0, 0, 0]);
  assert.deepEqual(switchValues(new Set(["Digit2", "ArrowLeft", "ArrowUp"])), [1, -1, 1]);
  assert.deepEqual(cmd(["Digit2", "ArrowLeft", "ArrowUp"]), T(1, -1, 1, 1));
});

test("the mouse switch wins over keys, and a switch only overrides its own thrusters", () => {
  assert.deepEqual(cmd(["KeyW"], [-1, 0, 0]), T(-1, 0.8, 0, 0), "red switch reverse, W still drives the green thruster");
  assert.equal(cmd(["Digit2"], [-1, 0, 0]).t1, -1, "the mouse beats the key");
  assert.deepEqual(cmd(["KeyI"], [0, 0, 1]), T(0, 0, 1, 1), "the up switch overrides the trim keys");
});

test("every switch key is a game key (so the page grabs it) and none clashes with another control", () => {
  const keys = SWITCHES.flatMap((s) => [s.minus, s.plus]);
  assert.equal(new Set(keys).size, 6);
  for (const k of keys) assert.ok(GAME_KEYS.has(k), k);
  for (const k of keys) assert.ok(!["KeyV", "KeyB", "KeyT", "KeyH", "KeyX", "BracketLeft", "BracketRight"].includes(k), `${k} clashes`);
  assert.ok(GAME_KEYS.has("BracketLeft") && GAME_KEYS.has("BracketRight"), "[ ] still move the claw");
});
