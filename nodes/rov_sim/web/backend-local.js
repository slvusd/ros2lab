// backend-local.js — the simulation runs right here in the browser (no server needed). Same shape as backend-net.js.
// A page-load-time loop steps the World and hands state to the page ~30 times a second.
import { World } from "./sim/world.js";
import { Rov, setPool } from "./sim/physics.js";
import { parseConfig } from "./config.js";
import { DeviceLink } from "./sim/devicelink.js";

export const name = "local sim";
export const config = parseConfig(typeof location !== "undefined" ? location.search : "");   // ?rings= ?fish= ?poollength= ?poolwidth= ?camera= (see config.js)
export const defaultTool = "nose";               // scout ROVs mostly use a nose (hook); T switches to the claw
export const configurable = { controls: true, camera: true, fish: true, rings: true, pool: true, speed: true };   // what the ?config panel may change here
setPool(config.poollength, config.poolwidth);    // the pool first: rings and fish stand on its floor
const rov = new Rov({ tool: defaultTool });
rov.speed_mult = Math.max(0.25, Math.min(4, config.speed));   // ?speed= : the red / green thrusters' power (1 = normal)
let ringsMod = null;
try { ringsMod = await import("./sim/rings.js"); if (config.rings > 0) ringsMod.addTo(rov, config.rings); } catch (e) { /* optional add-on: no rings without rings.js */ }
let fishAdded = false;
if (config.fish) try {
  (await import("./sim/fishbrain.js")).addTo(rov, 1); fishAdded = true;
  for (const p of rov.props) if (p.type === "fish") p.peeks = config.camera;         // no camera on the ROV: nothing for the fish to come and look into
} catch (e) { /* optional add-on: no fish without fishbrain.js */ }
export const features = { keys: true, joys: false, claw: true, imu: false, rings: !!ringsMod, fish: fishAdded, serial: true };
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
