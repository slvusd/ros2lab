// The mission skeleton: pool, start, clock, lock at time up, crew keys at the stairs. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool, POOL_REGIONS, POOL_WATER } from "../../../sim/physics.js";
import { addTo, SCORED } from "../scout2026.js";
import { Carryable, noseTip } from "../../common/carry.js";
import { MISSION_POOL, at, atStairs, deckSlot, stairsRect, startPose } from "../layout.js";
import { parseConfig } from "../../../config.js";

const DT = 1 / 60;
function make() {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov);
  return { rov, m };
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };

test("17 scored items, 125 points, none earned at the start", () => {
  const { m } = make();
  assert.equal(SCORED.length, 17); assert.equal(m.board.max, 125); assert.equal(m.board.total, 0);
  assert.equal(new Set(SCORED.map((i) => i.id)).size, 17, "unique ids");
});

test("the mission's start-up is the 6 x 6 m, 3 m deep pool; the ROV starts at the surface by the stairs, inside the pool", () => {
  const c = parseConfig("?mission=scout2026");
  assert.deepEqual([c.poollength, c.poolwidth, c.pooldepth], [1, 2, 3]);
  const { rov } = make();
  assert.equal(POOL_WATER[0][4], 3); assert.equal(POOL_WATER[0][3] - POOL_WATER[0][2], 6);
  const s = startPose();
  assert.deepEqual([rov.x, rov.y, rov.depth, rov.yaw], [s.x, s.y, s.depth, s.yaw]);
  assert.ok(POOL_REGIONS.some((r) => r[0] <= rov.x && rov.x <= r[1] && r[2] <= rov.y && rov.y <= r[3]), "inside the water");
  const [x, y] = at(0, 0);
  assert.equal(x, POOL_WATER[0][1], "u = 0 is the wall");
});

test("the clock waits for the first move, then counts down; at zero everything stops until Reset", () => {
  const { rov, m } = make();
  run(rov, 5);
  assert.equal(m.clock.state, "ready"); assert.equal(m.clock.text(), "10:00");
  rov.set_cmd("t1", 0.5);
  run(rov, 1);
  assert.equal(m.clock.state, "running");
  m.clock.elapsed = 598; m.clock.remaining = 2;
  run(rov, 3);
  assert.equal(m.clock.state, "over"); assert.equal(m.locked, true);
  rov.set_cmd("t1", 1.0); rov.set_cmd("t2", 1.0); rov.claw_target = 1.0;
  run(rov, 0.1);
  for (const k of Object.keys(rov.cmd)) assert.equal(rov.cmd[k], 0, `${k} is off`);
  assert.equal(m.state().locked, true); assert.equal(m.state().clock.text, "0:00");
  rov.reset();
  assert.equal(m.clock.state, "ready"); assert.equal(m.locked, false); assert.equal(m.clock.text(), "10:00");
});

test("scoring: points go up and down, with a message each time", () => {
  const { m } = make();
  m.score("star1", true); assert.equal(m.board.total, 5); assert.match(m.msg.text, /\+5/);
  m.score("marker1", true); assert.equal(m.board.total, 15);
  m.score("star1", false); assert.equal(m.board.total, 10); assert.match(m.msg.text, /-5/);
  const n = m.msg.n; m.score("star1", false); assert.equal(m.msg.n, n, "no change, no message");
});

test("the stairs: the crew takes what the ROV carries (only at the stairs) and hands it back from the inventory", () => {
  const { rov, m } = make();
  const item = m.addItem(new Carryable("box", "box", at(3, -1)[0], at(3, -1)[1], [{ id: "loop", up: 0.12, r: 0.06, kind: "loop" }]));
  item.label = "Test box";
  const R = stairsRect();
  assert.ok(R && deckSlot(0)[1] > R[3], "the deck slots are beside the stairs, on the deck");
  const slotBase = m.items.filter((i) => i.mode === "deck").length;                  // (the two survey markers already sit on the deck)
  // hook it far from the stairs
  rov.yaw = 0; rov.pitch = 0; rov.x = item.x - 0.485; rov.y = item.y; rov.depth = item.depth - 0.12 - 0.195;
  run(rov, 0.6);
  assert.equal(item.held, "nose");
  assert.equal(atStairs(rov), false);
  m.deliver(rov);
  assert.match(m.msg.text, /stairs/); assert.equal(item.mode, "held", "still on the ROV");
  // carry it to the stairs
  rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35; rov.u = rov.v = rov.w = 0;
  run(rov, 1);
  assert.equal(atStairs(rov), true); assert.equal(item.held, "nose");
  m.deliver(rov);
  assert.equal(item.mode, "deck"); assert.equal(rov.mission_carry, null); assert.deepEqual([item.x, item.y], deckSlot(slotBase));
  assert.ok(m.inventory().some((i) => i.id === "box" && i.label === "Test box"));
  assert.equal(m.state().inventory.length, slotBase + 1);
  // give it back
  assert.equal(m.give(rov, "box"), true);
  assert.equal(item.held, "nose"); assert.equal(m.inventory().length, slotBase);
  assert.equal(m.give(rov, "box"), false, "it is on the ROV now");
  m.deliver(rov);
  rov.x = at(3, 0)[0]; rov.y = 0;
  assert.equal(m.give(rov, "box"), false, "away from the stairs nothing is handed over");
  assert.match(m.msg.text, /stairs/);
});

test("a second delivered item gets the next deck slot; Reset puts carried and delivered things back", () => {
  const { rov, m } = make();
  const a = m.addItem(new Carryable("a", "box", at(3, -1)[0], at(3, -1)[1], [{ id: "l", up: 0.1, r: 0.05, kind: "loop" }]));
  const b = m.addItem(new Carryable("b", "box", at(3, 1)[0], at(3, 1)[1], [{ id: "l", up: 0.1, r: 0.05, kind: "loop" }]));
  const R = stairsRect();
  for (const it of [a, b]) {
    it.mode = "held"; it.held = "nose"; rov.mission_carry = it;
    rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35;
    m.deliver(rov);
  }
  assert.notDeepEqual([a.x, a.y], [b.x, b.y]); assert.deepEqual([b.x, b.y], deckSlot(5));       // (slots 0-3: the markers, the new sensor and the connector)
  rov.reset();
  assert.equal(a.mode, "floor"); assert.equal(b.mode, "floor"); assert.equal(m.inventory().length, 4, "only the four deck-start things are on the deck");
});

test("without a mission nothing else is changed: a plain ROV has no mission prop", () => {
  setPool(1, 1, 2);
  const rov = new Rov({ tool: "nose" });
  assert.equal(rov.props.some((p) => p.type === "mission"), false);
  assert.equal(rov.start_pose, undefined);
  assert.equal(rov.x, -1.5);
});
