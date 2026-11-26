import test from "node:test";
import assert from "node:assert/strict";
import { RunClock } from "../clock.js";
import { ScoreBoard } from "../board.js";

test("the clock waits for the start, counts down, and goes on below zero", () => {
  const c = new RunClock(600);
  assert.equal(c.state, "ready"); assert.equal(c.text(), "10:00");
  c.step(5); assert.equal(c.remaining, 600, "it does not run before the start");
  c.start();
  for (let i = 0; i < 60 * 61; i++) c.step(1 / 60);
  assert.equal(c.state, "running"); assert.equal(c.text(), "8:59"); assert.ok(Math.abs(c.elapsed - 61) < 1e-6);
  c.step(538.9);
  assert.equal(c.text(), "0:01"); assert.equal(c.over, false);
  c.step(0.6);
  assert.equal(c.over, true, "past zero it is in overtime but still running"); assert.equal(c.state, "running"); assert.equal(c.text(), "-0:01");
  c.step(12);
  assert.equal(c.text(), "-0:13", "and it counts on in negative numbers"); assert.ok(c.remaining < 0);
  c.step(120);
  assert.equal(c.text(), "-2:13"); assert.equal(c.state, "running");
  c.reset(); assert.equal(c.state, "ready"); assert.equal(c.text(), "10:00");
});

test("the score board adds up, loses points again, and knows when each was earned", () => {
  const b = new ScoreBoard([{ id: "a", label: "A", points: 5 }, { id: "b", label: "B", points: 10 }, { id: "c", label: "C", points: 10 }]);
  assert.equal(b.total, 0); assert.equal(b.max, 25);
  assert.equal(b.set("a", true, 12.5), true); assert.equal(b.set("a", true, 99), false, "already earned: no change");
  assert.equal(b.total, 5); assert.equal(b.data().items[0].at, 12.5);
  b.set("b", true, 20); assert.equal(b.total, 15);
  b.set("a", false); assert.equal(b.total, 10); assert.equal(b.data().items[0].at, null, "lost again");
  assert.throws(() => b.set("zzz", true));
  b.reset(); assert.equal(b.total, 0);
});
