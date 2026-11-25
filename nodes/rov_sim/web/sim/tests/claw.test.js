// The claw through the page's own path (World.command, as the H and [ ] keys send it): open, close around a ring, carry, let go.
import test from "node:test";
import assert from "node:assert/strict";
import { Rov } from "../physics.js";
import { World, DT } from "../world.js";
import { addTo as addRings } from "../rings.js";

function setup() {
  const rov = new Rov({ tool: "claw", buoyancy: 0.0 });
  addRings(rov, 1);
  const world = new World(rov);
  const [ring] = rov.props;
  rov.x = -1.0; rov.y = 0.0; rov.yaw = 0.0; rov.depth = 1.5;
  ring.x = rov.x + 0.5; ring.y = rov.y - ring.R; ring.depth = rov.depth + 0.25;
  return { rov, world, ring };
}
let clock = 0;
const advance = (world, seconds) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { clock += DT * 1000; world.advance(clock); } };

test("H opens the claw, H again squeezes: the ring is gripped and carried up", () => {
  const { rov, world, ring } = setup();
  world.advance(clock);
  world.command({ t1: 0, t2: 0, t3: 0, t4: 0, claw: 1 });        // H: open
  advance(world, 1.0);
  assert.ok(rov.claw > 0.95, `claw only ${rov.claw.toFixed(2)} open`);
  assert.ok(ring.in_jaws, "the ring should be between the open jaws");
  assert.equal(world.state().props[0].inJaws, true, "the page is told the ring is between the jaws");
  world.command({ t1: 0, t2: 0, t3: 0, t4: 0, claw: 0 });        // H again: close
  advance(world, 1.0);
  assert.ok(ring.held && rov.claw_holder === ring, "claw did not grip");
  world.command({ t1: 0, t2: 0, t3: 0.6, t4: 0.6, claw: 0 });    // R: rise
  advance(world, 3.0);
  assert.ok(ring.held && ring.depth < 1.0, `ring did not come up (depth ${ring.depth.toFixed(2)})`);
  world.command({ t1: 0, t2: 0, t3: 0, t4: 0, claw: 1 });        // H: let go
  advance(world, 0.6);
  assert.ok(!ring.held, "claw did not let go");
});

test("switching to the nose while holding a ring lets go of it", () => {
  const { rov, world, ring } = setup();
  world.advance(clock);
  world.command({ claw: 1 }); advance(world, 1.0);
  world.command({ claw: 0 }); advance(world, 1.0);
  assert.ok(ring.held);
  world.setTool("nose"); advance(world, 0.1);
  assert.ok(!ring.held && rov.claw_holder === null, "still holding after switching tools");
});
