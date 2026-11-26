// scout2026.js — the 2026 SCOUT competition mission (browser version only). An OPTIONAL add-on, started by ?mission=scout2026 (see backend-local.js).
// To remove it: delete web/missions/ and the mission lines in backend-local.js and app.js. Written so another mission can be added beside it (common/ is shared).
//   - one `Mission` prop (type "mission"): the clock, the score board, the deck + inventory, and the judges of the tasks
//   - the competition props, each a prop of its own (type "m_item" for things the ROV can carry)
// The physical tasks and their points are the manual's (task 1.1 ... 3.1); the paper tasks and the float are not part of this version. See the plan in the repo history.
import { RunClock } from "../common/clock.js";
import { ScoreBoard } from "../common/board.js";
import { Carryable } from "../common/carry.js";
import { RUN_SECONDS, atStairs, deckSlot, startPose } from "./layout.js";

/** The 17 scored items (125 points): [id, label, points, group]. */
export const SCORED = [
  ["star1", "Basket star 1 to the deck", 5, "1 Coral garden"], ["star2", "Basket star 2 to the deck", 5, "1 Coral garden"],
  ["coral1", "Coral 1 to the deck", 5, "1 Coral garden"], ["coral2", "Coral 2 to the deck", 5, "1 Coral garden"],
  ["transect", "Fly the transect", 10, "1 Coral garden"],
  ["crab1", "Green crab 1 to the deck", 5, "2 SmartAtlantic"], ["crab2", "Green crab 2 to the deck", 5, "2 SmartAtlantic"],
  ["marker1", "Marker on iceberg point A", 10, "2 SmartAtlantic"], ["marker2", "Marker on iceberg point B", 10, "2 SmartAtlantic"],
  ["pot_open", "Lobster pot: buoy released", 5, "2 SmartAtlantic"], ["pot_surface", "Lobster pot: buoy at the surface", 5, "2 SmartAtlantic"],
  ["old_sensor", "Old eDNA sensor to the deck", 10, "2 SmartAtlantic"], ["new_sensor", "New eDNA sensor in the yellow square", 10, "2 SmartAtlantic"],
  ["connector", "eDNA connector in the observatory", 5, "2 SmartAtlantic"],
  ["power_lift", "Power connector lifted off the stand", 10, "3 Wind farm"], ["power_cable", "Cable through the waypoint", 10, "3 Wind farm"],
  ["power_port", "Power connector in the oil platform port", 10, "3 Wind farm"],
].map(([id, label, points, group]) => ({ id, label, points, group }));

export class Mission {
  constructor(rov) {
    this.type = "mission"; this.id = "scout2026";
    this.clock = new RunClock(RUN_SECONDS);
    this.board = new ScoreBoard(SCORED);
    this.items = [];                                           // the carryable props (also in rov.props, so the sim steps them)
    this.judges = [];                                          // functions (mission, rov) that set the board each step: one per task, added by the props
    this.locked = false;
    this.msg = { n: 0, text: "" };
    this.rov = rov;
  }
  reset() {
    this.rov.mission_carry = null;
    this.clock.reset(); this.board.reset();
    this.locked = false;
    this.msg = { n: this.msg.n + 1, text: "" };
  }
  say(text) { this.msg = { n: this.msg.n + 1, text }; }

  step(rov, dt) {
    if (this.clock.state === "ready" && (Object.values(rov.cmd).some((v) => v !== 0) || rov.claw_target !== rov.claw)) this.clock.start();
    this.clock.step(dt);
    if (!this.locked && this.clock.over) { this.locked = true; this.say(`Time is up! Score ${this.board.total} of ${this.board.max}`); }
    if (this.locked) {                                         // the run is over: nothing answers until Reset
      for (const k of Object.keys(rov.cmd)) rov.cmd[k] = 0.0;
      rov.claw_target = rov.claw;
    }
    for (const j of this.judges) j(this, rov);
  }

  /** Set a scored item (true = earned, false = lost again) with the clock's time; announces what changed. */
  score(id, earned) {
    const was = this.board.total;
    if (this.board.set(id, earned, this.clock.elapsed)) {
      const it = this.board.byId.get(id), d = this.board.total - was;
      this.say(`${d > 0 ? "+" : ""}${d}  ${it.label}`);
    }
  }

  // ---- the crew on the deck (keys G and Tab on the page)
  /** G: the crew takes what the ROV carries and sets it on the deck. Returns a message. */
  deliver(rov) {
    if (this.locked) return "";
    const item = rov.mission_carry;
    if (!item) { this.say("Nothing on the ROV to hand over"); return this.msg.text; }
    if (!atStairs(rov)) { this.say("Bring it to the stairs first"); return this.msg.text; }
    const used = new Set(this.items.filter((i) => i.mode === "deck" && i.slot).map((i) => i.slot.join()));
    let k = 0, slot;
    while ((slot = deckSlot(k)) && used.has(slot.join())) k++;
    item.toDeck(rov, slot);
    this.say(`On the deck: ${item.label ?? item.id}`);
    return this.msg.text;
  }
  /** The inventory: what is on the deck. */
  inventory() { return this.items.filter((i) => i.mode === "deck").map((i) => ({ id: i.id, kind: i.kind, label: i.label ?? i.id })); }
  /** The crew gives the ROV an item from the deck (it hangs on the nose, or goes in the open claw). */
  give(rov, id) {
    if (this.locked) return false;
    if (!atStairs(rov)) { this.say("The ROV has to be at the stairs"); return false; }
    const item = this.items.find((i) => i.id === id && i.mode === "deck");
    if (!item) return false;
    if (!item.giveTo(rov)) { this.say(rov.mission_carry ? "The ROV is already carrying something" : "The tool cannot take that (open the claw first)"); return false; }
    return true;
  }

  state(rov) {
    return {
      type: this.type, id: this.id, locked: this.locked, clock: this.clock.data(), board: this.board.data(), inventory: this.inventory(),
      carrying: this.rov.mission_carry ? this.rov.mission_carry.id : null, atStairs: atStairs(this.rov), msg: this.msg,
    };
  }
}

/** Put the mission into the pool: its props and the ROV's start. Returns the Mission. (The pool must already be the mission's pool: see MISSION_DEFAULTS in config.js.) */
export function addTo(rov) {
  const m = new Mission(rov);
  rov.start_pose = startPose();
  rov.props.push(m);
  rov.mission = m;
  m.addItem = (item) => { m.items.push(item); rov.props.push(item); return item; };
  rov.reset();
  return m;
}
export { Carryable };
