// The water jets (ported from test_current.py): placement, the jet profile, what the ROV and its IMU feel. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS } from "../physics.js";
import { Jets, addTo as addCurrent, U0, K } from "../current.js";
import { addTo as addRings } from "../rings.js";
import { addTo as addFish } from "../fishbrain.js";
import { addTo as addCrabs } from "../crab.js";

const DT = 1 / 60, G = 9.81;
const MAIN = POOL_REGIONS.reduce((a, b) => (b[4] > a[4] ? b : a)), WALL_Y = MAIN[3];
const JET_X = (MAIN[0] + Math.min(...POOL_REGIONS.filter((r) => r !== MAIN).map((r) => r[0]))) / 2;

function make(jets = true, opts = {}) { const r = new Rov({ buoyancy: 0.0, tool: "nose", ...opts }); addCurrent(r, jets); return r; }
function place(r, x, y, depth, yaw = 0.0) { r.x = x; r.y = y; r.depth = depth; r.yaw = yaw; }
function run(r, seconds, cmd = {}) {
  for (const [k, v] of Object.entries(cmd)) r.set_cmd(k, v);
  for (let i = 0, n = Math.floor(seconds / DT); i < n; i++) r.step(DT);
  for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, 0);
}
const jetsOf = (r) => r.props.find((p) => p.type === "jets");

test("two outlets in the middle of the shallow end's side wall, at a third and two thirds of the depth, shooting into the pool", () => {
  const j = new Jets();
  assert.equal(j.outlets.length, 2);
  for (const o of j.outlets) {
    assert.equal(o.y, WALL_Y, "on the +y wall: the side the shallow end is on");
    assert.ok(Math.abs(o.x - JET_X) < 1e-9 && o.dx === 0 && o.dy === -1, "in the middle of the wall, straight into the pool");
  }
  assert.deepEqual(j.outlets.map((o) => +o.depth.toFixed(6)).sort(), [+(MAIN[4] / 3).toFixed(6), +(2 * MAIN[4] / 3).toFixed(6)]);
  assert.ok(JET_X > MAIN[0] && JET_X < Math.min(...POOL_REGIONS.filter((r) => r !== MAIN).map((r) => r[0])), "on the stretch of wall that is really a wall");
});

test("a jet is fast at the nozzle, slows and spreads with distance, and stops at the walls", () => {
  const j = new Jets(), d = j.outlets[0].depth;
  assert.ok(Math.abs(-j.flow(JET_X, WALL_Y - 0.2, d)[1] - U0) < 0.05, "at the nozzle it is about U0");
  const speeds = [0.8, 1.0, 1.5, 2.0, 2.9].map((s) => { const v = j.flow(JET_X, WALL_Y - s, d)[1]; assert.ok(v < 0, "away from the wall"); return -v; });     // past the fast core (about 0.6 m)
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] < speeds[i - 1], `it should slow down: ${speeds}`);
  assert.deepEqual(j.flow(JET_X, WALL_Y + 0.3, d), [0, 0, 0], "nothing behind the wall");
  assert.deepEqual(j.flow(JET_X, WALL_Y - 4.0, d), [0, 0, 0], "nothing past the far wall");
  const off = [0, 0.2, 0.4, 0.8].map((dx) => -j.flow(JET_X + dx, WALL_Y - 1.5, d)[1]);
  for (let i = 1; i < off.length; i++) assert.ok(off[i] < off[i - 1]);
  assert.ok(off[3] < 0.3 * off[0], `it falls off to the side: ${off}`);          // (a wide jet: still a good fraction 0.8 m to the side)
  const one = new Jets(); one.outlets = one.outlets.slice(0, 1);
  assert.ok(Math.abs(one.flow(JET_X - 0.3, WALL_Y - 1.5, d)[1] - one.flow(JET_X + 0.3, WALL_Y - 1.5, d)[1]) < 1e-12, "symmetric sideways");
  assert.ok(Math.abs(one.flow(JET_X, WALL_Y - 1.5, d + 0.3)[1] - one.flow(JET_X, WALL_Y - 1.5, d - 0.3)[1]) < 1e-12, "symmetric up and down");
});

test("the two jets add up between them", () => {
  const j = new Jets(), one = new Jets(); one.outlets = one.outlets.slice(0, 1);
  const mid = (j.outlets[0].depth + j.outlets[1].depth) / 2;
  assert.ok(-j.flow(JET_X, WALL_Y - 2.5, mid)[1] > 1.5 * -one.flow(JET_X, WALL_Y - 2.5, mid)[1]);
});

test("without jets nothing moves and the IMU reads gravity only", () => {
  const r = make(false);
  place(r, JET_X, 0.0, 0.7);
  run(r, 5);
  assert.ok(Math.abs(r.y) < 1e-9 && Math.abs(r.v) < 1e-9 && Math.abs(r.u) < 1e-9);
  const im = r.imu();
  assert.ok(Math.abs(im.ax) < 1e-6 && Math.abs(im.ay) < 1e-6 && Math.abs(im.az - G) < 1e-6);
});

test("the current carries a resting ROV away from the wall", () => {
  const r = make();
  place(r, JET_X, 0.5, jetsOf(r).outlets[0].depth);
  const start = r.y;
  run(r, 1.5);
  assert.ok(r.y < start - 0.3 && r.v < -0.1, `moved ${(r.y - start).toFixed(2)} m, sideways speed ${r.v.toFixed(2)} m/s`);
  run(r, 6);
  assert.ok(r.y < MAIN[2] + 0.6, "left alone it ends up against the far wall");
});

test("the IMU feels the current", () => {
  const quiet = make(false), jet = make();
  for (const r of [quiet, jet]) { place(r, JET_X, 0.5, jetsOf(jet).outlets[0].depth, 0.0); run(r, 0.5); }
  assert.ok(Math.abs(quiet.imu().ay) < 1e-6);
  assert.ok(jet.imu().ay < -0.2, `ay = ${jet.imu().ay.toFixed(3)}`);
  assert.ok(Math.abs(jet.imu().az - G) < 1.0, "gravity still reads about +9.8 up");
  const r2 = make();
  place(r2, JET_X, 0.5, jetsOf(r2).outlets[0].depth, Math.PI / 2);        // facing the wall: pushed backwards
  run(r2, 0.5);
  assert.ok(r2.imu().ax < -0.2, `ax = ${r2.imu().ax.toFixed(3)}`);
  run(r2, 6);
  assert.ok(Math.abs(r2.imu().ax) < 0.2, "once it moves with the water the push is gone");
});

test("the ROV can fight the current far from the nozzle, but not near it", () => {
  const gains = {};
  for (const [label, y0] of [["far", WALL_Y - 2.6], ["near", WALL_Y - 0.8]]) {
    const r = make();
    place(r, JET_X, y0, jetsOf(r).outlets[0].depth, Math.PI / 2);
    run(r, 6, { t1: 1.0, t2: 1.0, t3: 0.0, t4: 0.0 });
    gains[label] = r.y - y0;
  }
  assert.ok(gains.far > 0.5, `far: ${gains.far.toFixed(2)} m in 6 s`);
  assert.ok(gains.near < gains.far - 0.5, JSON.stringify(gains));
});

test("the ROV can escape sideways out of the jet", () => {
  const r = make();
  place(r, JET_X, WALL_Y - 1.0, jetsOf(r).outlets[0].depth, 0.0);
  run(r, 12, { t1: 1.0, t2: 1.0 });
  assert.ok(Math.abs(r.x - JET_X) > 0.8);
  const [wx, wy] = jetsOf(r).flow(r.x, r.y, r.depth);
  assert.ok(Math.hypot(wx, wy) < 0.25, `then the water is calm (${Math.hypot(wx, wy).toFixed(2)} m/s)`);
});

test("the core hook works for any prop that moves the water (isolation)", () => {
  const r = new Rov({ buoyancy: 0.0, tool: "nose" });
  r.props.push({ type: "wind", reset() {}, step() {}, state() { return { type: "wind" }; }, flow() { return [0.3, 0.0, 0.0]; } });
  place(r, 0.0, 0.0, 0.8);
  run(r, 8);
  assert.ok(r.x > 0.8 && r.u > 0.25 && r.u < 0.31, `x=${r.x.toFixed(2)}, u=${r.u.toFixed(2)}`);
});

test("the state is plain data and the page can recompute the axial speed from it", () => {
  const s = JSON.parse(JSON.stringify(make().state()));
  const j = s.props.find((p) => p.type === "jets");
  assert.equal(j.outlets.length, 2);
  for (const k of ["length", "u0", "k", "r0", "spread"]) assert.equal(typeof j[k], "number");
  for (const sd of [0.3, 0.8, 1.7, 2.6]) assert.ok(Math.abs(Math.min(j.u0, j.k / sd) - Jets.axial(sd)) < 1e-12);
  assert.equal(j.k, K);
});

test("jets coexist with rings, fish and crabs and run at 60 Hz", () => {
  const r = new Rov({ buoyancy: 0.0, tool: "claw" });
  addRings(r, 3); addFish(r, 1); addCrabs(r, 2); addCurrent(r);
  place(r, JET_X, 0.0, 0.8);
  const t = performance.now();
  for (let i = 0; i < 600; i++) { r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT); }
  const ms = (performance.now() - t) / 600;
  assert.ok(ms < 5.0, `${ms.toFixed(2)} ms per step`);
  assert.equal(r.state().props.filter((p) => p.type === "jets").length, 1);
});
