// A scripted perfect run with the NOSE only (no claw): every physical task, 125 points, inside the 10 minutes. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool, floorAt } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL, SPOTS, stairsRect } from "../layout.js";
import { LobsterPot } from "../pot.js";

const DT = 1 / 60;
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }
test("a nose-only run through every physical task scores all 125 points", () => {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov), by = (t) => rov.props.find((p) => p.type === t), item = (id) => m.items.find((i) => i.id === id);
  const hold = (secs, x, y, z, yaw = 0) => { for (let i = 0; i < Math.round(secs / DT); i++) { noseAt(rov, x, y, z, yaw); rov.step(DT); } };
  const fly = (a, b, z, steps = 90, yaw = 0) => { for (let i = 0; i <= steps; i++) { const u = i / steps; noseAt(rov, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z, yaw); rov.step(DT); } };
  m.clock.start();                                                    // (the pilot starts the run)
  const R = stairsRect(), stairs = [R[0] + 0.3, (R[2] + R[3]) / 2];
  const toStairs = () => { fly([rov.x, rov.y], stairs, -0.3, 60); rov.depth = 0.35; rov.step(DT); };
  const give = (id) => { toStairs(); assert.equal(m.give(rov, id), true, `the crew hands over ${id}`); };
  const carry = (id) => { const it = item(id), c = it.catches[0]; hold(0.5, it.x, it.y, -it.depth + c.up); assert.equal(it.held, "nose", id); hold(0.6, it.x, it.y, -it.depth + c.up + 0.5); };
  const deliver = (id) => { toStairs(); m.deliver(rov); assert.equal(item(id).mode, "deck", id); };

  for (const id of ["star1", "star2", "coral1", "coral2", "crab1", "crab2", "old_sensor"]) { carry(id); deliver(id); }
  assert.equal(m.board.total, 20 + 10 + 10 - 10 + 10 - 10 + 10, "stars, corals, crabs and the old sensor so far");
  // the transect
  const t = by("m_transect"), [a, b] = t.ends();
  rov.x = a[0]; rov.y = a[1]; rov.depth = 2; fly(a, [b[0] - 0.3, b[1]], -2.0, 200, Math.PI);                  // (facing along the pipe: the nose leads)
  assert.equal(m.board.get("transect"), true);
  // survey markers
  const ice = by("m_iceberg"), spots = ice.spots();
  [0, 1].forEach((k) => {
    give("marker" + (k + 1));
    const sp = spots[k], tip = [sp[0], sp[1], sp[2] + 0.20 - 0.015], from = [sp[0] + (k ? 0.5 : -0.5), sp[1]];
    fly([rov.x, rov.y], from, tip[2], 120, k ? Math.PI : 0);
    fly(from, [sp[0], sp[1]], tip[2], 40, k ? Math.PI : 0);
    hold(0.4, sp[0], sp[1], tip[2], k ? Math.PI : 0);
    assert.ok(item("marker" + (k + 1)).stuck_to, "marker " + (k + 1) + " stuck");
    hold(0.4, sp[0] + (k ? 0.5 : -0.5), sp[1], tip[2], k ? Math.PI : 0);
  });
  // new sensor into the yellow square
  const sq = by("m_zone"), [qx, qy] = sq.centre();
  give("new_sensor");
  fly([rov.x, rov.y], [qx, qy], -3 + 0.28 + 0.3, 120);
  hold(0.6, qx, qy, -3 + 0.28);
  hold(0.6, qx - 0.4, qy, -3 + 0.28);
  // the connector into the observatory's port
  const obs = by("m_observatory"), [ox, oy] = obs.port();
  give("connector");
  fly([rov.x, rov.y], [ox, oy], -3 + 0.21 + 0.5, 140);
  for (let i = 0; i < 60; i++) { noseAt(rov, ox, oy, -3 + 0.71 - 0.5 * i / 59); rov.step(DT); }
  hold(0.5, ox - 0.4, oy, -3 + 0.21);
  // the lobster pot
  const pot = by("m_pot");
  for (let k = 0; k < 8 && !pot.open; k++) {
    const z = -pot.floor + LobsterPot.HANDLE_UP, tipx = pot.pivot[0] + 0.25 * Math.cos(pot.theta), tipy = pot.pivot[1] + 0.25 * Math.sin(pot.theta);
    for (let i = 0; i <= 40; i++) { noseAt(rov, tipx - 0.25 + 0.4 * i / 40, tipy, z); rov.step(DT); }
  }
  assert.equal(pot.open, true);
  for (let i = 0; i < 60 * 12; i++) rov.step(DT);
  // the power connector: off the stand, through the waypoint, into the oil port
  const pc = item("power_connector"), way = by("m_waypoint"), [wx, wy] = way.centre(), oil = by("m_oilport"), [px, py] = oil.port();
  carry("power_connector");
  fly([pc.x, pc.y], [wx + 1.0, wy], -3 + 0.6, 100);
  fly([wx + 1.0, wy], [wx - 1.0, wy], -3 + 0.6, 140);
  fly([wx - 1.0, wy], [px + 0.0, py], -3 + 0.17 + 0.5, 140);
  for (let i = 0; i < 60; i++) { noseAt(rov, px, py, -3 + 0.67 - 0.5 * i / 59); rov.step(DT); }
  hold(0.5, px - 0.4, py, -3 + 0.22);
  hold(0.3, px - 0.4, py, -3 + 0.22);
  const earned = m.board.items.filter((i) => i.earned).map((i) => i.id), missed = m.board.items.filter((i) => !i.earned).map((i) => i.id);
  assert.deepEqual(missed, [], `missed: ${missed.join(", ")}`);
  assert.equal(m.board.total, 125);
  assert.ok(m.clock.state !== "over" && m.clock.elapsed < 600, "inside the 10 minutes");
});
