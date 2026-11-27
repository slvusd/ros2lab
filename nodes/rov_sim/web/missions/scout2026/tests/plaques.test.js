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
