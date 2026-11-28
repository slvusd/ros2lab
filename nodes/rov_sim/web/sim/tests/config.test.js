// The page settings read from the address. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { startView, DEFAULTS, LIMITS, CONFIG_KEYS, POOL_PRESETS, parseConfig, toQuery, poolSizeText } from "../../config.js";

const plain = (c) => Object.fromEntries(CONFIG_KEYS.map((k) => [k, c[k]]));

test("no parameters: the defaults (3 rings, a fish, a camera, all keys, the normal pool)", () => {
  assert.deepEqual(plain(parseConfig("")), DEFAULTS);
  assert.deepEqual(DEFAULTS, { mission: "rings2026", labels: false, controls: "h", fish: true, rings: 3, poollength: 1, poolwidth: 1, pooldepth: 2, camera: false, speed: 1, crabs: 1, current: false, flow: "mix", thrusters: 4 });
  assert.equal(parseConfig("").explicit.size, 0);
  assert.equal(parseConfig("").open, false);
});

test("every setting can be given on its own", () => {
  assert.equal(parseConfig("?controls=h").controls, "h");
  assert.equal(parseConfig("?controls=h-hidden").controls, "h-hidden");
  assert.equal(parseConfig("?controls=ALL").controls, "all");
  assert.equal(parseConfig("?fish=off").fish, false);
  assert.equal(parseConfig("?fish=0").fish, false);
  assert.equal(parseConfig("?fish=on").fish, true);
  assert.equal(parseConfig("?rings=0").rings, 0);
  assert.equal(parseConfig("?rings=5").rings, 5);
  assert.equal(parseConfig("?poollength=2").poollength, 2);
  assert.equal(parseConfig("?poolwidth=3").poolwidth, 3);
  assert.equal(parseConfig("?camera=off").camera, false);
  assert.equal(parseConfig("camera=no&fish=false").camera, false, "a leading ? is optional");
});

test("numbers are rounded and kept inside their limits; nonsense falls back to the default", () => {
  assert.equal(parseConfig("?rings=3.6").rings, 4);
  assert.equal(parseConfig("?rings=99").rings, LIMITS.rings[1]);
  assert.equal(parseConfig("?rings=-2").rings, LIMITS.rings[0]);
  assert.equal(parseConfig("?poollength=7").poollength, 2);
  assert.equal(parseConfig("?poollength=0").poollength, 1);
  assert.equal(parseConfig("?poolwidth=9").poolwidth, 3);
  assert.equal(parseConfig("?poolwidth=1.4").poolwidth, 1);
  for (const bad of ["?rings=abc", "?rings=", "?poollength=x", "?fish=maybe", "?camera=2", "?controls=wasd", "?controls="]) {
    assert.deepEqual(plain(parseConfig(bad)), DEFAULTS, bad);
    assert.equal(parseConfig(bad).explicit.size, 0, `${bad} must not count as set (so it does not lock anything)`);
  }
});

test("explicit lists exactly the settings the address set; ?config opens the panel", () => {
  const c = parseConfig("?config&rings=2&controls=h&quality=low");
  assert.deepEqual([...c.explicit].sort(), ["controls", "rings"]);
  assert.equal(c.open, true);
  assert.equal(parseConfig("?rings=3").explicit.has("rings"), true, "even a value equal to the default counts as set");
});

test("toQuery: only non-default values, other parameters are kept, config is dropped", () => {
  assert.equal(toQuery(DEFAULTS), "");
  assert.equal(toQuery({ ...DEFAULTS, rings: 5, fish: false, camera: true }), "fish=off&rings=5&camera=on");
  assert.equal(toQuery({ ...DEFAULTS, controls: "h-hidden", poollength: 2, poolwidth: 3 }), "controls=h-hidden&poollength=2&poolwidth=3");
  assert.equal(toQuery(DEFAULTS, "?config&quality=low&view=top&rings=1"), "quality=low&view=top");
  assert.equal(toQuery({ ...DEFAULTS, rings: 1 }, "?config&quality=low"), "quality=low&rings=1");
});

test("a link made by toQuery reads back as the same settings", () => {
  for (const controls of ["all", "h", "h-hidden"]) for (const fish of [true, false]) for (const rings of [0, 3, 5])
    for (const poollength of [1, 2]) for (const poolwidth of [1, 2, 3]) for (const camera of [true, false]) for (const speed of [0.25, 0.5, 1, 1.75, 4]) for (const crabs of [0, 1, 5]) for (const current of [false, true]) for (const flow of ["bubbles", "streaks", "rings", "mix"]) for (const thrusters of [3, 4, 8]) for (const pooldepth of [2, 4, 6]) {
      const cfg = { mission: "none", labels: thrusters === 3, controls, fish, rings, poollength, poolwidth, pooldepth, camera, speed, crabs, current, flow, thrusters };
      assert.deepEqual(plain(parseConfig(toQuery(cfg))), cfg, JSON.stringify(cfg));
    }
});

test("pool size text", () => {
  assert.equal(poolSizeText(1, 1), "6 m × 3 m");
  assert.equal(poolSizeText(2, 3), "12 m × 9 m");
});

test("speed: any number from 0.25 to 4, rounded to 2 decimals, anything else is ignored", () => {
  assert.equal(parseConfig("").speed, 1);
  assert.equal(parseConfig("?speed=0.5").speed, 0.5);
  assert.equal(parseConfig("?speed=2").speed, 2);
  assert.equal(parseConfig("?speed=1.234").speed, 1.23);
  assert.equal(parseConfig("?speed=0.01").speed, 0.25);
  assert.equal(parseConfig("?speed=100").speed, 4);
  for (const bad of ["?speed=fast", "?speed=", "?speed=NaN"]) { assert.equal(parseConfig(bad).speed, 1, bad); assert.equal(parseConfig(bad).explicit.has("speed"), false); }
  assert.equal(toQuery({ ...DEFAULTS, speed: 2 }), "speed=2");
  assert.equal(toQuery({ ...DEFAULTS, speed: 1 }), "");
});

test("crabs: 0 to 5, whole numbers, default 1", () => {
  assert.equal(parseConfig("").crabs, 1);
  assert.equal(parseConfig("?crabs=0").crabs, 0);
  assert.equal(parseConfig("?crabs=2").crabs, 2);
  assert.equal(parseConfig("?crabs=2.6").crabs, 3);
  assert.equal(parseConfig("?crabs=99").crabs, 5);
  assert.equal(parseConfig("?crabs=-1").crabs, 0);
  assert.equal(parseConfig("?crabs=many").crabs, 1);
  assert.equal(toQuery({ ...DEFAULTS, crabs: 2 }), "crabs=2");
  assert.equal(toQuery({ ...DEFAULTS, crabs: 1 }), "");
});

test("current: on or off, default off", () => {
  assert.equal(parseConfig("").current, false);
  assert.equal(parseConfig("?current=on").current, true);
  assert.equal(parseConfig("?current=1").current, true);
  assert.equal(parseConfig("?current=off").current, false);
  assert.equal(parseConfig("?current=sometimes").current, false);
  assert.equal(parseConfig("?current=sometimes").explicit.has("current"), false);
  assert.equal(toQuery({ ...DEFAULTS, current: true }), "current=on");
  assert.equal(toQuery(DEFAULTS), "");
});

test("flow: bubbles, streaks, rings or mix (default mix); anything else is ignored", () => {
  assert.equal(parseConfig("").flow, "mix");
  for (const v of ["bubbles", "streaks", "rings", "mix"]) assert.equal(parseConfig(`?flow=${v}`).flow, v);
  assert.equal(parseConfig("?flow=RINGS").flow, "rings");
  assert.equal(parseConfig("?flow=lasers").flow, "mix");
  assert.equal(parseConfig("?flow=lasers").explicit.has("flow"), false);
  assert.equal(toQuery({ ...DEFAULTS, flow: "streaks" }), "flow=streaks");
  assert.equal(toQuery({ ...DEFAULTS, flow: "mix" }), "");
});

test("the Config dialog offers five pool sizes, all allowed, starting with the standard one", () => {
  assert.equal(POOL_PRESETS.length, 5);
  assert.deepEqual(POOL_PRESETS[0].slice(0, 2), [DEFAULTS.poollength, DEFAULTS.poolwidth], "the first is the normal pool");
  for (const [L, W, name] of POOL_PRESETS) {
    assert.ok(L >= LIMITS.poollength[0] && L <= LIMITS.poollength[1] && W >= LIMITS.poolwidth[0] && W <= LIMITS.poolwidth[1], `${name}: ${L}x${W} is within the limits`);
    assert.ok(typeof name === "string" && name.length > 0);
  }
  assert.equal(new Set(POOL_PRESETS.map(([L, W]) => `${L}x${W}`)).size, 5, "no size twice");
  const areas = POOL_PRESETS.map(([L, W]) => L * W);
  assert.deepEqual(areas, [...areas].sort((a, b) => a - b), "smallest to largest");
});

test("thrusters: 3, 4, 6 or 8, default 4; anything else is ignored", () => {
  assert.equal(parseConfig("").thrusters, 4);
  for (const v of [3, 4, 6, 8]) assert.equal(parseConfig(`?thrusters=${v}`).thrusters, v);
  assert.equal(parseConfig("?thrusters=5").thrusters, 4);
  assert.equal(parseConfig("?thrusters=5").explicit.has("thrusters"), false);
  assert.equal(toQuery({ ...DEFAULTS, thrusters: 6 }), "thrusters=6");
  assert.equal(toQuery({ ...DEFAULTS, thrusters: 4 }), "");
});

test("pooldepth: 2, 3, 4 or 6 metres, default 2; anything else is ignored", () => {
  assert.equal(parseConfig("").pooldepth, 2);
  for (const v of [2, 3, 4, 6]) assert.equal(parseConfig(`?pooldepth=${v}`).pooldepth, v);
  assert.equal(parseConfig("?pooldepth=5").pooldepth, 2);
  assert.equal(parseConfig("?pooldepth=5").explicit.has("pooldepth"), false);
  assert.equal(toQuery({ ...DEFAULTS, pooldepth: 4 }), "pooldepth=4");
});

test("mission: rings2026 by default, scout2026, or none; a mission sets its own start-up, the address still wins", () => {
  assert.equal(parseConfig("").mission, "rings2026");
  assert.equal(parseConfig("?mission=none").mission, "none"); assert.equal(parseConfig("?mission=none").explicit.has("mission"), true);
  assert.equal(parseConfig("?mission=SCOUT2026").mission, "scout2026");
  assert.equal(parseConfig("?mission=banana").mission, "rings2026"); assert.equal(parseConfig("?mission=banana").explicit.has("mission"), false);
  const m = parseConfig("?mission=scout2026");
  assert.deepEqual([m.rings, m.crabs, m.fish, m.poollength, m.poolwidth, m.pooldepth, m.camera], [0, 1, true, 1, 2, 2, false], "no rings, but the fish and the crab stay");
  const o = parseConfig("?mission=scout2026&rings=2&pooldepth=4");
  assert.equal(o.rings, 2); assert.equal(o.pooldepth, 4); assert.equal(o.explicit.has("rings"), true);
  assert.equal(toQuery({ ...DEFAULTS, mission: "scout2026" }), "mission=scout2026");
  assert.equal(toQuery({ ...DEFAULTS, mission: "none" }), "mission=none", "none has to be in the address, since it is not the default");
  assert.equal(toQuery({ ...DEFAULTS }), "");
});

test("labels: on or off, default off", () => {
  assert.equal(parseConfig("").labels, false);
  assert.equal(parseConfig("?labels=on").labels, true); assert.equal(parseConfig("?labels=off").labels, false);
  assert.equal(parseConfig("?labels=on").explicit.has("labels"), true);
  assert.equal(toQuery({ ...DEFAULTS, labels: true }), "labels=on"); assert.equal(toQuery({ ...DEFAULTS, labels: false }), "");
});

test("view: orbit, deck, follow or top (any case); anything else gives the normal start (Orbit, or Deck in a mission)", () => {
  for (const v of ["orbit", "deck", "follow", "top"]) assert.equal(startView(`?view=${v}`), v);
  assert.equal(startView("?view=TOP"), "top"); assert.equal(startView("?view=%20Deck%20"), "deck");
  assert.equal(startView(""), "orbit"); assert.equal(startView("?view=sideways"), "orbit");
  assert.equal(startView("", "scout2026"), "deck", "the Scout mission starts on the deck"); assert.equal(startView("", "rings2026"), "orbit", "the rings game and free driving start in orbit"); assert.equal(startView("", "none"), "orbit"); assert.equal(startView("?view=orbit", "scout2026"), "orbit", "unless the address says otherwise");
  assert.equal(startView("?view=nope", "scout2026"), "deck");
});
