// config.js — the page's settings, read from the address (?controls=h&rings=2&poollength=2 ...). No DOM, so it is tested in Node.
// `?config` opens a panel (configui.js) that edits these and makes the link; every setting also works on its own in the address.
// Anything missing or invalid falls back to the default, and numbers are rounded and kept inside their limits.
//
//   controls     all | h | h-hidden   all keys (default) | H-circuit only (just the three switches) | H-circuit only and every other control hidden
//   fish         on | off             the coy fish (default on)
//   rings        0 .. 5               pick-up rings in the pool (default 3)
//   poollength   1 | 2                the main pool is 6 m x this long (default 1)
//   poolwidth    1 | 2 | 3            the main pool is 3 m x this wide (default 1)
//   speed        0.25 .. 4            power of the red and green thrusters, 1 = normal (itself half of the old full power); 2 decimals (default 1)
//   crabs        0 .. 5               green crabs crawling on the floor of the shallow end (default 1; the 2026 task has two)
//   current      on | off             two water outlets in the shallow end's side wall make a current across the pool (default off)
//   camera       on | off             the ROV has a camera: its housing on the model, the camera window, and the fish coming to look at it (default on)
// When `controls` is given, it is LOCKED: the H key and the badge no longer switch modes (the link decides, not the student).
export const DEFAULTS = { controls: "all", fish: true, rings: 3, poollength: 1, poolwidth: 1, camera: true, speed: 1, crabs: 1, current: false };
export const LIMITS = { rings: [0, 5], poollength: [1, 2], poolwidth: [1, 3], speed: [0.25, 4], crabs: [0, 5] };
export const MAX_RINGS = 10;      // the most rings the pool can hold, counting the ones dropped with the N key (rov_props.py MAX_RINGS is the same number)
export const CONTROL_MODES = ["all", "h", "h-hidden"];
export const CONFIG_KEYS = Object.keys(DEFAULTS);

const TRUE = new Set(["on", "1", "true", "yes"]), FALSE = new Set(["off", "0", "false", "no"]);
const bool = (v) => (v === null ? undefined : TRUE.has(v.trim().toLowerCase()) ? true : FALSE.has(v.trim().toLowerCase()) ? false : undefined);
const decimal = (v, [lo, hi]) => {                                      // any number, kept inside the limits and rounded to 2 decimals
  if (v === null || v.trim() === "" || !Number.isFinite(Number(v))) return undefined;
  return Math.round(Math.max(lo, Math.min(hi, Number(v))) * 100) / 100;
};
const whole = (v, [lo, hi]) => {
  if (v === null || v.trim() === "" || !Number.isFinite(Number(v))) return undefined;
  return Math.max(lo, Math.min(hi, Math.round(Number(v))));
};

/** Read the settings from a query string ("?a=b&c=d" or "a=b"). `explicit` lists the settings the address really set; `open` says ?config was given. */
export function parseConfig(search = "") {
  const q = new URLSearchParams(search);
  const found = {
    controls: q.has("controls") && CONTROL_MODES.includes(q.get("controls").trim().toLowerCase()) ? q.get("controls").trim().toLowerCase() : undefined,
    fish: bool(q.get("fish")),
    rings: whole(q.get("rings"), LIMITS.rings),
    poollength: whole(q.get("poollength"), LIMITS.poollength),
    poolwidth: whole(q.get("poolwidth"), LIMITS.poolwidth),
    camera: bool(q.get("camera")),
    speed: decimal(q.get("speed"), LIMITS.speed),
    crabs: whole(q.get("crabs"), LIMITS.crabs),
    current: bool(q.get("current")),
  };
  const cfg = { ...DEFAULTS }, explicit = new Set();
  for (const k of CONFIG_KEYS) if (found[k] !== undefined) { cfg[k] = found[k]; explicit.add(k); }
  return { ...cfg, explicit, open: q.has("config") };
}

/** The query string (without "?") for these settings: only values that differ from the defaults, plus every OTHER parameter of
 *  `existing` (quality, view, tool ...) so applying the settings does not lose them. `config` itself is dropped. */
export function toQuery(cfg, existing = "") {
  const out = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(existing)) if (k !== "config" && !CONFIG_KEYS.includes(k)) out.append(k, v);
  for (const k of CONFIG_KEYS) {
    if (cfg[k] === DEFAULTS[k]) continue;
    out.set(k, typeof cfg[k] === "boolean" ? (cfg[k] ? "on" : "off") : String(cfg[k]));
  }
  return out.toString();
}

/** Short human text for the pool size, e.g. "12 m x 6 m". */
export const poolSizeText = (length, width) => `${6 * length} m × ${3 * width} m`;
