// Fish behaviour tests, ported from test_physics.py. The JS fish uses its own random numbers (see rng.js), so these check
// BEHAVIOUR (never caught, not stuck, peeks, respects the step), not exact paths. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS } from "../physics.js";
import { CAM_POS, localToWorld } from "../shape.js";
import { Fish, addTo } from "../fishbrain.js";

const DT = 1 / 60;
const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clampU = (v) => Math.max(-1, Math.min(1, v));
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const insidePool = (x, y) => POOL_REGIONS.some((r) => r[0] - 1e-6 <= x && x <= r[1] + 1e-6 && r[2] - 1e-6 <= y && y <= r[3] + 1e-6);
const floorUnder = (x, y, eps = 1e-4) => {
  const ds = POOL_REGIONS.filter((r) => r[0] - eps <= x && x <= r[1] + eps && r[2] - eps <= y && y <= r[3] + eps).map((r) => r[4]);
  return ds.length ? Math.max(...ds) : null;
};

function withFish(opts = {}, seed = null) {
  const r = new Rov({ tool: "claw", ...opts });
  addTo(r, 1);
  const fish = r.props[0];
  if (seed !== null) { fish.seed = seed; fish.reset(); }
  return [r, fish];
}
/** autopilot: steer straight at the fish at full thrust, matching its depth */
function steerAt(r, fish, speed = 1.0) {
  const err = wrap(Math.atan2(fish.y - r.y, fish.x - r.x) - r.yaw);
  r.set_cmd("t1", clampU(speed - 1.5 * err)); r.set_cmd("t2", clampU(speed + 1.5 * err));
}
function chase(r, fish, seconds) {
  let closest = 99.0;
  for (let i = 0, n = Math.floor(seconds / DT); i < n; i++) {
    steerAt(r, fish);
    const v = -clampU(2.0 * (fish.depth - r.depth));
    r.set_cmd("t3", v); r.set_cmd("t4", v);
    r.step(DT);
    closest = Math.min(closest, fish.gap);
    assert.ok(insidePool(fish.x, fish.y), `fish left the pool at (${fish.x.toFixed(2)}, ${fish.y.toFixed(2)})`);
    assert.ok(fish.depth >= 0 && fish.depth <= (floorUnder(fish.x, fish.y) ?? 0) + 1e-6, `fish depth ${fish.depth.toFixed(2)} outside the water`);
  }
  return closest;
}

test("the fish is never caught (a ROV chases it flat out for minutes)", () => {
  let worst = 99.0, darts = 0;
  for (let seed = 0; seed < 4; seed++) {
    const [r, fish] = withFish({ buoyancy: 0.0 }, 100 + seed);
    r.depth = 0.9;
    worst = Math.min(worst, chase(r, fish, 120));
    darts += fish.darts;
  }
  assert.ok(worst >= Fish.SAFE_HARD - 0.03, `the ROV got within ${(worst * 100).toFixed(0)} cm of the fish`);
  assert.ok(darts <= 40, `the fish had to dart ${darts} times in 8 minutes of relentless chasing`);
});

test("the fish does not get stuck in corners while chased", () => {
  const cornerDistance = (x, y) => Math.min(...POOL_REGIONS.flatMap((r) => [r[0], r[1]].flatMap((cx) => [r[2], r[3]].map((cy) => Math.hypot(x - cx, y - cy)))));
  let near = 0, steps = 0, longestStuck = 0;
  for (const seed of [11, 18, 25]) {
    const [r, fish] = withFish({ buoyancy: 0.0, speed: 2.0 }, seed);       // speed 2: a chaser as strong as the ROV used to be (the default was halved)
    r.x = -2.5; r.y = -1.0; r.depth = 1.0;
    let last = [fish.x, fish.y, fish.depth], still = 0;
    for (let i = 0; i < 60 * 80; i++) {
      steerAt(r, fish);
      const v = -clampU(2.0 * (fish.depth - r.depth));
      r.set_cmd("t3", v); r.set_cmd("t4", v);
      r.step(DT);
      steps++;
      near += cornerDistance(fish.x, fish.y) < 0.8 ? 1 : 0;
      const moved = dist3([fish.x, fish.y, fish.depth], last);
      last = [fish.x, fish.y, fish.depth];
      still = fish.speed > 1.0 && moved < 0.005 ? still + 1 : 0;
      longestStuck = Math.max(longestStuck, still);
    }
  }
  assert.ok(near / steps < 0.20, `${(near / steps * 100).toFixed(0)}% of the time in a corner`);
  assert.ok(longestStuck < 60, `pressed against a wall for ${(longestStuck / 60).toFixed(1)} s`);
});

test("the fish peeks at a still ROV and stays wary of a moving one", () => {
  const [r, fish] = withFish({ buoyancy: 0.0 });
  r.x = -2.0; r.y = 0.0; r.depth = 1.0; r.yaw = 0.0;
  fish.x = 1.0; fish.y = 0.5; fish.depth = 1.0;
  let peek = 0, closestLens = 99.0, worstGap = 99.0;
  for (let i = 0; i < 60 * 150; i++) {
    r.step(DT);
    if (fish.mode === "peek") peek++;
    const [cx, cy, cu] = localToWorld(r, ...CAM_POS);
    closestLens = Math.min(closestLens, dist3([cx, cy, cu], [fish.x, fish.y, -fish.depth]));
    worstGap = Math.min(worstGap, fish.gap);
  }
  assert.ok(peek > 60 * 20, `only ${(peek / 60).toFixed(0)} s peeking at a ROV that sat still for 2.5 minutes`);
  assert.ok(closestLens < 1.1, `never came within ${closestLens.toFixed(2)} m of the camera`);
  assert.ok(worstGap >= Fish.SAFE_HARD - 0.03, `got within ${(worstGap * 100).toFixed(0)} cm of the ROV`);
  for (let i = 0; i < 60 * 10; i++) { steerAt(r, fish); r.step(DT); worstGap = Math.min(worstGap, fish.gap); }
  assert.ok(!fish.trusting, "the fish still trusted a ROV that is chasing it");
  assert.ok(worstGap >= Fish.SAFE_HARD - 0.03, `the moving ROV got within ${(worstGap * 100).toFixed(0)} cm`);
});

test("the fish peeks promptly at a default ROV floating at the surface", () => {
  for (const seed of [11, 25, 39]) {
    const [r, fish] = withFish({}, seed);                       // default buoyancy: +1.5 N
    r.x = -1.5; r.y = 0.0; r.depth = 0.8; r.yaw = 0.0;
    let first = null, peek = 0, spooked = 0, prev = null, near = 0;
    for (let i = 0; i < 60 * 150; i++) {
      r.step(DT);
      if (fish.mode === "peek") {
        peek++;
        if (first === null) first = i / 60;
        const [cx, cy, cu] = localToWorld(r, ...CAM_POS);
        if (dist3([cx, cy, cu], [fish.x, fish.y, -fish.depth]) < 1.1) near++;
      }
      if (prev === "peek" && fish.mode === "flee") spooked++;
      prev = fish.mode;
    }
    assert.ok(first !== null && first < 30, `seed ${seed}: first peek only at ${first}`);
    assert.ok(peek > 60 * 40, `seed ${seed}: peeked for only ${(peek / 60).toFixed(0)} s of 150`);
    assert.ok(near > 60 * 8, `seed ${seed}: within 1.1 m of the lens for only ${(near / 60).toFixed(0)} s`);
    assert.ok(spooked <= 3, `seed ${seed}: spooked itself ${spooked} times`);
  }
});

test("a fish deeper than the shallow end never goes over its shelf", () => {
  const [r, fish] = withFish({});
  r.x = -2.5; r.y = -1.0;
  let bad = 0;
  for (let i = 0; i < 60 * 120; i++) { r.step(DT); if (fish.y > 1.55 && fish.depth > 0.75) bad++; }
  assert.equal(bad, 0, `fish was deeper than the shallow end's floor allows on ${bad} steps`);
});

test("the fish wanders and swims at sane speeds", () => {
  const [r, fish] = withFish({});
  r.x = -2.5; r.y = -1.0;
  const xs = [], ys = []; let maxSpeed = 0;
  for (let i = 0; i < 60 * 60; i++) { r.step(DT); xs.push(fish.x); ys.push(fish.y); maxSpeed = Math.max(maxSpeed, fish.speed); }
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1.0 || Math.max(...ys) - Math.min(...ys) > 1.0, "the fish barely moved in a minute");
  assert.ok(maxSpeed < 2.0 + 1e-9, `fish speed reached ${maxSpeed.toFixed(1)} m/s`);
});

test("physics + fish run fast enough for 60 Hz", () => {
  const [r] = withFish({});
  r.x = -0.3; r.y = 0.0; r.yaw = 0.0; r.depth = 1.6;
  const t = performance.now();
  for (let i = 0; i < 600; i++) { r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT); }
  const ms = (performance.now() - t) / 600;
  assert.ok(ms < 5.0, `${ms.toFixed(2)} ms per step is too slow for 60 Hz`);
});

test("the shelf is open only to a fish shallow enough for it", () => {
  const [, fish] = withFish({});
  const shelf = POOL_REGIONS.find((r) => r[4] === 1.0);
  assert.ok(!fish._openRegions(1.5).includes(shelf), "a deep fish may be over the shelf");
  assert.ok(!fish._openRegions(0.75).includes(shelf), "a fish deeper than the shelf floor minus its margin may be over the shelf");
  assert.ok(fish._openRegions(0.5).includes(shelf), "a shallow fish may not enter the shelf");
});
