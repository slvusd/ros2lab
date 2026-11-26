import test from "node:test";
import assert from "node:assert/strict";
import { deckEye, nearestSide, crossingHeight, STAND_OUT, MAX_LEAN_OUT } from "../../deckcam.js";

const rect = { x0: -3, x1: 3, z0: -3, z1: 3 };
test("the ROV near the surface: they stand 1.2 m outside the wall at full height", () => {
  const e = deckEye(rect, 1, { x: 0, y: -0.2, z: 0 });
  assert.equal(e.outside, STAND_OUT); assert.ok(e.height > 1.7);
});
test("the ROV deep and close to the wall: the eyes go out over the water so the wall does not hide it", () => {
  for (const [w, d] of [[0.3, 1.0], [0.5, 1.5], [0.2, 1.8], [1.0, 1.5], [2.0, 1.8], [0.6, 0.8]]) {
    const pos = { x: rect.x1 - w, y: -d, z: 0.5 };
    const e = deckEye(rect, 1, pos);
    const h = crossingHeight(e.outside, e.height, w, d + 0.3);
    assert.ok(h === null || h >= 0.1, `wall ${w} m, depth ${d} m: the sight line crosses the wall at ${h === null ? "-" : h.toFixed(2)} m above the water (eyes ${e.outside.toFixed(2)} m outside)`);
    assert.ok(e.outside >= -MAX_LEAN_OUT - 1e-9 && e.outside <= STAND_OUT);
  }
  const near = deckEye(rect, 1, { x: 2.7, y: -1.5, z: 0 }), far = deckEye(rect, 1, { x: 0.5, y: -1.5, z: 0 });
  assert.ok(near.outside < far.outside, "closer to the wall: leaning further out");
  assert.ok(near.outside < 0.1, "right over the edge or beyond it");
});
test("the eyes follow the ROV along the wall and keep inside the wall's length; each side works", () => {
  assert.equal(deckEye(rect, 1, { x: 2, y: -0.5, z: 10 }).eye[2], 2.7, "clamped");
  const w = deckEye(rect, 0, { x: -2.5, y: -1.5, z: 1 });
  assert.ok(w.eye[0] > rect.x0 - 1.3 && w.eye[0] < rect.x0 + 1, "west edge");
  assert.ok(deckEye(rect, 2, { x: 1, y: -1.5, z: -2.8 }).eye[2] < rect.z0 + 1, "north edge");
  assert.ok(deckEye(rect, 3, { x: 1, y: -1.5, z: 2.8 }).eye[2] > rect.z1 - 1, "south edge");
});
test("nearestSide sticks to the current side until another is clearly nearer", () => {
  assert.equal(nearestSide(rect, { x: 2.9, z: 0 }), 1);
  assert.equal(nearestSide(rect, { x: 2.3, z: 2.0 }, 1), 1, "stays");
  assert.equal(nearestSide(rect, { x: 0, z: 2.9 }, 1), 3, "moves");
});
