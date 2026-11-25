// backend-local.js — the simulation runs right here in the browser (no server needed). Same shape as backend-net.js.
// A page-load-time loop steps the World and hands state to the page ~30 times a second.
import { World } from "./sim/world.js";
import { Rov, setPool } from "./sim/physics.js";
import { parseConfig } from "./config.js";
import { DeviceLink } from "./sim/devicelink.js";

export const name = "local sim";
export const config = parseConfig(typeof location !== "undefined" ? location.search : "");   // ?rings= ?fish= ?poollength= ?poolwidth= ?camera= (see config.js)
export const defaultTool = "nose";               // scout ROVs mostly use a nose (hook); T switches to the claw
export const configurable = { controls: true, camera: true, fish: true, rings: true, pool: true };   // what the ?config panel may change here
setPool(config.poollength, config.poolwidth);    // the pool first: rings and fish stand on its floor
const rov = new Rov({ tool: defaultTool });
let ringsAdded = false, fishAdded = false;
if (config.rings > 0) try { (await import("./sim/rings.js")).addTo(rov, config.rings); ringsAdded = true; } catch (e) { /* optional add-on: no rings without rings.js */ }
if (config.fish) try {
  (await import("./sim/fishbrain.js")).addTo(rov, 1); fishAdded = true;
  for (const p of rov.props) if (p.type === "fish") p.peeks = config.camera;         // no camera on the ROV: nothing for the fish to come and look into
} catch (e) { /* optional add-on: no fish without fishbrain.js */ }
export const features = { keys: true, joys: false, claw: true, imu: false, rings: ringsAdded, fish: fishAdded, serial: true };
const world = new World(rov);
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
