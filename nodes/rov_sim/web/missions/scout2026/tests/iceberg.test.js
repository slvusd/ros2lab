// Phase 3: the iceberg and the survey markers (task 2.2): the markers start on the deck (inventory), Velcro sticks on contact. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL, stairsRect } from "../layout.js";
import { noseTip } from "../../common/carry.js";

const DT = 1 / 60;
function make() {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov);
  return { rov, m, iceberg: rov.props.find((p) => p.type === "m_iceberg"), marker: (id) => m.items.find((i) => i.id === id) };
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }
const atStairs = (rov) => { const R = stairsRect(); rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35; rov.yaw = 0; rov.u = rov.v = rov.w = 0; };

test("the markers start on the deck: they are in the crew's inventory, not in the pool", () => {
  const { rov, m, marker } = make();
  assert.ok(["marker1", "marker2"].every((id) => m.inventory().some((i) => i.id === id)));
  assert.equal(marker("marker1").mode, "deck"); assert.notDeepEqual([marker("marker1").x, marker("marker1").y], [marker("marker2").x, marker("marker2").y], "different deck slots");
  run(rov, 1);
  assert.equal(marker("marker1").mode, "deck");
});

test("ask the crew for a marker at the stairs, carry it to a survey point on the nose: it sticks, +10; the nose slides off", () => {
  const { rov, m, iceberg, marker } = make();
  atStairs(rov);
  assert.equal(m.give(rov, "marker1"), true);
  const mk = marker("marker1");
  assert.equal(mk.held, "nose");
  const spots = iceberg.spots();
  assert.equal(mk.stuck_to, null);
  // fly it: the marker hangs 20 cm below the nose tip; bring its Velcro to point A
  const target = [spots[0][0], spots[0][1], spots[0][2] + 0.20 - 0.015];       // the nose tip, so that the patch is at the point
  noseAt(rov, target[0] - 0.4, target[1], target[2]); run(rov, 1.0);
  for (let i = 0; i <= 40; i++) { const u = i / 40; noseAt(rov, target[0] - 0.4 + 0.4 * u, target[1], target[2]); rov.step(DT); }
  run(rov, 0.5);
  assert.equal(mk.stuck_to, "iceA"); assert.equal(m.board.get("marker1"), true); assert.equal(m.board.total, 10);
  const [x, y] = [mk.x, mk.y];
  noseAt(rov, target[0] - 0.6, target[1], target[2]); run(rov, 0.5);          // back away
  assert.equal(mk.held, null); assert.equal(rov.mission_carry, null); assert.equal(mk.mode, "stuck");
  run(rov, 3);
  assert.deepEqual([mk.x, mk.y], [x, y], "it stays on the leg");
  // the second marker to the other point
  atStairs(rov);
  assert.equal(m.give(rov, "marker2"), true);
  const t2 = [spots[1][0], spots[1][1], spots[1][2] + 0.20 - 0.015];
  noseAt(rov, t2[0] + 0.4, t2[1], t2[2], Math.PI); run(rov, 1.0);
  for (let i = 0; i <= 40; i++) { const u = i / 40; noseAt(rov, t2[0] + 0.4 - 0.4 * u, t2[1], t2[2], Math.PI); rov.step(DT); }
  run(rov, 0.5);
  assert.equal(marker("marker2").stuck_to, "iceB"); assert.equal(m.board.total, 20);
});

test("a marker that only passes the iceberg does not stick; away from the survey points nothing happens", () => {
  const { rov, m, iceberg, marker } = make();
  atStairs(rov); m.give(rov, "marker1");
  const sp = iceberg.spots()[0];
  noseAt(rov, sp[0], sp[1], sp[2] + 0.20 + 0.5);                                // 50 cm too high
  run(rov, 1);
  assert.equal(marker("marker1").stuck_to, null);
  assert.equal(m.board.total, 0);
});

test("Reset: markers back on the deck, points un-stuck, score zero", () => {
  const { rov, m, iceberg, marker } = make();
  atStairs(rov); m.give(rov, "marker1");
  const sp = iceberg.spots()[0];
  for (let i = 0; i < 60; i++) { noseAt(rov, sp[0], sp[1], sp[2] + 0.20 - 0.015); rov.step(DT); }          // (the ROV is held in place)
  assert.equal(m.board.total, 10);
  rov.reset();
  assert.equal(m.board.total, 0); assert.equal(marker("marker1").mode, "deck"); assert.equal(marker("marker1").stuck_to, null);
  assert.equal(iceberg.points.every((p) => p.marker === null), true);
  assert.equal(m.inventory().length, 4, "back to the four things on the deck at the start");
});

test("a marker handed over at the stairs stays on the nose when the ROV drives on over the steps (it is dragged, it does not fall off)", () => {
  const { rov, m, marker } = make();
  const R = stairsRect();
  rov.x = R[0] - 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.3; rov.yaw = 0; rov.u = rov.v = rov.w = 0;
  run(rov, 0.5);
  assert.equal(m.give(rov, "marker1"), true);
  const mk = marker("marker1");
  rov.set_cmd("t1", 0.3); rov.set_cmd("t2", 0.3);
  for (let i = 0; i < 240; i++) {
    rov.step(DT);
    assert.equal(mk.held, "nose", `still on the nose after ${i} steps (ROV x ${rov.x.toFixed(2)}, depth ${rov.depth.toFixed(2)})`);
    assert.equal(rov.mission_carry, mk);
  }
});

test("backing the nose away lets go; and a let-go item is not silently hooked again while the nose still rests in its loop", () => {
  const { rov, m, marker } = make();
  const R = stairsRect();
  rov.x = R[0] - 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.3; rov.yaw = 0; rov.u = rov.v = rov.w = 0;
  run(rov, 0.5);
  m.give(rov, "marker1");
  rov.set_cmd("t1", 0.3); rov.set_cmd("t2", 0.3); run(rov, 3);                 // onto the steps: it rests there and is dragged
  const mk = marker("marker1");
  assert.equal(mk.held, "nose");
  rov.set_cmd("t1", -0.4); rov.set_cmd("t2", -0.4); run(rov, 1.0);             // reverse
  rov.set_cmd("t1", 0); rov.set_cmd("t2", 0);
  assert.equal(mk.held, null, "it slid off when the nose backed away");
  assert.equal(rov.mission_carry, null, "the nose reports nothing on it");
  // a nose resting at the item must not re-hook it by itself
  mk.x = rov.x + 0.485; mk.y = rov.y; mk.mode = "floor";
  run(rov, 6);
  if (Math.hypot(mk.x - (rov.x + 0.485), mk.y - rov.y) < 0.1) assert.equal(rov.mission_carry, null, "not hooked again without leaving and coming back");
  assert.equal(m.give(rov, "marker2"), true, "and the crew can hand over the next one");
});
