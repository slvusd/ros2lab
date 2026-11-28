// The Pool Rings 2026 game. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool } from "../../../sim/physics.js";
import { addTo as addRings } from "../../../sim/rings.js";
import { addTo, RUN_SECONDS } from "../rings2026.js";
import { stairsRect } from "../../common/stairs.js";
import { parseConfig } from "../../../config.js";

setPool(1, 1, 2);
function make() {
  const rov = new Rov({ tool: "claw" });
  addRings(rov, 3);
  const m = addTo(rov);
  rov.reset();
  return { rov, m, ring: m.rings()[0] };
}

test("the mission is known to the address, with 3 rings and the usual pool", () => {
  const c = parseConfig("?mission=rings2026");
  assert.equal(c.mission, "rings2026"); assert.equal(c.rings, 3);
});
test("the board data: a title, no top score, a 5 minute clock", () => {
  const { m, rov } = make();
  const s = m.state(rov);
  assert.equal(s.title, "Pool Rings 2026"); assert.equal(s.board.max, 0); assert.equal(s.clock.total, 300); assert.equal(RUN_SECONDS, 300);
  assert.match(s.hint, /stairs/);
});
test("G at the stairs scores 5 and the ring is dropped somewhere else", () => {
  const { m, rov, ring } = make();
  const r = stairsRect();
  Object.assign(ring, { x: (r[0] + r[1]) / 2, y: (r[2] + r[3]) / 2, held: true });
  rov.claw_holder = ring;
  assert.equal(m.state(rov).carrying, "a pool ring");
  m.deliver(rov);
  assert.equal(m.score, 5); assert.equal(m.state(rov).board.total, 5);
  assert.equal(ring.held, false); assert.equal(rov.claw_holder, null);
  assert.equal(m.inStairs(ring.x, ring.y), false, "the new ring is in the pool, not in the stairs");
  assert.ok(ring.depth < 0.25, "dropped at the surface");
  assert.equal(m.rings().length, 3, "still three rings");
});
test("G away from the stairs only lets go: no points", () => {
  const { m, rov, ring } = make();
  Object.assign(ring, { x: -1, y: 0, hooked: true });
  m.deliver(rov);
  assert.equal(m.score, 0); assert.equal(ring.hooked, false);
  m.deliver(rov); assert.match(m.msg.text, /No ring/);
});
test("after the 5 minutes nothing scores; Reset plays again", () => {
  const { m, rov, ring } = make();
  m.clock.start(); m.clock.step(RUN_SECONDS + 1);
  m.step(rov, 0.01); assert.match(m.msg.text, /Time!/);
  const r = stairsRect();
  Object.assign(ring, { x: (r[0] + r[1]) / 2, y: (r[2] + r[3]) / 2, hooked: true });
  m.deliver(rov); assert.equal(m.score, 0);
  rov.reset(); assert.equal(m.clock.state, "ready"); assert.equal(m.delivered, 0);
});
