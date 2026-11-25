// The page settings read from the address. Run: node --test nodes/rov_sim/web/sim/tests/
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, LIMITS, CONFIG_KEYS, parseConfig, toQuery, poolSizeText } from "../../config.js";

const plain = (c) => Object.fromEntries(CONFIG_KEYS.map((k) => [k, c[k]]));

test("no parameters: the defaults (3 rings, a fish, a camera, all keys, the normal pool)", () => {
  assert.deepEqual(plain(parseConfig("")), DEFAULTS);
  assert.deepEqual(DEFAULTS, { controls: "all", fish: true, rings: 3, poollength: 1, poolwidth: 1, camera: true, speed: 1, crabs: 1 });
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
  assert.equal(toQuery({ ...DEFAULTS, rings: 5, fish: false, camera: false }), "fish=off&rings=5&camera=off");
  assert.equal(toQuery({ ...DEFAULTS, controls: "h-hidden", poollength: 2, poolwidth: 3 }), "controls=h-hidden&poollength=2&poolwidth=3");
  assert.equal(toQuery(DEFAULTS, "?config&quality=low&view=top&rings=1"), "quality=low&view=top");
  assert.equal(toQuery({ ...DEFAULTS, rings: 1 }, "?config&quality=low"), "quality=low&rings=1");
});

test("a link made by toQuery reads back as the same settings", () => {
  for (const controls of ["all", "h", "h-hidden"]) for (const fish of [true, false]) for (const rings of [0, 3, 5])
    for (const poollength of [1, 2]) for (const poolwidth of [1, 2, 3]) for (const camera of [true, false]) for (const speed of [0.25, 0.5, 1, 1.75, 4]) for (const crabs of [0, 1, 5]) {
      const cfg = { controls, fish, rings, poollength, poolwidth, camera, speed, crabs };
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
