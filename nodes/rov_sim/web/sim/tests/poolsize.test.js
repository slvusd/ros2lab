// The main pool can be 1-2 times longer and 1-3 times wider (whole numbers). Everything must still work in every size:
// the ROV stays inside and above the floors, rings and the fish stay in the water, the fish is never caught, the shelf stays joined.
// (node runs each test file in its own process, so changing the pool here cannot leak into other files.)
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Rov, POOL_REGIONS, POOL_MAX_DEPTH, ROV_BOTTOM, setPool, poolRegions, floorAt, nearestIn } from "../physics.js";
import { addTo as addRings } from "../rings.js";
import { addTo as addFish, Fish } from "../fishbrain.js";
import { addTo as addCrabs } from "../crab.js";
import { addTo as addCurrent } from "../current.js";
import { Rng } from "../rng.js";

const DT = 1 / 60;
const SIZES = [[1, 1], [2, 1], [1, 3], [2, 3], [2, 2]];
const inside = (x, y) => POOL_REGIONS.some((r) => r[0] - 1e-6 <= x && x <= r[1] + 1e-6 && r[2] - 1e-6 <= y && y <= r[3] + 1e-6);
after(() => setPool(1, 1));

test("the default size is the original pool", () => {
  assert.deepEqual(poolRegions(1, 1), [[-3, 3, -1.5, 1.5, 2], [0.5, 3, 1.5, 4, 1]]);
});

test("sizes: 6 m x length, 3 m x width, the ROV start stays inside near the near wall, the shelf stays joined and the same size", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    const [main, shelf] = POOL_REGIONS;
    assert.equal(main[1] - main[0], 6 * L, `length ${L}`);
    assert.equal(main[3] - main[2], 3 * W, `width ${W}`);
    assert.equal(main[0], -3, "the near wall does not move");
    assert.equal(main[2], -main[3], "the pool grows evenly either side of the start line");
    assert.equal(shelf[1] - shelf[0], 2.5); assert.equal(shelf[3] - shelf[2], 2.5);
    assert.equal(shelf[1], main[1], "the shelf is flush with the far wall");
    assert.equal(shelf[2], main[3], "the shelf is joined along the main pool's side wall");
    assert.ok(shelf[0] >= main[0] && shelf[1] <= main[1]);
    const rov = new Rov();
    assert.ok(inside(rov.x, rov.y) && floorAt(rov.x, rov.y) === 2, `the ROV starts in the deep water (${L}x${W})`);
  }
});

test("setPool clamps and rounds", () => {
  setPool(9, 9); assert.equal(POOL_REGIONS[0][1] - POOL_REGIONS[0][0], 12); assert.equal(POOL_REGIONS[0][3] - POOL_REGIONS[0][2], 9);
  setPool(0, -3); assert.equal(POOL_REGIONS[0][1] - POOL_REGIONS[0][0], 6); assert.equal(POOL_REGIONS[0][3] - POOL_REGIONS[0][2], 3);
  setPool(1.6, 2.4); assert.equal(POOL_REGIONS[0][1] - POOL_REGIONS[0][0], 12); assert.equal(POOL_REGIONS[0][3] - POOL_REGIONS[0][2], 6);
  assert.equal(POOL_MAX_DEPTH, 2);
});

test("random driving stays inside every pool size and above every floor", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    const rng = new Rng(7 * L + W), uni = (a, b) => rng.uniform(a, b);
    let worstOut = 0, worstFloor = 0;
    for (let n = 0; n < 6; n++) {
      const r = new Rov({ buoyancy: [0.0, -1.5, 1.5][n % 3] });
      r.depth = uni(0.3, 1.7);
      r.x = uni(-2.5, 2.5); r.y = uni(-1, 1); r.yaw = uni(0, 6.28);
      for (let i = 0; i < 60 * 25; i++) {
        if (i % 80 === 0) for (const k of ["t1", "t2", "t3", "t4"]) r.set_cmd(k, uni(-1, 1));
        r.step(DT);
        for (const [wx, wy] of r._footprint(Math.cos(r.yaw), Math.sin(r.yaw))) {
          if (!inside(wx, wy)) { const [qx, qy] = nearestIn(POOL_REGIONS, wx, wy); worstOut = Math.max(worstOut, Math.hypot(qx - wx, qy - wy)); }
          const ds = POOL_REGIONS.filter((q) => q[0] - 1e-4 <= wx && wx <= q[1] + 1e-4 && q[2] - 1e-4 <= wy && wy <= q[3] + 1e-4).map((q) => q[4]);
          if (ds.length) worstFloor = Math.max(worstFloor, r.depth + ROV_BOTTOM - Math.max(...ds));
        }
      }
    }
    assert.ok(worstOut < 1e-6, `${L}x${W}: left the pool by ${worstOut.toFixed(4)} m`);
    assert.ok(worstFloor < 1e-6, `${L}x${W}: went through a floor by ${worstFloor.toFixed(4)} m`);
  }
});

test("rings (up to 5) rest inside the water on the floor in every pool size", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    const r = new Rov({ tool: "nose", buoyancy: 0 });
    addRings(r, 5);
    for (let i = 0; i < 300; i++) r.step(DT);
    for (const ring of r.props) {
      for (const [x, y] of ring._footprint()) assert.ok(inside(x, y), `${L}x${W}: a ring is out of the pool at (${x.toFixed(2)}, ${y.toFixed(2)})`);
      assert.ok(Math.abs(ring.depth - ring.floor) < 1e-6, `${L}x${W}: a ring is not on the floor`);
    }
  }
});

test("the fish stays in the water and is never caught in every pool size", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    let worst = 99;
    for (const seed of [3, 4]) {
      const r = new Rov({ tool: "claw", buoyancy: 0 });
      addRings(r, 3); addFish(r, 1);
      const fish = r.props.find((p) => p.type === "fish");
      fish.seed = seed; fish.reset();
      r.depth = 0.9;
      for (let i = 0; i < 60 * 90; i++) {
        const err = Math.atan2(fish.y - r.y, fish.x - r.x) - r.yaw, e = Math.atan2(Math.sin(err), Math.cos(err));
        r.set_cmd("t1", Math.max(-1, Math.min(1, 1 - 1.5 * e))); r.set_cmd("t2", Math.max(-1, Math.min(1, 1 + 1.5 * e)));
        const v = -Math.max(-1, Math.min(1, 2 * (fish.depth - r.depth)));
        r.set_cmd("t3", v); r.set_cmd("t4", v);
        r.step(DT);
        worst = Math.min(worst, fish.gap);
        assert.ok(inside(fish.x, fish.y), `${L}x${W}: the fish left the pool`);
        assert.ok(fish.depth >= 0 && fish.depth <= (floorAt(fish.x, fish.y) ?? 0) + 1e-6, `${L}x${W}: the fish is out of the water`);
      }
    }
    assert.ok(worst >= Fish.SAFE_HARD - 0.03, `${L}x${W}: the ROV got within ${(worst * 100).toFixed(0)} cm of the fish`);
  }
});

test("with no camera the fish never comes to look; with one it does", () => {
  for (const peeks of [true, false]) {
    setPool(1, 1);
    const r = new Rov({ tool: "claw", buoyancy: 0 });
    addFish(r, 1);
    const fish = r.props[0];
    fish.peeks = peeks;
    r.x = -2.0; r.y = 0; r.depth = 1.0; r.yaw = 0;
    fish.x = 1.0; fish.y = 0.5; fish.depth = 1.0;
    let peeking = 0;
    for (let i = 0; i < 60 * 120; i++) { r.step(DT); if (fish.mode === "peek") peeking++; }
    if (peeks) assert.ok(peeking > 60 * 10, `only ${(peeking / 60).toFixed(0)} s peeking`);
    else assert.equal(peeking, 0, "a fish came to look at a camera that is not there");
  }
});

test("the crab lives on the shallow end whatever size the main pool is", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    const shelf = POOL_REGIONS[1];
    const r = new Rov({ tool: "nose", buoyancy: 0 });
    addCrabs(r, 3);
    r.x = -2.5; r.y = -1.0;
    for (let i = 0; i < 60 * 60; i++) {
      r.step(DT);
      for (const c of r.props) assert.ok(c.x >= shelf[0] - 1e-6 && c.x <= shelf[1] + 1e-6 && c.y >= shelf[2] - 1e-6 && c.y <= shelf[3] + 1e-6, `${L}x${W}: a crab left the shallow end`);
    }
    assert.ok(Math.abs(r.props[0].state().depth - (shelf[4] - 0.02)) < 1e-9, `${L}x${W}: not on the floor`);
  }
});

test("the outlets stay in the middle of the shelf-side wall at a third and two thirds depth in every pool size, and the current stays inside the pool", () => {
  for (const [L, W] of SIZES) {
    setPool(L, W);
    const [main, shelf] = POOL_REGIONS;
    const r = new Rov({ tool: "nose", buoyancy: 0 });
    addCurrent(r);
    const j = r.props[0];
    for (const o of j.outlets) {
      assert.equal(o.y, main[3], `${L}x${W}: on the shelf side wall`);
      assert.ok(Math.abs(o.x - (main[0] + shelf[0]) / 2) < 1e-9, `${L}x${W}: in the middle of the wall before the shallow end opens`);
    }
    assert.deepEqual(j.outlets.map((o) => +o.depth.toFixed(6)).sort(), [+(main[4] / 3).toFixed(6), +(2 * main[4] / 3).toFixed(6)]);
    assert.equal(j.length, main[3] - main[2]);
    // a ROV drifting in it never leaves the pool
    r.x = j.outlets[0].x; r.y = main[3] - 1.0; r.depth = j.outlets[0].depth;
    for (let i = 0; i < 60 * 40; i++) { r.step(DT); assert.ok(inside(r.x, r.y), `${L}x${W}: the current pushed the ROV out of the pool`); }
  }
});
