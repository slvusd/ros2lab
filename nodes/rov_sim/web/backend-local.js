// backend-local.js — the simulation runs right here in the browser (no server needed). Same shape as backend-net.js.
// A page-load-time loop steps the World and hands state to the page ~30 times a second.
import { World } from "./sim/world.js";
import { Rov } from "./sim/physics.js";

export const name = "local sim";
export const features = { keys: true, joys: false, claw: false, imu: false, rings: true, fish: true };
const rov = new Rov({ tool: "nose" });
try { (await import("./sim/rings.js")).addTo(rov, 3); } catch (e) { /* optional add-on: no rings without rings.js */ }
try { (await import("./sim/fishbrain.js")).addTo(rov, 1); } catch (e) { /* optional add-on: no fish without fishbrain.js */ }
const world = new World(rov);
let timer = null;

export function connect(onState) {
  const tick = () => { world.advance(performance.now()); onState(world.state()); };
  timer = setInterval(tick, 1000 / 60);          // (first delivery waits a tick: the page is still finishing its own setup)
  document.addEventListener("visibilitychange", () => { if (document.hidden) world.pause(); });
}
export const cmd = (obj) => world.command(obj);
export const tool = () => {};                 // fixed nose in the browser version
export const buoyancy = (mode) => world.setBuoyancy(mode);
export const joy = () => {};
export const reset = () => world.reset();
