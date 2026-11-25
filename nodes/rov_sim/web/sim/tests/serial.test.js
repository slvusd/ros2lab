// serial.js (the browser transport) against a FAKE Web Serial port: real streams, no hardware, no browser.
// Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../world.js";
import { DeviceLink } from "../devicelink.js";

const enc = new TextEncoder(), dec = new TextDecoder();
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function fakePort({ failOpen = null } = {}) {
  let ctl;
  const written = [];
  const port = {
    opened: false, closed: false, baud: null,
    readable: new ReadableStream({ start(c) { ctl = c; } }),
    writable: new WritableStream({ write(chunk) { written.push(dec.decode(chunk)); } }),
    async open(opts) { if (failOpen) throw failOpen; this.opened = true; this.baud = opts.baudRate; },
    async close() { this.closed = true; },
  };
  return { port, written, device: { send: (text) => ctl.enqueue(enc.encode(text)), unplug: () => ctl.close(), error: () => ctl.error(new Error("device lost")) } };
}

async function rig(opts = {}, { granted = [] } = {}) {
  const fp = fakePort(opts);
  const listeners = {};
  globalThis.window = { isSecureContext: true, addEventListener() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    serial: { requestPort: async (o) => { fp.requestOptions = o; return fp.port; }, getPorts: async () => granted.map((g) => g.port ?? g),
      addEventListener: (t, fn) => { listeners[t] = fn; } } } });
  const { setupSerial } = await import("../../serial.js");
  const world = new World();
  const link = new DeviceLink(world);
  const clicks = [];
  const button = { textContent: "", title: "", classList: { add() {}, remove() {} }, addEventListener: (t, fn) => clicks.push(fn), style: {} };
  const panel = { style: {}, textContent: "" };
  setupSerial({ link, button, panel });
  await tick();
  const out = { ...fp, world, link, button, panel, click: (e = {}) => clicks[0]({ shiftKey: false, ...e }), listeners };
  Object.defineProperty(out, "requestOptions", { get: () => fp.requestOptions });
  return out;
}

test("connect: opens at 115200, filters to micro:bit and Pico, reads commands from the device", async () => {
  const r = await rig();
  await r.click(); await tick();
  assert.ok(r.port.opened && r.port.baud === 115200);
  assert.deepEqual(r.requestOptions.filters.map((f) => f.usbVendorId).sort(), [0x0d28, 0x2e8a].sort());
  r.device.send("p:t1,0.5\np:t2,0.");                       // a line arrives in two pieces
  await tick();
  assert.equal(r.world.state().t1, 0.5);
  r.device.send("25\nboot noise\r\np:claw,1\n");
  await tick();
  assert.equal(r.world.state().t2, 0.25);
  assert.equal(r.world.rov.claw_target, 1);
  assert.match(r.button.textContent, /connected/i);
});

test("subscribing makes the sim write m: lines to the device", async () => {
  const r = await rig();
  await r.click(); await tick();
  r.device.send("s:depth\n"); await tick();
  r.link.tick(performance.now() + 100); await tick();
  assert.equal(r.written.length, 1);
  assert.match(r.written[0], /^m:depth,\d+\.\d\d\n$/);
});

test("unplugging stops the thrusters and resets the button", async () => {
  const r = await rig();
  await r.click(); await tick();
  r.device.send("p:t1,1\np:t3,-1\n"); await tick();
  assert.equal(r.world.state().t1, 1);
  r.device.unplug(); await tick(20);
  const s = r.world.state();
  assert.deepEqual([s.t1, s.t2, s.t3, s.t4], [0, 0, 0, 0]);
  assert.match(r.button.textContent, /Connect/);
  assert.match(r.panel.textContent, /thrusters stopped/);
  assert.equal(r.link.send, null);
});

test("a stream error also stops the thrusters", async () => {
  const r = await rig();
  await r.click(); await tick();
  r.device.send("p:t2,1\n"); await tick();
  r.device.error(); await tick(20);
  assert.equal(r.world.state().t2, 0);
});

test("clicking while connected disconnects (thrusters stop, port closed)", async () => {
  const r = await rig();
  await r.click(); await tick();
  r.device.send("p:t4,1\n"); await tick();
  await r.click(); await tick(20);
  assert.equal(r.world.state().t4, 0);
  assert.ok(r.port.closed);
});

test("a busy port gives a helpful message and nothing breaks", async () => {
  const r = await rig({ failOpen: new Error("NetworkError: Failed to open serial port.") });
  await r.click(); await tick();
  assert.match(r.panel.textContent, /close MakeCode, Thonny/);
  assert.equal(r.link.send, null);
});

test("Shift-click offers every serial device, not just micro:bit and Pico", async () => {
  const r = await rig();
  await r.click({ shiftKey: true }); await tick();
  assert.deepEqual(r.requestOptions, {});
});

test("a port allowed before is reopened without asking", async () => {
  const fp = fakePort();
  const r = await rig({}, { granted: [fp.port] });
  await tick(20);
  assert.ok(fp.port.opened, "the single known port should be opened on load");
});

test("a browser without Web Serial gets a button that explains why", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  globalThis.window = { isSecureContext: true, addEventListener() {} };
  const { setupSerial } = await import("../../serial.js");
  const clicks = [];
  const button = { textContent: "", title: "", classList: { add() {} }, addEventListener: (t, fn) => clicks.push(fn), style: {} };
  const panel = { style: {}, textContent: "" };
  setupSerial({ link: new DeviceLink(new World()), button, panel });
  assert.match(button.title, /Chrome or Edge/);
  clicks[0]({});
  assert.match(panel.textContent, /Chrome or Edge/);
});
