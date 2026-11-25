// controls.js — turns held keys and the on-screen switch box into thruster commands. No DOM, so it is tested in Node.
//
// THE SWITCH BOX imitates the controller most scout ROVs use: three momentary DPDT switches (on-off-on, spring back to centre)
// wired through H-bridges, so each is full reverse, off, or full forward, with no in-between.
//   switch 1 = left thruster t1    keys 1 (reverse)  2 (forward)
//   switch 2 = right thruster t2   keys - (reverse)  = (forward)
//   switch 3 = both vertical t3+t4 keys ; (down)     . (up)
// Rule for the keys: the left key of each pair is the "minus" direction, the right key the "plus" direction.
// To change a key, edit SWITCHES below (and the help text in index.html).
export const SWITCHES = [
  { name: "L", thrusters: ["t1"], minus: "Digit1", plus: "Digit2", minusLabel: "1", plusLabel: "2", title: "left thruster" },
  { name: "R", thrusters: ["t2"], minus: "Minus", plus: "Equal", minusLabel: "-", plusLabel: "=", title: "right thruster" },
  { name: "Up/Down", thrusters: ["t3", "t4"], minus: "Semicolon", plus: "Period", minusLabel: ";", plusLabel: ".", title: "up / down" },
];

export const SWITCH_KEYS = SWITCHES.flatMap((s) => [s.minus, s.plus]);
export const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyF", "KeyZ", "KeyC", "KeyI", "KeyK",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight",
  "BracketLeft", "BracketRight", ...SWITCH_KEYS]);
export const POWER = 0.8;                         // keyboard power (the switches always give full power, like an H-bridge)

/** Each switch as -1 / 0 / +1. The mouse (`pointer`, one value per switch) wins over the keys; both keys of a pair cancel out. */
export function switchValues(held, pointer = [0, 0, 0]) {
  return SWITCHES.map((s, i) => pointer[i] || ((held.has(s.plus) ? 1 : 0) - (held.has(s.minus) ? 1 : 0)));
}

/** The command for the sim: {t1..t4, claw}. A switch that is pushed overrides the keyboard for ITS thrusters only. */
export function computeCommand(held, pointer, clawCmd = 0, power = POWER) {
  const k = (c) => (held.has(c) ? 1 : 0);
  const fwd = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown");
  const turn = k("KeyD") + k("ArrowRight") - k("KeyA") - k("ArrowLeft");   // + = turn right
  const up = k("KeyR") + k("Space") - k("KeyF") - k("ShiftLeft") - k("ShiftRight");
  const trim = k("KeyI") - k("KeyK");                                       // + = nose up: front pushes up, rear down
  const c = (v) => Math.max(-1, Math.min(1, v)) * power;
  const cmd = { t1: c(fwd + turn + k("KeyZ")), t2: c(fwd - turn + k("KeyC")), t3: c(up + trim), t4: c(up - trim), claw: Math.round(clawCmd * 100) / 100 };
  switchValues(held, pointer).forEach((v, i) => { if (v) for (const t of SWITCHES[i].thrusters) cmd[t] = v; });
  return cmd;
}
