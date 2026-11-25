// configui.js — the ?config panel: set the page's options with a form, see/copy the link, and Start. (The options and their rules: config.js.)
// Applying reloads the page with the new address, because the pool, rings and fish are built when the page starts.
import { DEFAULTS, LIMITS, CONFIG_KEYS, toQuery, poolSizeText } from "./config.js";

const CSS = `
#configui { position: fixed; inset: 0; z-index: 50; background: rgba(4, 16, 26, .62); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
#configui .box { background: #0f2a3d; color: #fff; border-radius: 12px; padding: 16px 20px; width: min(30rem, 100%); max-height: 100%; overflow-y: auto; box-shadow: 0 10px 40px #000a; font: 14px/1.4 -apple-system, system-ui, sans-serif; }
#configui h2 { margin: 0 0 2px; font-size: 18px; } #configui .sub { opacity: .75; margin: 0 0 10px; }
#configui fieldset { border: 1px solid rgba(255,255,255,.25); border-radius: 8px; margin: 0 0 10px; padding: 6px 10px 8px; }
#configui legend { padding: 0 6px; font-weight: 600; }
#configui label { display: flex; gap: 8px; align-items: baseline; margin: 3px 0; cursor: pointer; }
#configui label small { opacity: .7; }
#configui .row > label small { display: block; }
#configui .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin: 5px 0; }
#configui select, #configui input[type=number] { background: #1b4260; color: #fff; border: 1px solid rgba(255,255,255,.3); border-radius: 6px; padding: 3px 6px; font: inherit; }
#configui input[type=number] { width: 4.5em; }
#configui .note { font-size: 12px; opacity: .75; margin: 4px 0 0; }
#configui .off { opacity: .5; }
#configui .speed { display: flex; gap: 8px; align-items: center; white-space: nowrap; } #configui .speed input { width: 8.5rem; } #configui .speed b { min-width: 2.6em; text-align: right; }
#configui .link { display: flex; gap: 6px; margin: 4px 0 12px; } #configui .link input { flex: 1; min-width: 0; background: #091c2a; color: #cfe8f7; border: 1px solid rgba(255,255,255,.3); border-radius: 6px; padding: 5px 8px; font: 12px ui-monospace, Menlo, monospace; }
#configui .buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
#configui button { background: #1d6f9f; color: #fff; border: 0; border-radius: 6px; padding: 6px 14px; font: inherit; cursor: pointer; }
#configui button.go { background: #f2b705; color: #111; font-weight: 600; } #configui button.quiet { background: rgba(255,255,255,.15); }
#configui a { color: #8fd0f5; }
`;

export function showConfig({ cfg, configurable = {} }) {
  if (document.getElementById("configui")) return;
  const cur = {}; for (const k of CONFIG_KEYS) cur[k] = cfg[k];
  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  const el = document.createElement("div"); el.id = "configui"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Configure the pool");
  const can = (k) => configurable[k] !== false;
  const opt = (v, text, sel) => `<option value="${v}"${sel ? " selected" : ""}>${text}</option>`;
  const radio = (v, text, sub) => `<label><input type="radio" name="cfg-controls" value="${v}"${cur.controls === v ? " checked" : ""}><span>${text}<br><small>${sub}</small></span></label>`;
  el.innerHTML = `<div class="box">
    <h2>Configure the pool</h2>
    <p class="sub">Pick the settings, then <b>Start</b>. The link below makes the same setup for anyone you send it to.</p>
    <fieldset><legend>Controls</legend>
      ${radio("all", "All keys", "the three switches and the extra keys (W A S D, R F, Z C, I K). H switches modes.")}
      ${radio("h", "H-circuit only", "just the three switches, like the real controller. Locked: H does nothing.")}
      ${radio("h-hidden", "H-circuit only, everything else hidden", "only the switch box (and the camera view) on the page.")}
    </fieldset>
    <fieldset><legend>In the pool</legend>
      <div class="row ${can("fish") ? "" : "off"}"><label><input type="checkbox" id="cfg-fish"${cur.fish ? " checked" : ""}${can("fish") ? "" : " disabled"}> Fish</label></div>
      <div class="row ${can("rings") ? "" : "off"}"><label for="cfg-rings">Pool rings (0&ndash;${LIMITS.rings[1]}, usually ${DEFAULTS.rings})</label><input type="number" id="cfg-rings" min="${LIMITS.rings[0]}" max="${LIMITS.rings[1]}" step="1" value="${cur.rings}"${can("rings") ? "" : " disabled"}></div>
      <div class="row ${can("crabs") ? "" : "off"}"><label for="cfg-crabs">Green crabs on the shallow end (0&ndash;${LIMITS.crabs[1]}, usually ${DEFAULTS.crabs})</label><input type="number" id="cfg-crabs" min="${LIMITS.crabs[0]}" max="${LIMITS.crabs[1]}" step="1" value="${cur.crabs}"${can("crabs") ? "" : " disabled"}></div>
      <div class="row ${can("pool") ? "" : "off"}"><label for="cfg-length">Main pool length</label><select id="cfg-length"${can("pool") ? "" : " disabled"}>${[1, 2].map((n) => opt(n, `${n}× (${6 * n} m)`, cur.poollength === n)).join("")}</select></div>
      <div class="row ${can("pool") ? "" : "off"}"><label for="cfg-width">Main pool width</label><select id="cfg-width"${can("pool") ? "" : " disabled"}>${[1, 2, 3].map((n) => opt(n, `${n}× (${3 * n} m)`, cur.poolwidth === n)).join("")}</select></div>
      <div class="note" id="cfg-size"></div>
      ${can("pool") ? "" : '<div class="note">Fish, crabs, rings and the pool size are set by the Python server (--fish, --crabs, --rings, and its pool), not by the page.</div>'}
    </fieldset>
    <fieldset><legend>Water</legend>
      <div class="row ${can("current") ? "" : "off"}"><label><input type="checkbox" id="cfg-current"${cur.current ? " checked" : ""}${can("current") ? "" : " disabled"}> Current: two water outlets in the side wall, as if filling the pool <small>(a challenge for the driver and the IMU)</small></label></div>
      ${can("current") ? "" : '<div class="note">With the Python server use its --current option.</div>'}
    </fieldset>
    <fieldset><legend>ROV</legend>
      <div class="row ${can("speed") ? "" : "off"}"><label for="cfg-speed">Red and green thruster power <small>(1&times; = normal)</small></label>
        <span class="speed"><input type="range" id="cfg-speed" min="${LIMITS.speed[0]}" max="${LIMITS.speed[1]}" step="0.25" value="${cur.speed}"${can("speed") ? "" : " disabled"}> <b id="cfg-speedv"></b></span></div>
      <div class="row"><label><input type="checkbox" id="cfg-camera"${cur.camera ? " checked" : ""}> Camera: its housing on the ROV, the camera window, and the fish coming to look at it</label></div>
    </fieldset>
    <div class="link"><input id="cfg-link" readonly aria-label="Link for this setup"><button class="quiet" id="cfg-copy">Copy link</button></div>
    <div class="buttons"><button class="quiet" id="cfg-defaults">Defaults</button><button class="quiet" id="cfg-close">Close</button><button class="go" id="cfg-go">Start</button></div>
    <p class="note">Everything here is also a plain address option (see <a href="help.html#options" target="_blank" rel="noopener">Help</a>).</p>
  </div>`;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector("#" + id);

  const url = () => { const u = new URL(location.href); u.search = toQuery(cur, location.search); u.hash = ""; return u; };
  const refresh = () => {
    $("cfg-size").textContent = `Main pool: ${poolSizeText(cur.poollength, cur.poolwidth)}, 2 m deep, plus the shallow end.`;
    $("cfg-link").value = url().href;
    $("cfg-speedv").textContent = `${Number(cur.speed.toFixed(2))}\u00d7`;
  };
  const read = () => {
    cur.controls = el.querySelector('input[name="cfg-controls"]:checked').value;
    cur.fish = $("cfg-fish").checked;
    const n = Math.round(Number($("cfg-rings").value));
    cur.rings = Number.isFinite(n) ? Math.max(LIMITS.rings[0], Math.min(LIMITS.rings[1], n)) : DEFAULTS.rings;
    const nc = Math.round(Number($("cfg-crabs").value));
    cur.crabs = Number.isFinite(nc) ? Math.max(LIMITS.crabs[0], Math.min(LIMITS.crabs[1], nc)) : DEFAULTS.crabs;
    cur.poollength = Number($("cfg-length").value); cur.poolwidth = Number($("cfg-width").value);
    cur.camera = $("cfg-camera").checked;
    cur.current = $("cfg-current").checked;
    cur.speed = Math.max(LIMITS.speed[0], Math.min(LIMITS.speed[1], Number($("cfg-speed").value) || DEFAULTS.speed));
    refresh();
  };
  const write = () => {                                          // push `cur` back into the form (after Defaults)
    el.querySelectorAll('input[name="cfg-controls"]').forEach((r) => { r.checked = r.value === cur.controls; });
    $("cfg-fish").checked = cur.fish; $("cfg-rings").value = cur.rings; $("cfg-crabs").value = cur.crabs; $("cfg-length").value = cur.poollength; $("cfg-width").value = cur.poolwidth; $("cfg-camera").checked = cur.camera; $("cfg-current").checked = cur.current; $("cfg-speed").value = cur.speed;
    refresh();
  };
  el.addEventListener("input", read); el.addEventListener("change", read);
  $("cfg-defaults").addEventListener("click", () => { Object.assign(cur, DEFAULTS); write(); });
  $("cfg-go").addEventListener("click", () => { location.href = url().href; });
  const close = () => {
    el.remove(); style.remove();
    const u = new URL(location.href); u.searchParams.delete("config");
    try { history.replaceState(null, "", u.href); } catch (e) { /* ignore */ }
  };
  $("cfg-close").addEventListener("click", close);
  el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
  $("cfg-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("cfg-link").value); $("cfg-copy").textContent = "Copied"; }
    catch (e) { $("cfg-link").select(); $("cfg-copy").textContent = "Press Ctrl+C"; }
    setTimeout(() => { $("cfg-copy").textContent = "Copy link"; }, 1500);
  });
  window.addEventListener("keydown", (e) => { if (e.code === "Escape" && document.getElementById("configui")) close(); });
  refresh();
  $("cfg-go").focus();
}
