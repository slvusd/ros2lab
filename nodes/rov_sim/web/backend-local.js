// backend-local.js — the simulation runs right here in the browser (no server needed). Same shape as backend-net.js.
// A page-load-time loop steps the World and hands state to the page ~30 times a second.
import { World } from "./sim/world.js";
import { Rov, setPool } from "./sim/physics.js";
import { parseConfig } from "./config.js";
import { DeviceLink } from "./sim/devicelink.js";

export const name = "local sim";
export const config = parseConfig(typeof location !== "undefined" ? location.search : "");   // ?rings= ?fish= ?poollength= ?poolwidth= ?camera= (see config.js)
export const defaultTool = "nose";               // scout ROVs mostly use a nose (hook); T switches to the claw
export const configurable = { controls: true, camera: true, fish: true, rings: true, pool: true, speed: true, crabs: true, current: true };   // what the ?config panel may change here
setPool(config.poollength, config.poolwidth);    // the pool first: rings and fish stand on its floor
const rov = new Rov({ tool: defaultTool, thrusters: config.thrusters });
rov.speed_mult = Math.max(0.25, Math.min(4, config.speed));   // ?speed= : the red / green thrusters' power (1 = normal)
let ringsMod = null;
try { ringsMod = await import("./sim/rings.js"); if (config.rings > 0) ringsMod.addTo(rov, config.rings); } catch (e) { /* optional add-on: no rings without rings.js */ }
let fishAdded = false;
if (config.fish) try {
  (await import("./sim/fishbrain.js")).addTo(rov, 1); fishAdded = true;
  for (const p of rov.props) if (p.type === "fish") p.peeks = config.camera;         // no camera on the ROV: nothing for the fish to come and look into
} catch (e) { /* optional add-on: no fish without fishbrain.js */ }
let crabsAdded = false;
if (config.crabs > 0) try { (await import("./sim/crab.js")).addTo(rov, config.crabs); crabsAdded = true; } catch (e) { /* optional add-on: no crabs without crab.js */ }
let currentMod = null;                           // the optional water current (sim/current.js); the page's Current button can turn it on and off at any time
try { currentMod = await import("./sim/current.js"); currentMod.addTo(rov, config.current); } catch (e) { /* optional add-on: no outlets without current.js */ }      // the outlets are always in the wall; ?current=on makes the water run
export const features = { keys: true, joys: false, claw: true, imu: true, rings: !!ringsMod, fish: fishAdded, crabs: crabsAdded, current: !!currentMod, serial: true };
const world = new World(rov);
if (ringsMod) world.ringDropper = ringsMod.dropRing;
export const link = new DeviceLink(world);       // a micro:bit / Pico plugged in over USB (see serial.js)
let timer = null;

export function connect(onState) {
  const tick = () => { const now = performance.now(); world.advance(now); link.tick(now); onState(world.state()); };
  timer = setInterval(tick, 1000 / 60);          // (first delivery waits a tick: the page is still finishing its own setup)
  document.addEventListener("visibilitychange", () => { if (document.hidden) world.pause(); });
}
export const cmd = (obj) => world.command(obj);
export const tool = (name) => world.setTool(name);
export const buoyancy = (mode) => world.setBuoyancy(mode);
export const joy = () => {};
export const reset = () => world.reset();
export const dropRing = (x, y) => world.dropRing(x, y);          // the N key
/** The Config dialog's thruster mode: 3, 4, 6 or 8 thrusters (the commands go back to zero). */
export function setThrusters(n) {
  rov.set_layout(n);
  world._prev = {};                                // (the keyboard command the world remembers belongs to the old layout)
}
/** The Config dialog's thruster power: the red and green thrusters' power, 0.25 to 4 (1 = normal). */
export function setSpeed(v) { rov.speed_mult = Math.max(0.25, Math.min(4, Number(v) || 1)); }
/** The Config dialog's pool size: resize the main pool (length 1-2 times 6 m, width 1-3 times 3 m) while the sim runs. Everything that stands in the pool (the ROV,
 *  the rings, the fish, the crabs, the water outlets) is put back in the new pool, like Reset. */
export function setPoolSize(length, width) {
  setPool(length, width);
  world.reset();
}
/** The Config dialog's Current box: make the water run, or stop it. (The outlets stay in the wall either way.) */
export function setCurrent(on) {
  const jets = rov.props.find((p) => p.type === "jets");
  if (jets) jets.on = !!on;
}
