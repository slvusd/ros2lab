import test from "node:test";
import assert from "node:assert/strict";
import { setPool, POOL_WATER } from "../../../sim/physics.js";
import { PLAQUES } from "../plaques.js";
import { MISSION_POOL, at, SPOTS } from "../layout.js";
import { SCORED } from "../scout2026.js";

test("every task has a plaque with its number, a title, what to do and the real-world thing", () => {
  const tasks = new Set(PLAQUES.map((p) => p.task));
  for (const t of ["1.1", "1.2", "2.1", "2.2", "2.3", "2.4", "3.1"]) assert.ok(tasks.has(t), `a plaque for task ${t}`);
  for (const p of PLAQUES) {
    assert.ok(p.title && p.text && p.real.startsWith("Real world:"), p.id);
    assert.ok(p.text.length < 80 && p.real.length < 130, `${p.id}: a few words, not a paragraph`);
  }
  assert.equal(new Set(PLAQUES.map((p) => p.id)).size, PLAQUES.length);
  assert.ok(SCORED.length === 17);
});
test("the plaques are on the floor of the main pool and do not sit on top of each other", () => {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  const m = POOL_WATER[0];
  const pts = PLAQUES.map((p) => at(...p.spot));
  for (const [x, y] of pts) assert.ok(x > m[0] + 0.3 && x < m[1] - 0.3 && y > m[2] + 0.2 && y < m[3] - 0.2, "inside the main pool");
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    assert.ok(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) > 0.7, `${PLAQUES[i].id} and ${PLAQUES[j].id} are apart`);
  }
});

import { PLAQUE_ACROSS, PLAQUE_ALONG, snapPlaque, TILE } from "../plaques.js";
test("a plaque is two floor tiles, snapped to the tile grid, and the plaques do not overlap each other or the props", () => {
  setPool(MISSION_POOL.poollength, MISSION_POOL.poolwidth, MISSION_POOL.pooldepth);
  assert.equal(PLAQUE_ALONG, 2 * TILE); assert.equal(PLAQUE_ACROSS, TILE);
  const rects = PLAQUES.map((p) => { const [x, y] = snapPlaque(...at(...p.spot)); return { id: p.id, x, z: -y }; });
  for (const r of rects) {
    assert.ok(Math.abs(((r.x - TILE / 2) / TILE) - Math.round((r.x - TILE / 2) / TILE)) < 1e-9, `${r.id}: x on a tile middle`);
    assert.ok(Math.abs(r.z / TILE - Math.round(r.z / TILE)) < 1e-9, `${r.id}: z on a tile edge`);
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(Math.abs(a.x - b.x) >= PLAQUE_ACROSS - 1e-9 || Math.abs(a.z - b.z) >= PLAQUE_ALONG - 1e-9, `${a.id} and ${b.id} do not overlap`);
  }
  const props = [SPOTS.edna, SPOTS.observatory, SPOTS.pot, SPOTS.stand, SPOTS.waypoint, SPOTS.oilPort, [1.6, 0.9], [2.9, -1.0], [2.3, 0.8], [3.3, -0.6], [1.2, -0.9], [3.4, 0.9], [1.0, -2.3]].map((s) => at(...s));
  for (const r of rects) for (const [px, py] of props) {
    const inside = Math.abs(px - r.x) < PLAQUE_ACROSS / 2 + 0.12 && Math.abs(-py - r.z) < PLAQUE_ALONG / 2 + 0.12;
    assert.ok(!inside, `${r.id} does not sit on a prop at (${px.toFixed(2)}, ${py.toFixed(2)})`);
  }
});
