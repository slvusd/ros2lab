// Pool tests, ported from test_physics.py ("the pool" section). Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS, ROV_BOTTOM, floorAt, nearestIn } from "../physics.js";

const DT = 1 / 60;

function run(r, seconds, cmd = {}) {
  for (const [k, v] of Object.entries(cmd)) r.set_cmd(k, v);
  for (let i = 0, n = Math.floor(seconds / DT); i < n; i++) r.step(DT);
  for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, 0);
}
function floorUnder(x, y, eps = 1e-4) {             // like floorAt but forgiving by 0.1 mm
  const ds = POOL_REGIONS.filter((r) => r[0] - eps <= x && x <= r[1] + eps && r[2] - eps <= y && y <= r[3] + eps).map((r) => r[4]);
  return ds.length ? Math.max(...ds) : null;
}
const insidePool = (x, y) => POOL_REGIONS.some((r) => r[0] - 1e-6 <= x && x <= r[1] + 1e-6 && r[2] - 1e-6 <= y && y <= r[3] + 1e-6);
function rng(seed) {                                // mulberry32: small seeded PRNG (the Python test uses random.seed(1))
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("random driving stays inside the pool and above every floor", () => {
  const rand = rng(1), uni = (a, b) => a + (b - a) * rand();
  let worstOut = 0, worstFloor = 0;
  for (let n = 0; n < 25; n++) {
    const r = new Rov({ buoyancy: [0.0, -1.5, 1.5][Math.floor(rand() * 3)] });
    r.depth = uni(0.3, 1.7);
    r.x = uni(-2.5, 2.5); r.y = uni(-1, 1); r.yaw = uni(0, 6.28);
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 80 === 0) for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, uni(-1, 1));
      r.step(DT);
      for (const [wx, wy] of r._footprint(Math.cos(r.yaw), Math.sin(r.yaw))) {
        if (!insidePool(wx, wy)) {
          const [qx, qy] = nearestIn(POOL_REGIONS, wx, wy);
          worstOut = Math.max(worstOut, Math.hypot(qx - wx, qy - wy));
        }
        const f = floorUnder(wx, wy);
        if (f !== null) worstFloor = Math.max(worstFloor, r.depth + ROV_BOTTOM - f);
      }
    }
  }
  assert.ok(worstOut < 1e-6, `left the pool by ${worstOut.toFixed(4)} m`);
  assert.ok(worstFloor < 1e-6, `went through a floor by ${worstFloor.toFixed(4)} m`);
});

test("the step to the shallow end is a wall to a deep ROV", () => {
  const r = new Rov({ buoyancy: 0.0 });
  r.depth = 1.5; r.x = 1.5; r.y = 0.0; r.yaw = Math.PI / 2;
  run(r, 6, { t1: 1, t2: 1 });
  assert.ok(r.y + 0.6 <= 1.5 + 1e-6, `tool tip got over the step (y=${(r.y + 0.6).toFixed(2)})`);
  assert.ok(Math.abs(r.depth - 1.5) < 1e-6, "touching the step changed the depth");
});

test("a shallow ROV passes onto the shelf and rests on its floor", () => {
  const r = new Rov({ buoyancy: 0.0 });
  r.depth = 0.5; r.x = 1.5; r.y = 0.0; r.yaw = Math.PI / 2;
  run(r, 3, { t1: 1, t2: 1 });
  run(r, 3);
  assert.ok(r.y > 2.0, "a shallow ROV could not get onto the shelf");
  run(r, 6, { t3: -1, t4: -1 });
  assert.ok(Math.abs(r.depth - 0.72) < 0.01 && r.y > 2.0, `diving over the shelf ended at depth ${r.depth.toFixed(2)}, y ${r.y.toFixed(2)}`);
});

test("no upward jump from any legal pose (the 'bounce to shallow depth' bug)", () => {
  let bad = 0, checked = 0;
  for (let ix = -29; ix < 30; ix += 2) {
    for (let iy = -14; iy < 40; iy += 2) {
      const x = ix * 0.1, y = iy * 0.1;
      if (floorAt(x, y) === null) continue;
      for (let k = 0; k < 8; k++) {
        const yaw = k * Math.PI / 4;
        for (const depth of [0.3, 0.6, 0.9, 1.4, 1.7]) {
          const pre = new Rov({ buoyancy: 0.0 });
          pre.x = x; pre.y = y; pre.yaw = yaw; pre.depth = depth;
          pre._walls(Math.cos(yaw), Math.sin(yaw), depth);
          if (Math.abs(pre.x - x) > 1e-9 || Math.abs(pre.y - y) > 1e-9) continue;   // not a legal starting pose
          const r = new Rov({ buoyancy: 0.0 });
          r.x = x; r.y = y; r.yaw = yaw; r.depth = depth; r.u = 0.8;
          r.step(DT);
          checked++;
          if (r.depth < depth - 1e-6) bad++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `only ${checked} poses were checked`);
  assert.equal(bad, 0, `${bad} poses where a step moved the ROV up with no thrust`);
});
