// Replays the golden traces exported from the Python physics (tools/export_golden.py) on the JS port.
// Run:  node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Rov } from "../physics.js";

const golden = JSON.parse(readFileSync(new URL("./golden/physics.json", import.meta.url)));
const TOL = 1e-6;

for (const [name, sc] of Object.entries(golden.scenarios)) {
  test(`physics matches Python: ${name}`, () => {
    const rov = new Rov({ buoyancy: sc.buoyancy, tool: "nose", speed: sc.speed ?? 1.0 });
    let n = 0, row = 0, worst = 0;
    for (const [secs, cmd] of sc.segments) {
      for (const k of ["t1", "t2", "t3", "t4"]) rov.set_cmd(k, cmd[k] ?? 0.0);
      for (let i = 0, steps = Math.round(secs / golden.dt); i < steps; i++) {
        rov.step(golden.dt);
        n++;
        if (n % golden.every === 0) {
          const s = rov.state(), im = s.imu;
          const got = [s.x, s.y, s.depth, s.yaw, s.pitch, s.speed, s.splash_n, s.floor_n, im.ax, im.ay, im.az, im.gy, im.gz];
          const want = sc.rows[row++];
          got.forEach((g, c) => {
            worst = Math.max(worst, Math.abs(g - want[c]));
            assert.ok(Math.abs(g - want[c]) <= TOL, `${name} row ${row - 1} column ${golden.columns[c]}: JS ${g} vs Python ${want[c]}`);
          });
        }
      }
    }
    assert.equal(row, sc.rows.length);
  });
}

// ---- rings: the same idea (tool, rings, starting pose, scripted commands), recorded from rov_props.py ----
import { addTo as addRings } from "../rings.js";

for (const [name, sc] of Object.entries(golden.ring_scenarios)) {
  test(`rings match Python: ${name}`, () => {
    const rov = new Rov({ buoyancy: 0.0, tool: sc.tool });
    addRings(rov, sc.rings);
    Object.assign(rov, sc.rov);
    for (const [i, over] of Object.entries(sc.ringset)) Object.assign(rov.props[Number(i)], over);
    let n = 0, row = 0;
    for (const [secs, cmd] of sc.segments) {
      for (const k of ["t1", "t2", "t3", "t4"]) rov.set_cmd(k, cmd[k] ?? 0.0);
      if ("claw_target" in cmd) rov.claw_target = cmd.claw_target;
      for (let i = 0, steps = Math.round(secs / golden.dt); i < steps; i++) {
        rov.step(golden.dt);
        n++;
        if (n % golden.every === 0) {
          const got = [rov.x, rov.y, rov.depth, rov.yaw, rov.pitch];
          for (const ring of rov.props) got.push(ring.x, ring.y, ring.depth, ring.yaw, +ring.held, +ring.hooked, +ring.lifting);
          const want = sc.rows[row++];
          assert.equal(got.length, want.length);
          got.forEach((g, c) => assert.ok(Math.abs(g - want[c]) <= 1e-5, `${name} row ${row - 1} column ${c}: JS ${g} vs Python ${want[c]}`));
        }
      }
    }
    assert.equal(row, sc.rows.length);
  });
}

test("the speed setting scales the red and green thrusters (1x is the new default: half of the old full power), not the vertical ones", async () => {
  const { SIDE_THRUST } = await import("../physics.js");
  assert.equal(SIDE_THRUST, 0.5);
  const us = {};
  for (const sp of [0.25, 1, 2, 4]) {
    const r = new Rov({ buoyancy: 0.0, speed: sp });
    r.depth = 1.0; r.x = -2.5; r.y = 0; r.yaw = 0;
    r.set_cmd("t1", 1); r.set_cmd("t2", 1);
    for (let i = 0; i < 30; i++) r.step(1 / 60);
    us[sp] = r.u;
  }
  assert.ok(us[0.25] < us[1] && us[1] < us[2] && us[2] < us[4], JSON.stringify(us));
  assert.ok(us[2] / us[1] > 1.6 && us[2] / us[1] < 2.05 && us[4] / us[1] > 3.0 && us[4] / us[1] < 4.1, JSON.stringify(us));
  assert.equal(new Rov({ speed: 99 }).speed_mult, 4); assert.equal(new Rov({ speed: 0.001 }).speed_mult, 0.25);
  const a = new Rov({ buoyancy: 0, speed: 1 }), b = new Rov({ buoyancy: 0, speed: 4 });
  for (const r of [a, b]) { r.depth = 1.0; r.set_cmd("t3", 1); r.set_cmd("t4", 1); for (let i = 0; i < 30; i++) r.step(1 / 60); }
  assert.ok(Math.abs(a.w - b.w) < 1e-9, "the speed setting changed the up/down thrusters");
});

// ---- the water jets (current.js): same idea, with the IMU recorded as well, from rov_current.py ----
import { addTo as addCurrent } from "../current.js";

for (const [name, sc] of Object.entries(golden.current_scenarios)) {
  test(`current matches Python: ${name}`, () => {
    const rov = new Rov({ buoyancy: 0.0, tool: "nose" });
    addCurrent(rov);
    Object.assign(rov, sc.pose);
    let n = 0, row = 0;
    for (const [secs, cmd] of sc.segments) {
      for (const k of ["t1", "t2", "t3", "t4"]) rov.set_cmd(k, cmd[k] ?? 0.0);
      for (let i = 0, steps = Math.round(secs / golden.dt); i < steps; i++) {
        rov.step(golden.dt);
        n++;
        if (n % golden.every === 0) {
          const s = rov.state(), im = s.imu;
          const got = [s.x, s.y, s.depth, s.yaw, s.pitch, s.speed, im.ax, im.ay, im.az, im.gz];
          const want = sc.rows[row++];
          got.forEach((g, c) => assert.ok(Math.abs(g - want[c]) <= 1e-6, `${name} row ${row - 1} column ${c}: JS ${g} vs Python ${want[c]}`));
        }
      }
    }
    assert.equal(row, sc.rows.length);
  });
}
