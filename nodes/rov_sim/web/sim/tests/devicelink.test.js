// The micro:bit / Pico link, tested with a fake device (no hardware, no browser). Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../world.js";
import { DeviceLink, LineSplitter, cleanName, SUB_TTL_MS, MIN_GAP_MS, MAX_LINE } from "../devicelink.js";

function rig() {
  const world = new World();
  const link = new DeviceLink(world);
  const sent = [];
  link.send = (line) => sent.push(line);
  return { world, link, sent };
}

test("p: lines drive the thrusters, claw, tool and reset", () => {
  const { world, link } = rig();
  assert.ok(link.onLine("p:t1,0.5", 0));
  assert.ok(link.onLine("p:t2,-0.25", 0));
  assert.ok(link.onLine("p:T3,9", 0));                       // name cleaned, value clamped
  assert.ok(link.onLine("p:t4,0", 0));
  const s = world.state();
  assert.deepEqual([s.t1, s.t2, s.t3, s.t4], [0.5, -0.25, 1, 0]);
  assert.ok(link.onLine("p:claw,1", 0));
  assert.equal(world.rov.claw_target, 1);
  assert.ok(link.onLine("p:tool,nose", 0));
  assert.equal(world.state().tool, "nose");
  world.rov.x = 2.0;
  assert.ok(link.onLine("p:reset,1", 0));
  assert.equal(world.state().x, -1.5);
  assert.equal(world.state().t1, 0, "reset clears the thrusters");
});

test("garbage is ignored and never moves anything", () => {
  const { world, link } = rig();
  for (const bad of ["hello", "boot v2.1", "p:t1", "p:t1,abc", "p:t1,", "p:,1", "p:t1,NaN", "p:tool,hook", "p:unknown,5", "s:", "m:depth,1", "p:t1,Infinity"]) {
    assert.equal(link.onLine(bad, 0), false, bad);
  }
  assert.equal(world.state().t1, 0);
  assert.equal(world.rov.claw_target, 0);
  assert.equal(link.stats.in, 0);
});

test("the line splitter handles CRLF, partial lines, noise and absurdly long lines", () => {
  const sp = new LineSplitter(40);
  assert.deepEqual(sp.feed("p:t1,0.5\r\np:t2,"), ["p:t1,0.5"]);
  assert.deepEqual(sp.feed("0.5\n\n  \ns:depth\n"), ["p:t2,0.5", "s:depth"]);
  assert.deepEqual(sp.feed("x".repeat(100) + "\np:t3,1\n"), ["p:t3,1"], "an overlong line is dropped and the next one is fine");
  assert.deepEqual(sp.feed("p:t4"), []);
  assert.deepEqual(sp.feed(",1\n"), ["p:t4,1"]);
});

test("cleanName matches the Python bridge", () => {
  assert.equal(cleanName("Bad Name!"), "bad_name_");
  assert.equal(cleanName(" T1 "), "t1");
  assert.equal(cleanName("9lives"), null);
  assert.equal(cleanName(""), null);
});

test("nothing is sent until the device subscribes; then one short line at a time, rate limited", () => {
  const { world, link, sent } = rig();
  assert.equal(link.tick(1000), null, "no subscription yet");
  link.onLine("s:depth", 1000); link.onLine("s:heading", 1000); link.onLine("s:accel", 1000); link.onLine("s:pitch", 1000);
  let now = 1000;
  for (let i = 0; i < 100; i++) { now += 10; link.tick(now); }       // a busy 1 second
  assert.ok(sent.length > 0 && sent.length <= Math.ceil(1000 / MIN_GAP_MS) + 1, `${sent.length} lines in a second`);
  for (const l of sent) { assert.ok(l.startsWith("m:"), l); assert.ok(l.length <= MAX_LINE, `${l} is ${l.length} bytes`); }
  const names = new Set(sent.map((l) => l.slice(2, l.indexOf(","))));
  assert.deepEqual([...names].sort(), ["accel", "depth", "heading", "pitch"], "every subscribed channel gets a turn");
  assert.ok(world.state());
});

test("values: depth in metres, heading 0..360 counter-clockwise, pitch in degrees (nose down +)", () => {
  const { world, link, sent } = rig();
  world.rov.depth = 1.234; world.rov.yaw = -Math.PI / 2; world.rov.pitch = 0.1;
  for (const n of ["depth", "heading", "pitch"]) link.onLine(`s:${n}`, 0);
  let now = 0;
  for (let i = 0; i < 40; i++) { now += 70; link.tick(now); }
  const get = (n) => sent.filter((l) => l.startsWith(`m:${n},`)).at(-1);
  assert.equal(get("depth"), "m:depth,1.23");
  assert.equal(get("heading"), "m:heading,270");
  assert.equal(get("pitch"), "m:pitch,5.7");
});

test("an unchanged value is not repeated every time, but is repeated now and then", () => {
  const { link, sent } = rig();
  link.onLine("s:depth", 0);
  let now = 0;
  for (let i = 0; i < 3000 / 70; i++) { now += 70; link.tick(now); }      // 3 seconds, nothing changing
  assert.ok(sent.length >= 2 && sent.length <= 4, `${sent.length} lines for an unchanged value in 3 s`);
});

test("a subscription lapses unless the device repeats it", () => {
  const { link, sent } = rig();
  link.onLine("s:depth", 0);
  link.tick(100);
  assert.equal(sent.length, 1);
  sent.length = 0;
  let now = SUB_TTL_MS + 1000;
  for (let i = 0; i < 20; i++) { now += 100; link.tick(now); }
  assert.equal(sent.length, 0, "still talking after the subscription lapsed");
  link.onLine("s:depth", now);
  link.tick(now + 100);
  assert.equal(sent.length, 1, "a repeated s: must revive it");
});

test("a subscription to a channel the sim does not have is understood but never answered", () => {
  const { link, sent } = rig();
  assert.equal(link.onLine("s:led", 0), true);
  for (let i = 1; i < 20; i++) link.tick(i * 100);
  assert.equal(sent.length, 0);
});

test("disconnecting zeroes the thrusters and stops all output", () => {
  const { world, link, sent } = rig();
  link.onLine("p:t1,1", 0); link.onLine("p:t2,1", 0); link.onLine("p:t3,-1", 0); link.onLine("s:depth", 0);
  link.disconnected();
  const s = world.state();
  assert.deepEqual([s.t1, s.t2, s.t3, s.t4], [0, 0, 0, 0]);
  for (let i = 1; i < 20; i++) link.tick(i * 100);
  assert.equal(sent.length, 0);
});

test("the device and the keyboard share the thrusters: the last new value wins, per thruster", () => {
  const { world, link } = rig();
  world.command({ t1: 0.8, t2: 0.8, t3: 0, t4: 0, claw: 0 });       // keyboard: W
  assert.equal(world.state().t1, 0.8);
  link.onLine("p:t1,-0.3", 0);                                         // device overrides t1
  assert.equal(world.state().t1, -0.3);
  world.command({ t1: 0.8, t2: 0.8, t3: 0.5, t4: 0, claw: 0 });     // keyboard changes only t3: the device's t1 stays
  assert.equal(world.state().t1, -0.3);
  assert.equal(world.state().t3, 0.5);
});
