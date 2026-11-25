// help.md is the student-facing documentation of the page. These tests keep it honest: if the code changes and the help does not, they fail.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render, outline } from "../../mdrender.js";
import { CHANNELS, DeviceLink } from "../devicelink.js";
import { World } from "../world.js";
import { SWITCHES } from "../../controls.js";

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
  for (const w of ["red", "green", "up / down", "`H`", "`T`", "`B`", "`V`", "`X`"]) assert.ok(md.includes(w), `help.md does not mention ${w}`);
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
