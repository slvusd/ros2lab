// Phase 4: the eDNA station (task 2.4): old sensor out, new sensor in the yellow square, connector in the observatory's port, and the 2 m cable. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool, floorAt } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL, SPOTS, at, stairsRect } from "../layout.js";

const DT = 1 / 60;
function make() {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov);
  const get = (id) => m.items.find((i) => i.id === id);
  return { rov, m, get, obs: rov.props.find((p) => p.type === "m_observatory"), square: rov.props.find((p) => p.type === "m_zone"), cable: rov.props.find((p) => p.id === "edna_cable") };
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }
const hold = (rov, secs, x, y, z, yaw = 0) => { for (let i = 0; i < Math.round(secs / DT); i++) { noseAt(rov, x, y, z, yaw); rov.step(DT); } };
const atStairs = (rov) => { const R = stairsRect(); rov.x = R[0] + 0.3; rov.y = (R[2] + R[3]) / 2; rov.depth = 0.35; rov.yaw = 0; rov.u = rov.v = rov.w = 0; };
/** Hook an item from the floor with the nose, carry it to the stairs and give it to the crew. */
function toDeck(rov, m, item) {
  hold(rov, 0.6, item.x, item.y, -item.depth + item.catches[0].up);
  assert.equal(item.held, "nose", item.id);
  hold(rov, 1.0, item.x, item.y, -1.5);                                   // lift it off the floor (a held item resting on the floor would slide off when the nose moves away)
  atStairs(rov); run(rov, 0.5);
  m.deliver(rov);
  assert.equal(item.mode, "deck", item.id);
}

test("the station: the old sensor stands in the yellow square, the new sensor and the connector start on the deck", () => {
  const { m, get, square } = make();
  const old = get("old_sensor");
  assert.ok(square.holds(old.x, old.y) || Math.hypot(old.x - square.centre()[0], old.y - square.centre()[1]) < 0.01, "the old sensor starts in the square");
  assert.equal(old.mode, "floor");
  assert.deepEqual(m.inventory().map((i) => i.id).sort(), ["connector", "marker1", "marker2", "new_sensor"]);
});

test("the old sensor to the deck: +10", () => {
  const { rov, m, get } = make();
  toDeck(rov, m, get("old_sensor"));
  assert.equal(m.board.get("old_sensor"), true); assert.equal(m.board.total, 10);
});

test("the new sensor stands in the yellow square: +10, but only once the old one is out; knocking it out of the square loses the points", () => {
  const { rov, m, get, square } = make();
  const nw = get("new_sensor"), [cx, cy] = square.centre();
  atStairs(rov);
  assert.equal(m.give(rov, "new_sensor"), true);
  // the square still holds the old sensor: put the new one down inside it anyway
  hold(rov, 1.0, cx + 0.05, cy + 0.05, -3 + 0.28 + 0.4);
  hold(rov, 1.0, cx + 0.05, cy + 0.05, -3 + 0.28);                        // lowered to the floor (the loop is 28 cm up)
  assert.equal(nw.supported, true);
  hold(rov, 0.5, cx + 0.05 - 0.4, cy + 0.05, -3 + 0.28);                  // backs away: it stays
  assert.equal(nw.held, null); assert.equal(nw.mode, "floor");
  assert.ok(Math.abs(nw.x - (cx + 0.05)) < 0.1);
  assert.equal(m.board.get("new_sensor"), false, "the old sensor is still in the pool: not yet");
  // now the old one comes out
  const old = get("old_sensor");
  old.x = cx + 0.4; old.y = cy + 0.4;
  toDeck(rov, m, old);
  run(rov, 0.1);
  assert.equal(m.board.get("new_sensor"), true); assert.equal(m.board.total, 20);
  // bump it out of the square: points lost
  nw.x = cx + 0.4; run(rov, 0.1);
  assert.equal(m.board.get("new_sensor"), false);
  nw.x = cx; run(rov, 0.1);
  assert.equal(m.board.get("new_sensor"), true, "back in the square");
});

test("a new sensor set down only partly in the square does not count", () => {
  const { rov, m, get, square } = make();
  const nw = get("new_sensor"), [cx, cy] = square.centre();
  m.board.set("old_sensor", true, 1);
  nw.mode = "floor"; nw.depth = 3; nw.x = cx + 0.22; nw.y = cy; run(rov, 0.1);
  assert.equal(m.board.get("new_sensor"), false);
  nw.x = cx + 0.1; run(rov, 0.1);
  assert.equal(m.board.get("new_sensor"), true);
});

test("the connector: hung from the nose with the stem down, lowered into the port, it stays when the nose backs away: +5", () => {
  const { rov, m, get, obs } = make();
  const con = get("connector"), [px, py] = obs.port();
  atStairs(rov);
  assert.equal(m.give(rov, "connector"), true);
  hold(rov, 0.8, px - 0.3, py, -3 + 0.21 + 0.6);                          // over the observatory, 60 cm above the port level
  assert.equal(con.stuck_to, null);
  hold(rov, 1.0, px, py + 0.1, -3 + 0.21 + 0.02);                         // lowered 10 cm beside the port: it just rests on the floor
  assert.equal(con.stuck_to, null); assert.equal(m.board.get("connector"), false);
  hold(rov, 0.5, px, py + 0.1, -3 + 0.21 + 0.6);                          // lifted again
  hold(rov, 1.0, px, py, -3 + 0.21 + 0.6);
  for (let i = 0; i < 60; i++) { noseAt(rov, px, py, -3 + 0.21 + 0.6 - 0.6 * (i / 59)); rov.step(DT); }      // straight down into the port
  assert.equal(con.stuck_to, "port"); assert.equal(m.board.get("connector"), false, "still on the ROV: not yet");
  hold(rov, 0.5, px - 0.4, py, -3 + 0.21);                                // the nose backs away
  assert.equal(con.mode, "stuck"); assert.equal(rov.mission_carry, null);
  run(rov, 0.1);
  assert.equal(m.board.get("connector"), true); assert.equal(m.board.total, 5);
  assert.ok(Math.hypot(con.x - px, con.y - py) < 1e-9);
});

test("the 2 m cable runs from the new sensor along the path the connector took; backing up takes it in", () => {
  const { rov, m, get, cable } = make();
  const nw = get("new_sensor"), con = get("connector");
  nw.mode = "floor"; nw.x = at(...SPOTS.edna)[0]; nw.y = at(...SPOTS.edna)[1]; nw.depth = 3;
  atStairs(rov); m.give(rov, "connector");
  const [sx, sy] = [nw.x, nw.y];
  for (let i = 0; i <= 80; i++) { noseAt(rov, sx - 0.2 - 0.02 * i, sy + 0.01 * i, -2.5); rov.step(DT); }
  const n1 = cable.points().length;
  assert.ok(n1 >= 5, `the trail grows as the connector moves (${n1} points)`);
  assert.ok(cable.path > 1.5, `about 1.7 m of cable is out (${cable.path.toFixed(2)})`);
  for (let i = 80; i >= 0; i--) { noseAt(rov, sx - 0.2 - 0.02 * i, sy + 0.01 * i, -2.5); rov.step(DT); }
  assert.ok(cable.points().length < n1, "backing up takes the cable in");
  const long = [];
  for (let i = 0; i <= 140; i++) { noseAt(rov, sx - 0.2 - 0.03 * i, sy, -2.5); rov.step(DT); }
  assert.equal(cable.taut, true, "more than 2 m is out: taut");
  assert.ok(cable.state().pts.length > 5);
  rov.reset();
  assert.equal(cable.points().length, 0, "cable cleared on Reset (the connector is on the deck)");
});
