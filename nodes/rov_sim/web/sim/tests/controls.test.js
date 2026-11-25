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
  for (const n of [6, 8]) {
    const f = c(["KeyW"], n);
    assert.deepEqual([f.t1, f.t2, f.t3, f.t4], [0.8, 0.8, 0.8, 0.8]);
    const d = c(["KeyD"], n);
    assert.deepEqual([d.t1, d.t2, d.t3, d.t4], [0.8, -0.8, 0.8, -0.8]);          // turn right: the left pair forward, the right pair back
    const e = c(["KeyE"], n);
    assert.deepEqual([e.t1, e.t2, e.t3, e.t4], [0.8, -0.8, -0.8, 0.8]);          // slide right: the diagonals
    const ni = c(["KeyI"], n);
    if (n === 6) { assert.equal(c(["KeyR"], n).t5, 0.8); assert.equal(c(["KeyR"], n).t6, 0.8); assert.ok(ni.t5 > 0 && ni.t6 < 0); }   // nose up: the front pushes up, the rear down
    else assert.deepEqual([ni.t1, ni.t3, ni.t5, ni.t7], [0.8, -0.8, -0.8, 0.8]);                                                       // (top front and bottom rear push up)
  }
  const r = c(["KeyO"], 8);                                                       // roll: the left top and right bottom push one way, the other two the other
  assert.deepEqual([r.t1, r.t2, r.t3, r.t4, r.t5, r.t6, r.t7, r.t8], [0.8, -0.8, 0.8, -0.8, -0.8, 0.8, -0.8, 0.8]);
  const e8 = c(["KeyE"], 8), d8 = c(["KeyD"], 8);
  assert.deepEqual([e8.t1, e8.t2, e8.t3, e8.t4, e8.t5], [0.8, -0.8, -0.8, 0.8, 0.8]);
  assert.deepEqual([d8.t1, d8.t2, d8.t3, d8.t4, d8.t6], [0.8, -0.8, 0.8, -0.8, -0.8]);
  const u8 = c(["KeyR"], 8);                                                       // up: the top ones up, the bottom ones down, with a little nose trim: none above 0.8
  assert.ok(u8.t1 > 0 && u8.t5 < 0 && Math.max(...Object.entries(u8).filter(([k]) => k !== "claw").map(([, v]) => Math.abs(v))) <= 0.8 + 1e-12);
  assert.ok(Math.abs(u8.t1 + u8.t4 - 2 * 0.8 * (2 - Math.SQRT2)) < 1e-9, "front and rear differ by the trim");
  assert.equal("t7" in c([], 6), false);
  assert.deepEqual(Object.keys(c([], 8)).filter((k) => k !== "claw"), ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
  assert.deepEqual(switchTargets(8)[0], ["t1", "t3", "t5", "t7"]);
  const sw = computeCommand(new Set(["Digit2", "ArrowRight", "ArrowUp"]), [0, 0, 0], 0, { thrusters: 6, hOnly: true });   // the switches at full power
  assert.deepEqual([sw.t1, sw.t3, sw.t2, sw.t4, sw.t5, sw.t6], [1, 1, 1, 1, 1, 1]);
  const sw8 = computeCommand(new Set(["Digit2", "ArrowRight"]), [0, 0, 0], 0, { thrusters: 8, hOnly: true });
  assert.deepEqual(Object.keys(sw8).filter((k) => sw8[k] === 1).sort(), ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"], "red and green drive the left and right columns (top and bottom)");
});

test("3 thrusters: one vertical thruster (t3) takes R/F, there is no t4 and no trim", async () => {
  const { computeCommand } = await import("../../controls.js");
  const c = computeCommand(new Set(["KeyR", "KeyI"]), [0, 0, 0], 0, { thrusters: 3 });
  assert.equal(c.t3, 0.8); assert.equal("t4" in c, false);
  const sw = computeCommand(new Set(["ArrowUp"]), [0, 0, 0], 0, { thrusters: 3, hOnly: true });
  assert.equal(sw.t3, 1); assert.equal("t4" in sw, false);
});
