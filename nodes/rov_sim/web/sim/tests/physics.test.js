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
    const rov = new Rov({ buoyancy: sc.buoyancy, tool: "nose" });
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
