// help.md is the student-facing documentation of the page. These tests keep it honest: if the code changes and the help does not, they fail.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, outline } from "../../mdrender.js";
import { CHANNELS, DeviceLink } from "../devicelink.js";
import { World } from "../world.js";
import { SWITCHES } from "../../controls.js";
import { CONFIG_KEYS, CONTROL_MODES, LIMITS } from "../../config.js";

const md = readFileSync(new URL("../../help.md", import.meta.url), "utf8");
const html = render(md);

test("every reading the pool can send is documented (with its s: line and its m: line)", () => {
  for (const name of Object.keys(CHANNELS)) {
    assert.ok(md.includes(`\`s:${name}\``), `help.md does not mention s:${name}`);
    assert.ok(md.includes(`m:${name},`), `help.md does not show an m:${name}, line`);
  }
});

test("every command the board can send is documented", () => {
  for (const name of ["t1", "t2", "t3", "t4", "claw", "tool", "reset"]) assert.ok(md.includes(`\`p:${name},`), `help.md does not document p:${name}`);
});

test("the documented limits match the code", async () => {
  const dl = await import("../devicelink.js");
  assert.ok(md.includes(`${dl.MAX_LINE} bytes`), "line length");
  assert.ok(md.includes(`${dl.SUB_TTL_MS / 1000} s`), "subscription lifetime");
  assert.ok(md.includes("115200"), "baud rate");
});

test("the switches and keys the help names are the ones in controls.js", () => {
  const keyText = { Digit1: "`1`", Digit2: "`2`", ArrowLeft: "left arrow", ArrowRight: "right arrow", ArrowUp: "up arrow", ArrowDown: "down arrow" };
  for (const s of SWITCHES) for (const k of [s.minus, s.plus]) assert.ok(md.includes(keyText[k]), `help.md does not mention ${k}`);
  for (const w of ["red", "green", "up / down", "`H`", "`T`", "`B`", "`V`", "`X`", "`N`"]) assert.ok(md.includes(w), `help.md does not mention ${w}`);
});

test("every internal link points at a heading that exists", () => {
  const ids = new Set(outline(md).map((h) => h.id).concat(["top"]));
  for (const [, id] of md.matchAll(/\]\(#([\w-]+)\)/g)) assert.ok(ids.has(id), `link to #${id} has no heading`);
  assert.ok(ids.has("microcontrollers"), "the serial button points at #microcontrollers");
});

test("every example line in the help is understood by the real protocol code", () => {
  const world = new World(), link = new DeviceLink(world);
  const quoted = [...md.matchAll(/["`]((?:p|s):[a-z0-9_]+(?:,[^"`]*)?)["`]/g)].map((m) => m[1]).filter((l) => !l.endsWith(","));   // ("p:t1," + str(power) is built at run time)
  assert.ok(quoted.length >= 10, `expected many example lines, found ${quoted.length}`);
  for (const line of quoted) assert.ok(link.onLine(line, 0), `the example line ${JSON.stringify(line)} is not understood`);
  for (const line of ["p:t1,1", "p:t1,-1", "p:t1,0"]) assert.ok(link.onLine(line, 0), line);       // what the first program builds
});

test("it renders cleanly: a title, no raw HTML, no leftovers", () => {
  assert.match(html, /<h1 id="top">ROV Pool help<\/h1>/);
  assert.ok(!/<script|undefined|\[object/i.test(html));
  assert.ok((html.match(/<table>/g) || []).length >= 5);
  assert.ok((html.match(/<pre>/g) || []).length >= 2);
});

test("every page option in config.js is documented, with its values and limits", () => {
  for (const k of CONFIG_KEYS) assert.ok(md.includes(`\`${k}=`), `help.md does not document ${k}=`);
  assert.ok(md.includes("`config`"), "help.md does not document ?config");
  for (const m of CONTROL_MODES) assert.ok(md.includes(`controls=${m}`), `help.md does not show controls=${m}`);
  assert.ok(md.includes(`\`rings=${LIMITS.rings[0]}\` to \`${LIMITS.rings[1]}\``), "rings limits");
  assert.ok(md.includes(`poollength=${LIMITS.poollength[0]}\` or \`${LIMITS.poollength[1]}`), "poollength limits");
  assert.ok(md.includes(`poolwidth=${LIMITS.poolwidth[0]}\`, \`2\` or \`${LIMITS.poolwidth[1]}`), "poolwidth limits");
});

test("the example addresses in the help are read back as written", async () => {
  const { parseConfig } = await import("../../config.js");
  const c = parseConfig("?controls=h&rings=2&poollength=2");
  assert.deepEqual([c.controls, c.rings, c.poollength], ["h", 2, 2]);
  assert.ok(md.includes("?controls=h&rings=2&poollength=2"), "the worked example moved");
  assert.ok(html.includes('href="index.html?config"'), "the Set up the pool link must survive rendering");
});

test("the help describes the IMU panel and the Current button", () => {
  for (const w of ["**IMU**", "accelerometer", "gyro", "**Config**", "Run the water", "main pool size", "current=on", "`J`", "flow=", "right away", "restart"]) assert.ok(md.includes(w), `help.md does not mention ${w}`);
});

test("the keys the help gives for Shift and Space match controls.js (Shift forward, Space reverse; R / F up and down)", async () => {
  assert.ok(md.includes("`W` or Shift / `S` or Space"), "the help says W or Shift is forward and S or Space is reverse");
  assert.ok(!/R.{0,12}Space/.test(md) && !/F.{0,12}Shift/.test(md.replace("W` or Shift", "")), "the old up/down meaning of Space and Shift is gone from the help");
  const { computeCommand } = await import("../../controls.js");
  const f = computeCommand(new Set(["ShiftLeft"]), [0, 0, 0], 0), r = computeCommand(new Set(["Space"]), [0, 0, 0], 0);
  assert.ok(f.t1 > 0 && f.t2 > 0 && f.t3 === 0, "Shift drives forward");
  assert.ok(r.t1 < 0 && r.t2 < 0 && r.t4 === 0, "Space drives in reverse");
});
