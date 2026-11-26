// eel.js (an easter egg). Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { World, DT } from "../world.js";
import { Rov, POOL_REGIONS, POOL_WATER, floorAt } from "../physics.js";
import * as eelMod from "../eel.js";
import { Eel } from "../eel.js";
import * as currentMod from "../current.js";

function make() {
  const rov = new Rov({ tool: "nose" });
  currentMod.addTo(rov, false);
  eelMod.addTo(rov);
  return { rov, world: new World(rov), eel: rov.props.find((p) => p.type === "eel") };
}
const run = (world, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) world.rov.step(DT); };

test("the eel sleeps until summoned; summoned it starts in the LOWER outlet and swims out", () => {
  const { rov, world, eel } = make();
  run(world, 1);
  assert.equal(eel.mode, "idle"); assert.equal(eel.state().segs.length, 0);
  assert.equal(eelMod.summon(rov), true);
  const low = rov.props.find((p) => p.type === "jets").outlets.reduce((a, b) => (b.depth > a.depth ? b : a));
  assert.ok(eel.segs.every((s) => s[0] === low.x && s[1] === low.y && s[2] === low.depth), "every point of the body is in the nozzle at first");
  assert.equal(eelMod.summon(rov), false, "L again while it is out does nothing");
  run(world, 1.0);
  assert.equal(eel.mode, "chase");
  const tail = eel.segs.at(-1), head = eel.segs[0];
  assert.ok(Math.hypot(head[0] - low.x, head[1] - low.y, head[2] - low.depth) > 0.5, "the head has swum out");
});

test("it catches a ROV that drives away, bites it, and the ROV is dead for 5 to 10 s: no command moves it, then everything works again", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  world.command({ t1: 1, t2: 1 });                       // the ROV tries to flee at full speed
  let bite = -1;
  for (let i = 0; i < 60 * 40 && bite < 0; i++) { rov.step(DT); if (eel.mode === "bite") bite = i * DT; }
  assert.ok(bite > 0, "the eel catches even a ROV that is driving away");
  assert.equal(eel.locked, true); assert.equal(eel.state().zap, 1, "a flash at the bite");
  assert.ok(eel.stun >= 5 && eel.stun <= 10, `stunned for 5 to 10 s (${eel.stun.toFixed(1)})`);
  world.command({ t1: 0, t2: 0 }); world.command({ t1: 1, t2: 1, t3: 1, t4: 1, claw: 1 });
  run(world, 4);
  for (const k of Object.keys(rov.cmd)) assert.equal(rov.cmd[k], 0, `${k} stays off`);
  assert.equal(rov.claw_target, rov.claw, "the claw stays where it is");
  assert.equal(eel.state().dead, true, "smoking");
  assert.equal(eelMod.summon(rov), false, "no second eel while it is still smoking");
  run(world, 11);
  assert.equal(eel.locked, false); assert.equal(eel.state().dead, false);
  world.command({ t1: 0, t2: 0, t3: 0.1 }); world.command({ t1: 0.5, t2: 0.5 });
  const x0 = rov.x;
  run(world, 1);
  assert.ok(rov.x > x0 + 0.01, "the ROV drives again");
});

test("after the bite the eel swims back into the outlet and is gone; it can be called again once the ROV is alive again", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  for (let i = 0; i < 60 * 40 && eel.mode !== "bite"; i++) rov.step(DT);
  assert.equal(eel.mode, "bite");
  run(world, Eel.BITE_TIME + 0.1);
  assert.equal(eel.mode, "leave"); assert.equal(eel.state().zap, 0);
  run(world, 20);
  assert.equal(eel.mode, "idle"); assert.equal(eel.segs.length, 0);
  run(world, 11);
  assert.equal(eelMod.summon(rov), true, "and it can be called again");
  rov.reset();
  assert.equal(eel.mode, "idle"); assert.equal(eel.locked, false); assert.equal(eel.stun, 0);
});

test("the eel stays inside the water and its body keeps together", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  for (let i = 0; i < 60 * 12; i++) {
    rov.step(DT);
    const segs = eel.segs;
    if (!segs.length) continue;
    const [x, y, d] = segs[0];
    if (y > eel.outlet.y) continue;                                     // (in the hole)
    assert.ok(d >= 0 && d <= floorAt(x, y) + 1e-6, `the head is under water and above the floor (${d.toFixed(2)})`);
    for (let k = 1; k < segs.length; k++) assert.ok(Math.hypot(...segs[k].map((v, j) => v - segs[k - 1][j])) <= Eel.GAP * 1.05 + 0.01, "no gap in the body");
  }
});

test("a ROV in the shallow end: the eel goes round the corner to get it, and round the corner again to get home", () => {
  const { rov, world, eel } = make();
  const shallow = POOL_WATER.reduce((a, b) => (b[4] < a[4] ? b : a));
  rov.x = (shallow[0] + shallow[1]) / 2; rov.y = (shallow[2] + shallow[3]) / 2; rov.depth = Math.max(0.3, shallow[4] - 0.5);
  eelMod.summon(rov);
  let t = 0;
  for (; t < 60 * 60 && eel.mode !== "bite"; t++) rov.step(DT);
  assert.equal(eel.mode, "bite", `it got to the shallow end (${(t / 60).toFixed(0)} s)`);
  run(world, 11);
  assert.equal(eel.locked, false);
  for (t = 0; t < 60 * 60 && eel.mode !== "idle"; t++) rov.step(DT);
  assert.equal(eel.mode, "idle", `it got home from the shallow end (${(t / 60).toFixed(0)} s)`);
});

test("it swims INTO the hole: the body follows the head through the wall, it does not vanish when the head touches", () => {
  const { rov, world, eel } = make();
  eelMod.summon(rov);
  for (let i = 0; i < 60 * 40 && eel.mode !== "enter"; i++) rov.step(DT);
  assert.equal(eel.mode, "enter");
  const o = eel.outlet;
  let seen = false, steps = 0;
  while (eel.mode === "enter" && steps++ < 60 * 20) {
    rov.step(DT);
    if (eel.segs.length && eel.segs[0][1] > o.y + 0.05 && eel.segs.at(-1)[1] < o.y - 0.05) seen = true;
  }
  assert.ok(seen, "for a while the head is in the hole and the tail is still out in the pool");
  assert.ok(steps > 60 * 0.8, `going in takes time (${(steps / 60).toFixed(1)} s)`);
  assert.equal(eel.mode, "idle");
});

test("wherever the ROV was caught, the eel only ever goes through the wall at the hole itself", () => {
  const shallow = POOL_WATER.reduce((a, b) => (b[4] < a[4] ? b : a)), deep = POOL_WATER.reduce((a, b) => (b[4] > a[4] ? b : a));
  const spots = [
    [(shallow[0] + shallow[1]) / 2, (shallow[2] + shallow[3]) / 2, 0.3], [shallow[1] - 0.4, shallow[3] - 0.4, 0.4], [shallow[0] + 0.4, shallow[2] + 0.4, 0.5],
    [deep[0] + 0.5, deep[2] + 0.5, 1.0], [deep[1] - 0.5, deep[3] - 0.4, 0.3], [deep[0] + 0.5, deep[3] - 0.5, 1.5], [0.0, 0.0, 0.2],
  ];
  for (const [x, y, d] of spots) {
    const { rov, eel } = make();
    rov.x = x; rov.y = y; rov.depth = d;
    eelMod.summon(rov);
    const o = eel.outlet;
    let n = 0;
    for (let i = 0; i < 60 * 120 && !(eel.mode === "idle" && i > 60 && !eel.stun); i++) {
      rov.step(DT); n++;
      for (const [sx, sy, sd] of eel.segs) {
        if (sy > o.y + 0.02 && sx < shallow[0] - 0.05) assert.ok(Math.abs(sx - o.x) < 0.2 && Math.abs(sd - o.depth) < 0.25, `(${x.toFixed(1)}, ${y.toFixed(1)}): a part of the eel is in the wall away from the hole at x ${sx.toFixed(2)}, depth ${sd.toFixed(2)}, mode ${eel.mode}`);
      }
    }
    assert.equal(eel.mode, "idle", `(${x.toFixed(1)}, ${y.toFixed(1)}): the eel got home (${eel.mode} after ${(n / 60).toFixed(0)} s)`);
  }
});
