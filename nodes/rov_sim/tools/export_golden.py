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
    "pitch_trim":      (1.5, [(2, {"t3": .8, "t4": -.8}), (2, {"t3": -.8, "t4": .8}), (3, {})]),
    "into_east_wall":  (1.5, [(8, {"t1": .8, "t2": .8}), (2, {})]),
    "turn_in_corner":  (1.5, [(5, {"t1": .8, "t2": .8}), (3, {"t1": -.8, "t2": .8}), (3, {"t1": .8, "t2": .8})]),
    "shelf_deep_step": (0.0, [(2, {"t3": 0, "t4": 0}), (1, {"t1": .8, "t2": .6}), (10, {"t1": .8, "t2": .8})]),   # runs at the shallow-end step while deep
    "shelf_shallow":   (1.5, [(2.5, {"t3": .8, "t4": .8}), (1, {}), (3, {"t1": .5, "t2": .8}), (6, {"t1": .8, "t2": .8}), (3, {"t3": -.8, "t4": -.8})]),
}


def run(buoy, segs):
    rov = P.Rov(buoyancy=buoy, tool="nose")
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


def build():
    return {"dt": DT, "every": EVERY, "columns": ["x", "y", "depth", "yaw", "pitch", "speed", "splash_n", "floor_n", "ax", "ay", "az", "gy", "gz"],
            "scenarios": {name: {"buoyancy": b, "segments": [[s, c] for s, c in segs], "rows": run(b, segs)} for name, (b, segs) in SCENARIOS.items()}}


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
