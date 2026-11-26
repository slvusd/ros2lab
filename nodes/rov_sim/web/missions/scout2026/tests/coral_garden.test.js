// Phase 1 of the mission: the basket stars, corals and the transect (tasks 1.1 and 1.2). Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool, floorAt } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL, at, stairsRect } from "../layout.js";
import { noseTip } from "../../common/carry.js";

const DT = 1 / 60;
function make(tool = "nose") {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool, buoyancy: 0.0 });
  const m = addTo(rov);
  return { rov, m, item: (id) => m.items.find((i) => i.id === id), transect: rov.props.find((p) => p.type === "m_transect") };
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };
/** Put the ROV so that its nose tip is at (x, y, z up), facing along yaw. */
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }

test("the coral garden is in the pool: 2 basket stars, 2 corals and 2 crabs on the floor beside the transect, wall-relative", () => {
  const { rov, m, transect } = make();
  const ids = m.items.filter((i) => i.home_pose).map((i) => i.id);                        // (the markers start on the deck)
  assert.deepEqual(ids, ["star1", "star2", "coral1", "coral2", "crab1", "crab2"]);
  for (const it of m.items.filter((i) => i.home_pose)) {
    assert.equal(it.mode, "floor"); assert.equal(it.depth, 3, "on the 3 m deep floor");
    assert.ok(Math.abs(it.y - at(0, 0)[1]) > 0.5 && Math.abs(it.y - at(0, 0)[1]) < 1.5, "beside the transect, not on it");
  }
  const [a, b] = transect.ends();
  assert.ok(Math.abs(a[0] - at(0.5, 0)[0]) < 1e-9 && Math.abs(b[0] - at(3.6, 0)[0]) < 1e-9, "0.5 m to 3.6 m out from the wall");
});

test("hook a basket star with the nose, carry it to the stairs, and the crew takes it: +5, and it sits on the deck", () => {
  const { rov, m, item } = make();
  const star = item("star1"), c = star.catches[0];
  noseAt(rov, star.x, star.y, -star.depth + c.up);
  run(rov, 0.6);
  assert.equal(star.held, "nose");
  noseAt(rov, star.x, star.y, -1.0);                                   // lift it a metre
  run(rov, 1);
  assert.ok(star.depth < 2.2, "it came up");
  const R = stairsRect();
  rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35; rov.yaw = 0; rov.u = rov.v = rov.w = 0;
  run(rov, 1);
  m.deliver(rov);
  assert.equal(star.mode, "deck"); assert.equal(m.board.total, 5); assert.equal(m.board.get("star1"), true);
  assert.equal(m.board.get("star2"), false);
});

test("a coral is caught by its branches; the claw can take the star by its H base", () => {
  const { rov, item } = make();
  const coral = item("coral1");
  noseAt(rov, coral.x, coral.y, -coral.depth + coral.catches[0].up);
  run(rov, 0.6);
  assert.equal(coral.held, "nose");
  const { rov: r2, item: item2 } = make("claw");
  const star = item2("star2"), jaw = star.catches[1];
  r2.yaw = 0; r2.pitch = 0; r2.x = star.x - 0.49; r2.y = star.y; r2.depth = -(-star.depth + jaw.up - -0.25);
  r2.claw = 0.9; r2.claw_target = 0.9; run(r2, 0.2);
  r2.claw_target = 0.0; run(r2, 1.5);
  assert.equal(star.held, "claw");
});

test("the transect: fly it end to end over the pipe = +10; leaving it starts over; starting in the middle does not count", () => {
  const { rov, m, transect } = make();
  const [a, b] = transect.ends();
  const fly = (from, to, lateral = 0, steps = 200) => {
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      rov.x = from[0] + (to[0] - from[0]) * u; rov.y = from[1] + (to[1] - from[1]) * u + lateral; rov.depth = 2.0; rov.u = rov.v = 0;
      rov.step(DT);
    }
  };
  const mid = [(a[0] + b[0]) / 2, a[1]];
  const leave = () => { rov.y += 2.0; rov.step(DT); };                  // (teleports in this test: step off the pipe in between)
  fly(mid, b);
  assert.equal(transect.done, false, "from the middle to one end is not the whole pipe");
  leave();
  fly(a, mid);
  assert.equal(transect.done, false, "half of it");
  leave();
  fly(a, b, 0.6);                                                       // all the way, but 0.6 m to the side of the pipe
  assert.equal(transect.done, false, "not over the pipe");
  leave();
  fly(a, [mid[0], mid[1]]);                                             // start well, then leave it sideways
  rov.y += 1.0; rov.step(DT);
  fly([mid[0], mid[1] + 1.0], [b[0], b[1] + 1.0]);
  assert.equal(transect.done, false, "left the pipe halfway");
  leave();
  fly(a, b, 0.2);                                                       // the whole way, a little off the middle but still over the pipe
  assert.equal(transect.done, true); assert.equal(m.board.get("transect"), true); assert.equal(m.board.total, 10);
  m.score("transect", true); assert.equal(m.board.total, 10);
  rov.reset();
  assert.equal(transect.done, false); assert.equal(m.board.total, 0);
});

test("the transect also counts from the far end back to the wall", () => {
  const { rov, m, transect } = make();
  const [a, b] = transect.ends();
  for (let i = 0; i <= 200; i++) { const u = i / 200; rov.x = b[0] + (a[0] - b[0]) * u; rov.y = b[1]; rov.depth = 1.5; rov.u = 0; rov.step(DT); }
  assert.equal(transect.done, true);
});

test("a green crab is carried to the deck by its legs (nose) for +5 each", () => {
  const { rov, m, item } = make();
  for (const id of ["crab1", "crab2"]) {
    const crab = item(id);
    noseAt(rov, crab.x, crab.y, -crab.depth + crab.catches[0].up);
    run(rov, 0.6);
    assert.equal(crab.held, "nose", id);
    const R = stairsRect();
    rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35; rov.yaw = 0; rov.u = rov.v = rov.w = 0;
    run(rov, 1);
    m.deliver(rov);
    assert.equal(crab.mode, "deck");
  }
  assert.equal(m.board.get("crab1"), true); assert.equal(m.board.get("crab2"), true); assert.equal(m.board.total, 10);
});
