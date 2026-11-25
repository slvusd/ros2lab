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

test("6 and 8 thrusters: W drives all four posts, A/D turn, Q/E slide, and the vertical ones take R/F, I/K (and U/O with 8)", async () => {
  const { computeCommand, switchTargets } = await import("../../controls.js");
  const c = (keys, n, o = {}) => computeCommand(new Set(keys), [0, 0, 0], 0, { thrusters: n, ...o });
  for (const n of [6]) {
    const f = c(["KeyW"], n);
    assert.deepEqual([f.t1, f.t2, f.t3, f.t4], [0.8, 0.8, 0.8, 0.8]);
    const d = c(["KeyD"], n);
    assert.deepEqual([d.t1, d.t2, d.t3, d.t4], [0.8, -0.8, 0.8, -0.8]);          // turn right: the left pair forward, the right pair back
    const e = c(["KeyE"], n);
    assert.deepEqual([e.t1, e.t2, e.t3, e.t4], [0.8, -0.8, -0.8, 0.8]);          // slide right: the diagonals
    const ni = c(["KeyI"], n);
    assert.equal(c(["KeyR"], n).t5, 0.8); assert.equal(c(["KeyR"], n).t6, 0.8); assert.ok(ni.t5 > 0 && ni.t6 < 0);       // nose up: the front pushes up, the rear down
  }
  // 8 corner thrusters (t1-t4 top, t5-t8 bottom; front left, front right, rear left, rear right): every movement is one sign pattern
  const pat = (keys) => { const v = c(keys, 8); return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v["t" + i] / 0.8); };
  assert.deepEqual(pat(["KeyW"]), [1, 1, -1, -1, 1, 1, -1, -1], "forward: the front ones push ahead, the (mirrored) rear ones push back");
  assert.deepEqual(pat(["KeyE"]), [1, -1, 1, -1, 1, -1, 1, -1], "slide right");
  assert.deepEqual(pat(["KeyD"]), [1, -1, -1, 1, 1, -1, -1, 1], "turn right");
  assert.deepEqual(pat(["KeyR"]), [1, 1, 1, 1, -1, -1, -1, -1], "up: the top ones up, the bottom ones down");
  assert.deepEqual(pat(["KeyI"]), [1, 1, -1, -1, -1, -1, 1, 1], "nose up");
  assert.deepEqual(pat(["KeyO"]), [1, -1, 1, -1, -1, 1, -1, 1], "roll right side down");
  assert.deepEqual(pat(["KeyZ"]), [1, 0, -1, 0, 1, 0, -1, 0], "left side only");
  assert.equal("t7" in c([], 6), false);
  assert.deepEqual(Object.keys(c([], 8)).filter((k) => k !== "claw"), ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
  assert.deepEqual(switchTargets(8)[0], ["t1", "t3", "t5", "t7"]);
  const sw = computeCommand(new Set(["Digit2", "ArrowRight", "ArrowUp"]), [0, 0, 0], 0, { thrusters: 6, hOnly: true });   // the switches at full power
  assert.deepEqual([sw.t1, sw.t3, sw.t2, sw.t4, sw.t5, sw.t6], [1, 1, 1, 1, 1, 1]);
  const sw8 = computeCommand(new Set(["Digit2", "ArrowRight"]), [0, 0, 0], 0, { thrusters: 8, hOnly: true });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => sw8["t" + i]), [1, 1, -1, -1, 1, 1, -1, -1], "red and green push the front ones ahead and the mirrored rear ones back: forward");
});

test("3 thrusters: one vertical thruster (t3) takes R/F, there is no t4 and no trim", async () => {
  const { computeCommand } = await import("../../controls.js");
  const c = computeCommand(new Set(["KeyR", "KeyI"]), [0, 0, 0], 0, { thrusters: 3 });
  assert.equal(c.t3, 0.8); assert.equal("t4" in c, false);
  const sw = computeCommand(new Set(["ArrowUp"]), [0, 0, 0], 0, { thrusters: 3, hOnly: true });
  assert.equal(sw.t3, 1); assert.equal("t4" in sw, false);
});
