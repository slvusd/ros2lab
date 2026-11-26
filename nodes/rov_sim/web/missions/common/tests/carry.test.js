// The carry engine: nose hook + hang, put down and back out, claw hold, hand to the deck and back. Run: node --test nodes/rov_sim/web/missions/
import test from "node:test";
import assert from "node:assert/strict";
import { Rov, setPool } from "../../../sim/physics.js";
import { JAW_X0, JAW_Z } from "../../../sim/shape.js";
import { Carryable, noseTip, rovPoint } from "../carry.js";

const DT = 1 / 60;
setPool(1, 1, 2);
const FLOOR = 2.0;
function make(tool = "nose") {
  const rov = new Rov({ tool, buoyancy: 0.0 });
  const item = new Carryable("box", "box", 0.0, 0.0, [{ id: "loop", up: 0.12, r: 0.06, kind: "loop" }]);
  rov.props.push(item);
  return { rov, item };
}
const run = (rov, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) rov.step(DT); };
/** Put the ROV so that its nose tip is at (x, y, z up). */
function noseAt(rov, x, y, z) { rov.yaw = 0; rov.pitch = 0; rov.x = x - 0.485; rov.y = y; rov.depth = -z - 0.195; }

test("an item lies on the floor, can be pushed along it, and a released one sinks to the floor", () => {
  const { rov, item } = make();
  rov.x = -3; rov.y = 1; rov.depth = 1;
  run(rov, 1);
  assert.equal(item.mode, "floor"); assert.equal(item.depth, FLOOR);
  item.x = 0.5; item.y = 0.5; item.depth = 0.3; item.mode = "sink";
  run(rov, 15);
  assert.equal(item.mode, "floor"); assert.equal(item.depth, FLOOR, "it sank to the floor");
  const [x0] = [item.x];
  noseAt(rov, x0 - 0.2, item.y, -FLOOR + 0.02);                                              // the nose, low down, right behind it
  rov.u = 0.4;
  run(rov, 1.5);
  assert.ok(item.x > x0 + 0.02 && item.held === null, `bumped along the floor (${x0.toFixed(2)} -> ${item.x.toFixed(2)})`);
});

test("NOSE: the tip must stay in the catch point a moment to hook it; then the item hangs from the nose and rises with it", () => {
  const { rov, item } = make();
  noseAt(rov, 0, 0, -FLOOR + 0.12);                       // the tip at the item's loop
  run(rov, 0.1);
  assert.equal(item.held, null, "not yet: it takes a moment");
  run(rov, 0.4);
  assert.equal(item.held, "nose"); assert.equal(rov.mission_carry, item);
  const base0 = item.depth;
  noseAt(rov, 0, 0, -FLOOR + 0.12 + 0.5);                 // the ROV rises 0.5 m
  run(rov, 0.5);
  assert.ok(item.depth < base0 - 0.3, `it came up with the nose (${base0.toFixed(2)} -> ${item.depth.toFixed(2)})`);
  assert.equal(item.supported, false);
  const tip = noseTip(rov);
  assert.ok(Math.abs(-item.depth + 0.12 - tip[2]) < 0.08, "and hangs with its loop at the tip");
});

test("NOSE: lowered onto the floor it rests there; backing away slides it off the nose and it stays on the floor", () => {
  const { rov, item } = make();
  noseAt(rov, 0, 0, -FLOOR + 0.12);
  run(rov, 0.5);
  assert.equal(item.held, "nose");
  noseAt(rov, 0.3, 0, -FLOOR + 0.12 + 0.4); run(rov, 0.4);             // carried off to the side and up
  noseAt(rov, 0.3, 0, -FLOOR + 0.12 - 0.05); run(rov, 0.5);             // lowered below where it can go: it rests on the floor
  assert.equal(item.supported, true); assert.equal(item.held, "nose"); assert.equal(item.depth, FLOOR);
  const at = [item.x, item.y];
  noseAt(rov, 0.3, 0.1, -FLOOR + 0.12); run(rov, 0.3);                  // the nose moves a little: still on the nose
  assert.equal(item.held, "nose");
  noseAt(rov, 0.3 - 0.35, 0.0, -FLOOR + 0.12); run(rov, 0.3);          // backs away 35 cm
  assert.equal(item.held, null); assert.equal(rov.mission_carry, null, "the nose is free again");
  assert.ok(Math.hypot(item.x - at[0], item.y - at[1]) < 0.2, "the item stayed where it was put down");
  run(rov, 2);
  assert.equal(item.mode, "floor");
});

test("NOSE: a second item cannot be hooked while the nose is busy", () => {
  const { rov, item } = make();
  const other = new Carryable("other", "box", 0.0, 0.0, [{ id: "loop", up: 0.12, r: 0.06, kind: "loop" }]);
  rov.props.push(other);
  noseAt(rov, 0, 0, -FLOOR + 0.12);
  run(rov, 0.6);
  assert.ok((item.held === "nose") !== (other.held === "nose"), "exactly one of two items in the same spot is hooked");
});

test("CLAW: an item between the open jaws is held when the claw closes, carried, and dropped when it opens", () => {
  const { rov, item } = make("claw");
  rov.yaw = 0; rov.pitch = 0; rov.x = -(JAW_X0 + 0.07); rov.y = 0; rov.depth = FLOOR - 0.12 + JAW_Z * -1 - 0.0;     // the jaws at the loop's height
  rov.depth = -(-FLOOR + 0.12 - JAW_Z);
  rov.claw = 0.9; rov.claw_target = 0.9;
  run(rov, 0.3);
  assert.equal(item.held, null, "open jaws do not grip");
  rov.claw_target = 0.0;
  run(rov, 1.5);
  assert.equal(item.held, "claw"); assert.equal(rov.claw_holder, item);
  rov.x += 1.0; rov.depth -= 0.5; run(rov, 0.1);
  assert.ok(Math.abs(item.x - (rov.x + JAW_X0 + 0.07)) < 0.1, "it moves with the ROV");
  rov.claw_target = 1.0;
  run(rov, 0.2);
  assert.equal(item.held, null); assert.equal(rov.claw_holder, null);
});

test("the crew takes an item to the deck and gives it back onto the nose", () => {
  const { rov, item } = make();
  noseAt(rov, 0, 0, -FLOOR + 0.12);
  run(rov, 0.6);
  assert.equal(item.held, "nose");
  item.toDeck(rov, [4.0, 2.0]);
  assert.equal(item.mode, "deck"); assert.equal(rov.mission_carry, null); assert.deepEqual([item.x, item.y], [4.0, 2.0]);
  assert.equal(item.state().mode, "deck");
  run(rov, 1);
  assert.equal(item.mode, "deck", "it stays on the deck");
  rov.x = 1; rov.y = 1; rov.depth = 0.4;
  assert.equal(item.giveTo(rov), true);
  assert.equal(item.held, "nose"); assert.equal(rov.mission_carry, item);
  const tip = noseTip(rov);
  assert.ok(Math.hypot(item.x - tip[0], item.y - tip[1]) < 1e-6, "it hangs at the tip");
  const other = new Carryable("o2", "box", null, null, [{ id: "loop", up: 0.1, r: 0.05, kind: "loop" }]);
  assert.equal(other.mode, "deck", "an item with no start position starts on the deck");
  assert.equal(other.giveTo(rov), false, "the nose is busy");
});

test("an item that only a claw can catch is refused by the nose", () => {
  const { rov } = make();
  const clawOnly = new Carryable("c", "box", null, null, [{ id: "pipe", up: 0.1, r: 0.03, kind: "claw" }]);
  assert.equal(clawOnly.giveTo(rov), false);
});
