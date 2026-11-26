// Phase 6: the wind farm (task 3.1): lift the power connector off its stand, run the wire between the waypoint's posts, stick the Velcro tip in the oil platform port. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool, floorAt } from "../../../sim/physics.js";
import { addTo } from "../scout2026.js";
import { MISSION_POOL, SPOTS, at, stairsRect } from "../layout.js";
import { Stand, Waypoint, OilPort } from "../items.js";

const DT = 1 / 60;
const F = MISSION_POOL.pooldepth;                                     // the floor's depth
function make() {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const rov = new Rov({ tool: "nose", buoyancy: 0.0 });
  const m = addTo(rov);
  const by = (t) => rov.props.find((p) => p.type === t);
  return { rov, m, power: m.items.find((i) => i.id === "power_connector"), stand: by("m_stand"), way: by("m_waypoint"), oil: by("m_oilport"), cable: rov.props.find((p) => p.id === "power_cable") };
}
function noseAt(rov, x, y, z, yaw = 0) { rov.yaw = yaw; rov.pitch = 0; rov.x = x - 0.485 * Math.cos(yaw); rov.y = y - 0.485 * Math.sin(yaw); rov.depth = -z - 0.195; rov.u = rov.v = rov.w = 0; }
const hold = (rov, secs, x, y, z, yaw = 0) => { for (let i = 0; i < Math.round(secs / DT); i++) { noseAt(rov, x, y, z, yaw); rov.step(DT); } };
/** Fly the nose along a straight line, hanging items follow. */
const fly = (rov, a, b, z, steps = 120, yaw = 0) => { for (let i = 0; i <= steps; i++) { const u = i / steps; noseAt(rov, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, z, yaw); rov.step(DT); } };

test("the power connector lies on its stand (15 cm up) with its cable anchored there", () => {
  const { rov, power, stand, m } = make();
  rov.step(DT);
  assert.equal(power.mode, "floor");
  assert.ok(Math.abs(power.depth - (floorAt(power.x, power.y) - Stand.HEIGHT)) < 1e-9, "on the stand, not on the floor");
  assert.equal(stand.holds(power.x, power.y), true);
  assert.equal(m.board.get("power_lift"), false);
});

test("lifting it off the stand with the nose: +10, kept even if it is dropped again", () => {
  const { rov, power, m } = make();
  const hook = power.catches[0];
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up);
  assert.equal(power.held, "nose");
  assert.equal(m.board.get("power_lift"), false, "hooked but still touching the stand");
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up + 0.4);
  assert.equal(m.board.get("power_lift"), true); assert.equal(m.board.total, 10);
  power.release(rov);
  hold(rov, 5, power.x + 1, power.y, -1);
  assert.equal(m.board.get("power_lift"), true, "dropping it keeps the points");
});

test("the wire between the four posts: carried through the waypoint it counts (+10); flown over the posts or past them it does not", () => {
  const { rov, power, way, cable, m } = make();
  const hook = power.catches[0], [wx, wy] = way.centre(), [sx, sy] = [power.x, power.y];
  hold(rov, 0.6, sx, sy, -power.depth + hook.up);
  hold(rov, 0.6, sx, sy, -power.depth + hook.up + 0.3);
  const z = -F + 0.6;
  fly(rov, [sx, sy], [wx + 0.8, wy + 0.8], z, 120);                      // round the side of the waypoint
  fly(rov, [wx + 0.8, wy + 0.8], [wx - 0.8, wy + 0.8 + 0.6], z, 80);
  assert.equal(m.board.get("power_cable"), false, "a wire that goes past the waypoint, not through it");
  // start again on a new tether: reset, then run straight through
  rov.reset();
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up);
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up + 0.3);
  fly(rov, [power.x, power.y], [wx + 1.0, wy], z, 100);
  fly(rov, [wx + 1.0, wy], [wx - 1.2, wy], z, 150);                       // straight over the waypoint, high up
  assert.equal(m.board.get("power_cable"), true, `through the posts (path ${cable.path.toFixed(1)} m)`);
  assert.equal(m.board.total >= 10, true);
  // and a straight run that is too high at the waypoint itself still counts, because the wire drapes on the floor behind the carried end
  assert.ok(cable.points().some((p) => Math.abs(p[0] - wx) < 0.05 && p[2] < -F + 0.05), "draped on the floor at the waypoint");
});

test("the Velcro tip lowered into the oil platform port sticks; the nose backs away: +10", () => {
  const { rov, power, oil, m } = make();
  const hook = power.catches[0], [px, py] = oil.port();
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up);
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up + 0.5);
  fly(rov, [power.x, power.y], [px, py], -F + 0.17 + 0.5, 140);
  assert.equal(power.stuck_to, null);
  for (let i = 0; i < 60; i++) { noseAt(rov, px, py, -F + 0.17 + 0.5 - 0.5 * i / 59); rov.step(DT); }          // straight down into the port
  assert.equal(power.stuck_to, "oilport"); assert.equal(m.board.get("power_port"), false, "still on the ROV");
  hold(rov, 0.5, px - 0.4, py, -F + 0.17 + 0.05);
  assert.equal(power.mode, "stuck");
  hold(rov, 0.1, px - 0.4, py, -F + 0.17 + 0.05);
  assert.equal(m.board.get("power_port"), true);
  assert.ok(Math.hypot(power.x - px, power.y - py) < 1e-9);
});

test("the Velcro tip beside the port does not stick", () => {
  const { rov, power, oil, m } = make();
  const hook = power.catches[0], [px, py] = oil.port();
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up);
  hold(rov, 0.6, power.x, power.y, -power.depth + hook.up + 0.5);
  fly(rov, [power.x, power.y], [px + 0.1, py], -F + 0.17 + 0.5, 140);
  for (let i = 0; i < 60; i++) { noseAt(rov, px + 0.1, py, -F + 0.17 + 0.5 - 0.5 * i / 59); rov.step(DT); }
  assert.equal(power.stuck_to, null);
});

test("all of the wind farm: Reset puts it all back", () => {
  const { rov, power, m } = make();
  m.score("power_lift", true); m.score("power_cable", true);
  rov.reset();
  assert.equal(m.board.total, 0);
  rov.step(DT);
  assert.equal(power.mode, "floor"); assert.ok(power.depth < floorAt(power.x, power.y) - 0.1);
});
