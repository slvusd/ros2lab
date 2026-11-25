// backend-local.js — the simulation runs right here in the browser (no server needed). Same shape as backend-net.js.
// A page-load-time loop steps the World and hands state to the page ~30 times a second.
import { World } from "./sim/world.js";

export const name = "local sim";
export const features = { keys: true, joys: false, claw: false, imu: false, rings: false, fish: false };
const world = new World();
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
