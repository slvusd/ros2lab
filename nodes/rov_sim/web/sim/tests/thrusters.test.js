// The 3, 4, 6 and 8 thruster layouts (ported from test_thrusters.py). Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, THRUSTER_LAYOUTS, layoutFor, TURN_ARM, VERT_ARM } from "../physics.js";
import { capsules } from "../shape.js";
import { addTo as addRings } from "../rings.js";

const DT = 1 / 60, deg = (r) => (r * 180 / Math.PI).toFixed(1);
function drive(n, cmds, secs = 2.0, depth = 1.0, opts = {}) {
  const r = new Rov({ buoyancy: 0.0, tool: "nose", thrusters: n, ...opts });
  r.depth = depth; r.x = -2.0; r.y = 0.0;
  for (const [k, v] of Object.entries(cmds)) assert.ok(r.set_cmd(k, v), k);
  for (let i = 0, steps = Math.floor(secs / DT); i < steps; i++) r.step(DT);
  return r;
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test("each layout has the right thrusters", () => {
  const counts = { 3: [2, 1], 4: [2, 2], 6: [4, 2], 8: [4, 4] };
  for (const [n, [nh, nv]] of Object.entries(counts)) {
    const lay = THRUSTER_LAYOUTS[n];
    assert.deepEqual(lay.map((t) => t.name), Array.from({ length: Number(n) }, (_, i) => `t${i + 1}`));
    assert.equal(lay.filter((t) => t.kind === "h").length, nh); assert.equal(lay.filter((t) => t.kind === "v").length, nv);
    for (const t of lay) {
      for (const k of ["name", "kind", "x", "y", "gx", "gy", "dx", "dy", "label", "color"]) assert.ok(k in t, `${n}: ${t.name} has no ${k}`);
      if (t.kind === "h") assert.ok(near(Math.hypot(t.dx, t.dy), 1.0, 1e-12), "a horizontal thruster points along a unit vector");
    }
  }
  const four = Object.fromEntries(THRUSTER_LAYOUTS[4].map((t) => [t.name, t]));
  assert.deepEqual([four.t1.y, four.t2.y, four.t3.x, four.t4.x], [TURN_ARM, -TURN_ARM, VERT_ARM, -VERT_ARM], "the original layout is unchanged");
  assert.equal(layoutFor(5), THRUSTER_LAYOUTS[4]); assert.equal(layoutFor(7), THRUSTER_LAYOUTS[4]);
});

test("six and eight put the horizontal thrusters on the four posts, angled 45 degrees; the vertical ones are where asked", () => {
  for (const n of [6, 8]) {
    const h = THRUSTER_LAYOUTS[n].filter((t) => t.kind === "h");
    assert.deepEqual(h.map((t) => [t.x, t.y]).sort().map((p) => p.map((v) => +v.toFixed(3))), [[-0.25, -0.25], [-0.25, 0.25], [0.25, -0.25], [0.25, 0.25]]);
    assert.ok(h.every((t) => near(Math.abs(t.dx), Math.SQRT1_2, 1e-12) && near(Math.abs(t.dy), Math.SQRT1_2, 1e-12)));
    assert.deepEqual(h.filter((t) => t.y > 0).map((t) => t.name).sort(), ["t1", "t3"], "t1 and t3 are the left ones");
    assert.ok(h.filter((t) => t.y > 0).every((t) => t.color === "red") && h.filter((t) => t.y < 0).every((t) => t.color === "green"));
  }
  assert.deepEqual(THRUSTER_LAYOUTS[6].filter((t) => t.kind === "v").map((t) => [t.x, t.y]), [[VERT_ARM, 0], [-VERT_ARM, 0]], "two vertical thrusters where t3 and t4 are in the 4 layout");
  assert.deepEqual(THRUSTER_LAYOUTS[8].filter((t) => t.kind === "v").map((t) => [t.x, t.y]).sort(), [[-0.2, -0.2], [-0.2, 0.2], [0.2, -0.2], [0.2, 0.2]], "four vertical thrusters on the corners");
  const v3 = THRUSTER_LAYOUTS[3].filter((t) => t.kind === "v");
  assert.equal(v3.length, 1); assert.deepEqual([v3[0].x, v3[0].y], [0, 0]);
});

test("the channels follow the layout; a channel the layout lacks is ignored; switching layout zeroes the commands", () => {
  for (const n of [3, 4, 6, 8]) {
    const r = new Rov({ thrusters: n });
    assert.deepEqual(Object.keys(r.cmd), Array.from({ length: n }, (_, i) => `t${i + 1}`));
    const s = JSON.parse(JSON.stringify(r.state()));
    assert.equal(s.thrusters, n); assert.equal(s.layout.length, n);
    for (let i = 1; i <= n; i++) assert.ok(`t${i}` in s); assert.ok(!(`t${n + 1}` in s));
  }
  const r = new Rov({ thrusters: 4 });
  assert.equal(r.set_cmd("t5", 1.0), false); assert.ok(!("t5" in r.cmd));
  assert.ok(r.set_cmd("t1", 5.0)); assert.equal(r.cmd.t1, 1.0, "clamped");
  r.set_cmd("t3", 0.5);
  r.set_layout(6);
  assert.deepEqual(Object.keys(r.cmd), ["t1", "t2", "t3", "t4", "t5", "t6"]);
  assert.ok(Object.values(r.cmd).every((v) => v === 0.0));
});

test("six thrusters: forward, a pure turn and a sideways slide come from the vectored posts", () => {
  const fwd = drive(6, { t1: 1, t2: 1, t3: 1, t4: 1 });
  assert.ok(fwd.x + 2 > 1.0 && Math.abs(fwd.y) < 1e-9 && Math.abs(fwd.yaw) < 1e-9, `straight ahead (x ${fwd.x.toFixed(2)}, y ${fwd.y}, yaw ${fwd.yaw})`);
  const turn = drive(6, { t1: 1, t3: 1, t2: -1, t4: -1 });
  assert.ok(turn.yaw < -1.0 && Math.abs(turn.x + 2) < 1e-6 && Math.abs(turn.y) < 1e-6, "a pure turn to the right (clockwise, yaw negative)");
  const strafe = drive(6, { t1: 1, t4: 1, t2: -1, t3: -1 });
  assert.ok(strafe.y < -0.5 && Math.abs(strafe.yaw) < 1e-9 && Math.abs(strafe.x + 2) < 1e-6, `slide to the RIGHT (y ${strafe.y.toFixed(2)})`);
  const left = drive(6, { t2: 1, t3: 1, t1: -1, t4: -1 });
  assert.ok(left.y > 0.5 && Math.abs(left.yaw) < 1e-9, "and the mirror image slides left");
  assert.ok(fwd.x > drive(4, { t1: 1, t2: 1 }).x, "four thrusters push harder than two");
  const pivot = drive(4, { t1: 1, t2: -1 });
  assert.ok(Math.abs(pivot.y) < 1e-6 && Math.abs(pivot.x + 2) < 1e-6 && pivot.yaw < -0.5, "the 4 layout can only pivot, never slide");
});

test("eight has the same horizontal control as six", () => {
  for (const cmds of [{ t1: 1, t2: 1, t3: 1, t4: 1 }, { t1: 1, t3: 1, t2: -1, t4: -1 }, { t1: 1, t4: 1, t2: -1, t3: -1 }]) {
    const a = drive(6, cmds), b = drive(8, cmds);
    assert.ok(near(a.x, b.x) && near(a.y, b.y) && near(a.yaw, b.yaw), JSON.stringify(cmds));
  }
});

test("three thrusters: one vertical is half the vertical push and cannot pitch", () => {
  const up3 = drive(3, { t3: 1 }, 1.0), up4 = drive(4, { t3: 1, t4: 1 }, 1.0);
  assert.ok(1.0 - up3.depth > 0 && 1.0 - up3.depth < 1.0 - up4.depth, "it rises, but not as fast as with two");
  assert.equal(up3.pitch, 0); assert.ok(Math.abs(up3.roll) < 1e-12, "a single thruster in the middle has no lever");
  assert.ok(Math.abs(drive(4, { t3: 1 }, 1.0).pitch) > 0.01, "one of two off-centre thrusters does tilt the ROV");
  assert.ok(near(drive(3, { t1: 1, t2: 1 }).x, drive(4, { t1: 1, t2: 1 }).x), "the side thrusters are the same as in the 4 layout");
});

test("eight: four corner vertical thrusters lift more, and pitch and roll the ROV", () => {
  const up8 = drive(8, { t5: 1, t6: 1, t7: 1, t8: 1 }, 1.0), up4 = drive(4, { t3: 1, t4: 1 }, 1.0);
  assert.ok(1.0 - up8.depth > 1.3 * (1.0 - up4.depth));
  assert.ok(Math.abs(up8.pitch) < 1e-12 && Math.abs(up8.roll) < 1e-12, "a level push does not tilt");
  const roll = drive(8, { t5: 1, t7: 1, t6: -1, t8: -1 }, 1.0);
  assert.ok(roll.roll > 0.1 && Math.abs(roll.pitch) < 1e-9, `left side up: roll positive (${deg(roll.roll)} deg)`);
  const rev = drive(8, { t6: 1, t8: 1, t5: -1, t7: -1 }, 1.0);
  assert.ok(rev.roll < -0.1 && near(rev.roll, -roll.roll));
  const nose = drive(8, { t5: 1, t6: 1, t7: -1, t8: -1 }, 1.0);
  assert.ok(nose.pitch < -0.1 && Math.abs(nose.roll) < 1e-9, `front up, rear down: nose UP (${deg(nose.pitch)} deg)`);
  assert.ok(Math.abs(drive(6, { t5: 1, t6: -1 }, 1.0).roll) < 1e-12, "the 6 layout cannot roll the ROV");
});

test("a corner propeller out of the water loses its push", () => {
  const levels = [];
  for (const depth of [1.0, -0.15]) {
    const r = new Rov({ buoyancy: 0.0, tool: "nose", thrusters: 8 });
    r.depth = depth; r.roll = 0.1;
    for (const k of ["t5", "t6", "t7", "t8"]) r.set_cmd(k, 1.0);
    r.step(DT);
    levels.push(r.roll_rate);
  }
  assert.ok(levels[1] < levels[0] - 0.001, `near the surface the raised side pushes less: ${levels}`);
});

test("the collision shape follows the layout", () => {
  const count = (n) => capsules(new Rov({ thrusters: n })).filter((c) => c[3] === "thruster").length;
  assert.deepEqual([3, 4, 6, 8].map(count), [4 + 3, 4 + 6, 8 + 6, 8 + 12]);
  const r6 = new Rov({ thrusters: 6 });
  const th = capsules(r6).filter((c) => c[3] === "thruster");
  const xs = th.flatMap((c) => [c[0][0] - r6.x, c[1][0] - r6.x]), ys = th.flatMap((c) => [c[0][1] - r6.y, c[1][1] - r6.y]);
  assert.ok(Math.max(...xs) > 0.3 && Math.min(...xs) < -0.3 && Math.max(...ys) > 0.3 && Math.min(...ys) < -0.3, "the posts' thrusters stick out at all four corners");
  const r = new Rov({ thrusters: 4 });
  const k1 = capsules(r); r.set_layout(6);
  assert.notEqual(capsules(r), k1); assert.notEqual(capsules(r).length, k1.length, "the shape cache notices a layout change");
});

test("a ring is still pushed ahead by a ROV with corner thrusters", () => {
  const r = new Rov({ buoyancy: 0.0, tool: "nose", thrusters: 6 });
  addRings(r, 1);
  const ring = r.props.find((p) => p.type === "ring");
  ring.x = 0.0; ring.y = 0.3; ring.yaw = Math.PI / 2;
  r.x = -1.0; r.y = 0.3; r.yaw = 0.0; r.depth = 1.55;
  for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, 0.6);
  for (let i = 0; i < 60 * 4; i++) r.step(DT);
  assert.ok(ring.x > r.x, `ring x ${ring.x.toFixed(2)}, ROV x ${r.x.toFixed(2)}`);
});

test("the speed setting scales every horizontal thruster but not the vertical ones; eight thrusters run at 60 Hz", () => {
  const cmds = { t1: 1, t2: 1, t3: 1, t4: 1, t5: 1 };
  const a = drive(6, cmds, 0.5, 1.0, { speed: 1.0 }), b = drive(6, cmds, 0.5, 1.0, { speed: 2.0 });
  assert.ok(b.u > 1.6 * a.u); assert.ok(near(a.w, b.w));
  const r = new Rov({ buoyancy: 1.5, tool: "claw", thrusters: 8 });
  const t = performance.now();
  for (let i = 0; i < 600; i++) { for (const k of Object.keys(r.cmd)) r.set_cmd(k, 0.4); r.step(DT); }
  assert.ok((performance.now() - t) / 600 < 5.0);
});
