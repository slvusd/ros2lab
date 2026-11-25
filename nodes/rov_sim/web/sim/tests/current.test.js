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
/** Run, and return [the largest r.<attr> reached, the IMU reading at that moment, the value at the end]. */
function runPeak(r, seconds, attr = "roll") {
  let best = [0.0, null];
  for (let i = 0, n = Math.floor(seconds / DT); i < n; i++) { r.step(DT); const v = r[attr]; if (Math.abs(v) > Math.abs(best[0])) best = [v, r.imu()]; }
  return [best[0], best[1], r[attr]];
}

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

test("the IMU feels the current: the sideways push first, then the tilt", () => {
  const quiet = make(false), jet = make();
  for (const r of [quiet, jet]) place(r, JET_X, 0.5, jetsOf(jet).outlets[0].depth, 0.0);
  run(quiet, 0.1); run(jet, 0.1);
  assert.ok(Math.abs(quiet.imu().ay) < 1e-6);
  assert.ok(jet.imu().ay < -0.1, `right at the start the accelerometer shows the sideways push: ay = ${jet.imu().ay.toFixed(3)}`);
  const [peak, imu] = runPeak(jet, 1.5);
  assert.ok(peak > 0.04, `the push should heel the ROV over (peak roll ${(peak * 180 / Math.PI).toFixed(1)} deg)`);
  assert.ok(Math.abs(imu.roll - peak) < 1e-9, "the IMU reports the roll");
  assert.ok(imu.ay > 0.2, `... and the tilt leans gravity into the sideways axis: ay = ${imu.ay.toFixed(3)}`);
  assert.ok(Math.abs(Math.hypot(imu.ay, imu.az) - G) < 1.5, "the accelerometer still reads about 1 g in total");
  run(quiet, 1.5);
  assert.equal(quiet.imu().roll, 0); assert.equal(quiet.imu().gx, 0);
  const r2 = make();
  place(r2, JET_X, 0.5, jetsOf(r2).outlets[0].depth, Math.PI / 2);        // facing the wall: the jet hits the nose, pushing the ROV backwards
  run(r2, 0.1);
  assert.ok(r2.imu().ax < -0.1, `ax = ${r2.imu().ax.toFixed(3)}`);
  run(r2, 8);
  assert.ok(Math.abs(r2.imu().az - G) < 0.6, "against the far wall it settles; the accelerometer is back to about 1 g up");
});

test("the current tilts the ROV: roll from the side, pitch from ahead or behind, more when it hits only the top, none without water", () => {
  const level = make(false);
  place(level, JET_X, 0.5, 0.667);
  run(level, 3);
  assert.equal(level.roll, 0); assert.equal(level.pitch, 0);
  const side = make();
  place(side, JET_X, 0.5, jetsOf(side).outlets[0].depth, 0.0);
  const [roll] = runPeak(side, 1.5, "roll");
  assert.ok(roll > 0.05 && Math.abs(side.pitch) < 0.02, `sideways push: peak roll ${(roll * 180 / Math.PI).toFixed(1)} deg, pitch ${(side.pitch * 180 / Math.PI).toFixed(1)}`);
  assert.ok(roll < 0.6, "it stays within its limit");
  const head = make();
  place(head, JET_X, 0.5, jetsOf(head).outlets[0].depth, Math.PI / 2);        // facing the wall: the jet hits the NOSE
  const [pitchHead] = runPeak(head, 1.5, "pitch");
  assert.ok(pitchHead < -0.03 && Math.abs(head.roll) < 0.02, `push on the nose: peak pitch ${(pitchHead * 180 / Math.PI).toFixed(1)} deg (nose UP is negative)`);
  const behind = make();
  place(behind, JET_X, 0.5, jetsOf(behind).outlets[0].depth, -Math.PI / 2);   // facing away: it hits from behind
  const [pitchBehind] = runPeak(behind, 1.5, "pitch");
  assert.ok(pitchBehind > 0.03, `push from behind: peak pitch ${(pitchBehind * 180 / Math.PI).toFixed(1)} deg should be nose DOWN (positive)`);
  const high = make();
  place(high, JET_X, 0.5, jetsOf(high).outlets[0].depth + 0.25, Math.PI / 2);    // the jet axis is level with the top of the frame
  const [pitchHigh] = runPeak(high, 1.5, "pitch");
  assert.ok(pitchHigh < pitchHead, `the shear should add to the pitch: ${(pitchHigh * 180 / Math.PI).toFixed(1)} vs ${(pitchHead * 180 / Math.PI).toFixed(1)} deg`);
});

test("a ROV carried along with the water levels out, one held against it stays tilted, and with the water off driving about does not tilt it", () => {
  const drift = make();
  place(drift, JET_X, 0.9, jetsOf(drift).outlets[0].depth, 0.0);
  const [peak] = runPeak(drift, 1.5, "roll");
  run(drift, 3);
  assert.ok(Math.abs(drift.roll) < 0.6 * Math.abs(peak), `carried along it should level out: peak ${peak.toFixed(3)}, later ${drift.roll.toFixed(3)}`);
  const pinned = make();
  place(pinned, JET_X, MAIN[2] + 0.4, jetsOf(pinned).outlets[0].depth, 0.0);
  run(pinned, 4);
  assert.ok(pinned.roll > 0.03, `pinned against the wall in the stream it stays heeled over (${(pinned.roll * 180 / Math.PI).toFixed(1)} deg)`);
  const fighting = make();
  place(fighting, JET_X, -0.5, jetsOf(fighting).outlets[0].depth, Math.PI / 2);
  run(fighting, 3, { t1: 1.0, t2: 1.0 });
  assert.ok(fighting.pitch < -0.05, `powering into the stream noses it up (${(fighting.pitch * 180 / Math.PI).toFixed(1)} deg)`);
  const off = make(false);
  place(off, JET_X, 0.0, 0.7, 0.0);
  for (let i = 0; i < 60 * 6; i++) { off.set_cmd("t1", 1.0); off.set_cmd("t2", 0.3); off.step(DT); }
  assert.equal(off.roll, 0); assert.equal(off.pitch, 0);
});

test("the outlets are always in the wall whether the water runs or not", () => {
  for (const on of [false, true]) {
    const js = make(on).state().props.filter((p) => p.type === "jets");
    assert.equal(js.length, 1); assert.equal(js[0].outlets.length, 2); assert.equal(js[0].on, on);
  }
  const off = make(false), j = jetsOf(off), d = j.outlets[0].depth;
  assert.deepEqual(j.flow(JET_X, WALL_Y - 1.0, d), [0, 0, 0], "no water when it is off");
  j.on = true;
  assert.ok(j.flow(JET_X, WALL_Y - 1.0, d)[1] < -0.3, "and water when it is switched on");
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

test("the stream shoves the fish a little (and the fish stays in the pool)", () => {
  const drift = [];
  for (const seed of [11, 18, 25, 32, 39, 46, 53, 60]) {
    const ys = {};
    for (const on of [false, true]) {
      const r = make(on);
      addFish(r, 1);
      const fish = r.props.find((p) => p.type === "fish");
      fish.seed = seed; fish.reset();
      fish.x = JET_X; fish.y = WALL_Y - 0.8; fish.depth = jetsOf(r).outlets[0].depth;
      place(r, -2.5, -1.0, 1.5);
      for (let i = 0; i < 60 * 2; i++) r.step(DT);
      ys[on] = fish.y;
    }
    drift.push(ys[false] - ys[true]);
  }
  assert.ok(drift.reduce((a, b) => a + b) / drift.length > 0.2 && drift.filter((d) => d > 0.1).length >= 6, `the stream should carry the fish away from the wall (the fish also swims about by itself, so look at the average): ${drift.map((d) => d.toFixed(2))}`);
  const r = make();
  addFish(r, 1);
  const fish = r.props.find((p) => p.type === "fish");
  place(r, -2.5, -1.0, 1.5);
  const top = Math.max(...POOL_REGIONS.map((q) => q[3]));
  for (let i = 0; i < 60 * 120; i++) {
    r.step(DT);
    assert.ok(fish.x >= MAIN[0] && fish.x <= MAIN[1] && fish.y >= MAIN[2] && fish.y <= top, `fish out of the pool: (${fish.x.toFixed(2)}, ${fish.y.toFixed(2)})`);
    assert.ok(fish.depth >= 0 && fish.depth <= MAIN[4]);
  }
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
