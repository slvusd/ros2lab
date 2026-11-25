#!/usr/bin/env python3
# export_golden.py — drive the PYTHON physics through scripted scenarios and record the result, so the JavaScript port
# (web/sim/physics.js) can be checked against it:   node --test web/sim/tests/
#   python3 tools/export_golden.py           rewrite web/sim/tests/golden/physics.json
#   python3 tools/export_golden.py --check   fail if the committed file no longer matches what Python produces
# Python is the reference: if you change rov_physics.py, run this, commit the new golden file, and port the change to JS.
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import rov_physics as P
import rov_props
import rov_current

OUT = os.path.join(HERE, "..", "web", "sim", "tests", "golden", "physics.json")
DT = 1 / 60
EVERY = 15                                   # record every 15 steps (0.25 s)

# Each scenario: buoyancy (N) and a list of (seconds, {thruster: value}) segments. Unlisted thrusters are 0.
SCENARIOS = {
    "drive_and_turn": (1.5, [(2, {"t1": .8, "t2": .8}), (2, {"t1": .8, "t2": .3}), (2, {"t1": .3, "t2": .8}), (3, {})]),
    "dive_to_floor":   (1.5, [(4, {"t3": -.8, "t4": -.8}), (3, {"t3": -.8, "t4": -.8}), (2, {})]),
    "surface_bob":     (1.5, [(3, {"t3": .8, "t4": .8}), (6, {}), (2, {"t3": 1, "t4": 1}), (4, {})]),
    "neutral_hover":   (0.0, [(5, {})]),
    "sinks":           (-1.5, [(6, {})]),
    "double_speed":    (1.5, [(2, {"t1": .8, "t2": .8}), (2, {"t1": .8, "t2": .3}), (3, {})], 2.0),     # speed=2.0 doubles the red / green thrusters
    "quarter_speed":   (1.5, [(3, {"t1": 1, "t2": 1}), (2, {"t1": -1, "t2": 1}), (3, {})], 0.25),
    "pitch_trim":      (1.5, [(2, {"t3": .8, "t4": -.8}), (2, {"t3": -.8, "t4": .8}), (3, {})]),
    "into_east_wall":  (1.5, [(8, {"t1": .8, "t2": .8}), (2, {})]),
    "turn_in_corner":  (1.5, [(5, {"t1": .8, "t2": .8}), (3, {"t1": -.8, "t2": .8}), (3, {"t1": .8, "t2": .8})]),
    "shelf_deep_step": (0.0, [(2, {"t3": 0, "t4": 0}), (1, {"t1": .8, "t2": .6}), (10, {"t1": .8, "t2": .8})]),   # runs at the shallow-end step while deep
    "shelf_shallow":   (1.5, [(2.5, {"t3": .8, "t4": .8}), (1, {}), (3, {"t1": .5, "t2": .8}), (6, {"t1": .8, "t2": .8}), (3, {"t3": -.8, "t4": -.8})]),
}


def run(buoy, segs, speed=1.0):
    rov = P.Rov(buoyancy=buoy, tool="nose", speed=speed)
    rows, n = [], 0
    for secs, cmd in segs:
        for k in ("t1", "t2", "t3", "t4"):
            rov.set_cmd(k, cmd.get(k, 0.0))
        for _ in range(int(round(secs / DT))):
            rov.step(DT)
            n += 1
            if n % EVERY == 0:
                s = rov.state()
                im = s["imu"]
                rows.append([s["x"], s["y"], s["depth"], s["yaw"], s["pitch"], s["speed"], s["splash_n"], s["floor_n"],
                             im["ax"], im["ay"], im["az"], im["gy"], im["gz"]])
    return rows


# Ring scenarios: tool, number of rings, the ROV's starting pose, per-ring overrides, and the segments (seconds, commands).
# Commands may include "claw_target". Recorded: the ROV (x, y, depth, yaw, pitch) and every ring (x, y, depth, yaw, held, hooked, lifting).
RING_SCENARIOS = {
    "ring_push": dict(tool="claw", rings=1, rov=dict(x=-0.3, y=0.0, yaw=0.0, depth=1.6), ringset={0: dict(x=0.9, y=0.0, yaw=1.5707963267948966)},
                      segments=[(3, {"t1": .6, "t2": .6}), (2, {})]),
    "ring_corner_catch": dict(tool="claw", rings=1, rov=dict(x=-0.3, y=0.0, yaw=0.0, depth=1.55), ringset={0: dict(x=1.0, y=0.36, yaw=1.5707963267948966)},
                              segments=[(3.5, {"t1": .5, "t2": .5}), (2, {})]),
    "ring_nose_carry": dict(tool="nose", rings=1, rov=dict(x=0.2, y=0.0, yaw=0.0, depth=1.55), ringset={},
                            segments=[(0.9, {"t1": .5, "t2": .5}), (0.5, {}), (2, {"t3": .7, "t4": .7}), (1.5, {"t1": .5, "t2": .5}), (1, {}), (1.5, {"t1": -.5, "t2": -.5})]),
    "ring_claw_grab": dict(tool="claw", rings=1, rov=dict(x=-1.0, y=0.0, yaw=0.0, depth=1.5, claw=1.0, claw_target=1.0), ringset={0: dict(x=-0.5, y=-0.14, depth=1.75)},
                           segments=[(0.34, {}), (1.0, {"claw_target": 0.0}), (3, {"t3": .6, "t4": .6}), (0.5, {"claw_target": 1.0}), (1, {})]),
    "ring_shelf_carry": dict(tool="nose", rings=1, rov=dict(x=1.8, y=-0.2, yaw=1.5707963267948966, depth=1.55), ringset={0: dict(x=1.8, y=0.4, yaw=0.0)},
                             segments=[(0.9, {"t1": .5, "t2": .5}), (0.5, {}), (2.2, {"t3": .7, "t4": .7}), (1, {}), (6, {"t1": .5, "t2": .5}), (1, {}),
                                       (3, {"t3": -.4, "t4": -.4}), (1.5, {}), (2.5, {"t1": -.6, "t2": -.6})]),
    # (no two-ring trace on purpose: two rings resting on the floor are at exactly the same depth, so their hoops touch with exact ties
    #  between "push up" and "push down", which float noise decides differently in Python and JS. The behaviour test covers two rings.)
}


# Scenarios with the water jets on (rov_current.py): a neutral ROV placed at x, y, depth, yaw, then scripted thrusters. The IMU is recorded too.
CURRENT_SCENARIOS = {
    "current_drift":      dict(pose=dict(x=-1.25, y=0.5, depth=0.667, yaw=0.0), segments=[(6, {})]),
    "current_against":    dict(pose=dict(x=-1.25, y=-1.0, depth=0.667, yaw=1.5707963267948966), segments=[(3, {"t1": 1, "t2": 1}), (3, {"t1": -1, "t2": -1}), (2, {})]),
    "current_cross":      dict(pose=dict(x=-1.8, y=0.4, depth=1.0, yaw=0.0), segments=[(5, {"t1": 1, "t2": 1}), (3, {"t1": 1, "t2": -1}), (3, {})]),
    "current_start_spot": dict(pose=dict(x=-1.5, y=0.0, depth=0.8, yaw=0.0), segments=[(4, {}), (3, {"t3": -0.8, "t4": -0.8}), (3, {})]),
}


# Scenarios for the 3, 6 and 8 thruster layouts (rov_physics.THRUSTER_LAYOUTS): a neutral ROV, scripted commands on t1 ... t<n>. The IMU is recorded too.
_FWD6 = {"t1": 1, "t2": 1, "t3": 1, "t4": 1}
THRUSTER_SCENARIOS = {
    "layout3":        dict(n=3, segments=[(2, {"t1": .8, "t2": .8}), (2, {"t3": 1}), (1.5, {"t1": 1, "t2": -1}), (2, {})]),
    "layout6_posts":  dict(n=6, segments=[(2, _FWD6), (1.5, {"t1": 1, "t4": 1, "t2": -1, "t3": -1}), (1.5, {"t1": 1, "t3": 1, "t2": -1, "t4": -1}), (1.5, {"t5": 1, "t6": 1}), (1.5, {"t5": 1, "t6": -1}), (2, {})]),
    "layout8_corners": dict(n=8, segments=[(1.5, {"t5": 1, "t6": 1, "t7": 1, "t8": 1}), (1.5, {"t5": 1, "t7": 1, "t6": -1, "t8": -1}), (1.5, {"t5": 1, "t6": 1, "t7": -1, "t8": -1}),
                                           (2, {"t1": .8, "t2": .8, "t3": .8, "t4": .8}), (2, {})]),
}


def run_thrusters(sc):
    rov = P.Rov(buoyancy=0.0, tool="nose", thrusters=sc["n"])
    rov.depth = 1.0
    rows, n = [], 0
    for secs, cmd in sc["segments"]:
        for k in rov.cmd:
            rov.set_cmd(k, cmd.get(k, 0.0))
        for _ in range(int(round(secs / DT))):
            rov.step(DT)
            n += 1
            if n % EVERY == 0:
                s = rov.state()
                im = s["imu"]
                rows.append([s["x"], s["y"], s["depth"], s["yaw"], s["pitch"], s["roll"], s["speed"], im["ax"], im["ay"], im["az"], im["gx"], im["gy"], im["gz"]])
    return rows


def run_current(sc):
    rov = P.Rov(buoyancy=0.0, tool="nose")
    rov_current.add_to(rov)
    for k, v in sc["pose"].items():
        setattr(rov, k, v)
    rows, n = [], 0
    for secs, cmd in sc["segments"]:
        for k in ("t1", "t2", "t3", "t4"):
            rov.set_cmd(k, cmd.get(k, 0.0))
        for _ in range(int(round(secs / DT))):
            rov.step(DT)
            n += 1
            if n % EVERY == 0:
                s = rov.state()
                im = s["imu"]
                rows.append([s["x"], s["y"], s["depth"], s["yaw"], s["pitch"], s["speed"], im["ax"], im["ay"], im["az"], im["gz"], s["roll"], im["gx"]])
    return rows


def run_ring(sc):
    rov = P.Rov(buoyancy=0.0, tool=sc["tool"])
    rov_props.add_to(rov, sc["rings"])
    for k, v in sc["rov"].items():
        setattr(rov, k, v)
    for i, over in sc["ringset"].items():
        for k, v in over.items():
            setattr(rov.props[i], k, v)
    rows, n = [], 0
    for secs, cmd in sc["segments"]:
        for k in ("t1", "t2", "t3", "t4"):
            rov.set_cmd(k, cmd.get(k, 0.0))
        if "claw_target" in cmd:
            rov.claw_target = cmd["claw_target"]
        for _ in range(int(round(secs / DT))):
            rov.step(DT)
            n += 1
            if n % EVERY == 0:
                row = [rov.x, rov.y, rov.depth, rov.yaw, rov.pitch]
                for ring in rov.props:
                    row += [ring.x, ring.y, ring.depth, ring.yaw, int(ring.held), int(ring.hooked), int(ring.lifting)]
                rows.append(row)
    return rows


def build():
    return {"dt": DT, "every": EVERY, "columns": ["x", "y", "depth", "yaw", "pitch", "speed", "splash_n", "floor_n", "ax", "ay", "az", "gy", "gz"],
            "scenarios": {name: {"buoyancy": sc[0], "speed": sc[2] if len(sc) > 2 else 1.0, "segments": [[t, c] for t, c in sc[1]], "rows": run(sc[0], sc[1], sc[2] if len(sc) > 2 else 1.0)}
                          for name, sc in SCENARIOS.items()},
            "thruster_scenarios": {name: {**sc, "segments": [[t, c] for t, c in sc["segments"]], "rows": run_thrusters(sc)} for name, sc in THRUSTER_SCENARIOS.items()},
            "current_scenarios": {name: {**sc, "segments": [[t, c] for t, c in sc["segments"]], "rows": run_current(sc)} for name, sc in CURRENT_SCENARIOS.items()},
            "ring_scenarios": {name: {**sc, "ringset": {str(k): v for k, v in sc["ringset"].items()}, "segments": [[s, c] for s, c in sc["segments"]], "rows": run_ring(sc)}
                               for name, sc in RING_SCENARIOS.items()}}


if __name__ == "__main__":
    text = json.dumps(build(), indent=0)
    if "--check" in sys.argv:
        old = json.load(open(OUT)) if os.path.exists(OUT) else None
        if old != json.loads(text):
            sys.exit("golden file is out of date: run  python3 tools/export_golden.py  and commit it")
        print("golden file matches the Python physics")
    else:
        with open(OUT, "w") as f:
            f.write(text + "\n")
        print("wrote", os.path.relpath(OUT))
