#!/usr/bin/env python3
# =============================================================================
# test_current.py — checks for the water jets (rov_current.py) and the core's "a prop may move the water" hook
# =============================================================================
#   python3 nodes/rov_sim/test_current.py          run everything
#   python3 nodes/rov_sim/test_current.py imu      only tests whose name contains "imu"
# Separate from test_physics.py on purpose: the jets are an optional add-on (delete rov_current.py and this file together).
# =============================================================================
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rov_current
from rov_physics import POOL_REGIONS, Rov

DT = 1 / 60
MAIN = max(POOL_REGIONS, key=lambda r: r[4])
WALL_Y = MAIN[3]
JET_X = (MAIN[0] + min(r[0] for r in POOL_REGIONS if r is not MAIN)) / 2      # the middle of the wall (the stretch before the shallow end opens)
G = 9.81


def make(jets=True, **kw):
    kw.setdefault("buoyancy", 0.0)
    kw.setdefault("tool", "nose")
    r = Rov(**kw)
    rov_current.add_to(r, jets)
    return r


def place(r, x, y, depth, yaw=0.0):
    r.x, r.y, r.depth, r.yaw = x, y, depth, yaw


def run(r, seconds, **cmd):
    for k, v in cmd.items():
        r.set_cmd(k, v)
    for _ in range(int(seconds / DT)):
        r.step(DT)
    for k in ("t1", "t2", "t3", "t4"):
        r.set_cmd(k, 0)


def jets_of(r):
    return [p for p in r.props if p.type == "jets"][0]


def test_two_outlets_in_the_middle_of_the_shallow_end_side_wall_at_a_third_and_two_thirds_depth():
    j = rov_current.Jets()
    assert len(j.outlets) == 2
    for o in j.outlets:
        assert o["y"] == WALL_Y, "on the +y wall: the side the shallow end is on"
        assert abs(o["x"] - JET_X) < 1e-9 and (o["dx"], o["dy"]) == (0.0, -1.0), "in the middle of the wall, shooting straight into the pool"
    assert sorted(round(o["depth"], 6) for o in j.outlets) == [round(MAIN[4] / 3, 6), round(2 * MAIN[4] / 3, 6)]
    assert MAIN[0] < JET_X < min(r[0] for r in POOL_REGIONS if r is not MAIN), "on the stretch of wall that is really a wall"
    assert abs(j.length - (MAIN[3] - MAIN[2])) < 1e-9


def test_jet_profile_is_fast_at_the_nozzle_decays_spreads_and_stops_at_the_wall():
    j = rov_current.Jets()
    d = j.outlets[0]["depth"]
    assert abs(-j.flow(JET_X, WALL_Y - 0.2, d)[1] - rov_current.U0) < 0.05, "at the nozzle it should be about U0"
    on_axis = [j.flow(JET_X, WALL_Y - s, d)[1] for s in (0.8, 1.0, 1.5, 2.0, 2.9)]        # past the nozzle's fast core (about 0.6 m)
    assert all(v < 0 for v in on_axis), "the water flows away from the wall (-y)"
    speeds = [-v for v in on_axis]
    assert speeds == sorted(speeds, reverse=True), f"it should slow down with distance: {speeds}"
    assert j.flow(JET_X, WALL_Y + 0.3, d) == (0.0, 0.0, 0.0), "nothing behind the wall"
    assert j.flow(JET_X, WALL_Y - 4.0, d) == (0.0, 0.0, 0.0), "nothing past the far wall"
    off = [-j.flow(JET_X + dx, WALL_Y - 1.5, d)[1] for dx in (0.0, 0.2, 0.4, 0.8)]
    assert off == sorted(off, reverse=True) and off[-1] < 0.3 * off[0], f"it falls off to the side: {off}"        # (a wide jet: still a good fraction 0.8 m to the side)
    left, right = j.flow(JET_X - 0.3, WALL_Y - 1.5, d), j.flow(JET_X + 0.3, WALL_Y - 1.5, d)
    assert abs(left[1] - right[1]) < 1e-9, "the jet is symmetric"
    one = rov_current.Jets()
    one.outlets = one.outlets[:1]                                # (with one jet: the other one would break the symmetry)
    assert abs(one.flow(JET_X, WALL_Y - 1.5, d + 0.3)[1] - one.flow(JET_X, WALL_Y - 1.5, d - 0.3)[1]) < 1e-9, "and symmetric up and down"


def test_two_jets_add_up_between_them():
    j = rov_current.Jets()
    mid = sum(o["depth"] for o in j.outlets) / 2
    one = rov_current.Jets()
    one.outlets = one.outlets[:1]
    both = -j.flow(JET_X, WALL_Y - 2.5, mid)[1]
    single = -one.flow(JET_X, WALL_Y - 2.5, mid)[1]
    assert both > 1.5 * single, f"midway between the jets the two should add up ({both:.3f} vs {single:.3f})"


def test_nothing_moves_without_jets():
    r = make(jets=False)
    place(r, JET_X, 0.0, 0.7)
    run(r, 5)
    assert abs(r.y) < 1e-9 and abs(r.v) < 1e-9 and abs(r.u) < 1e-9
    im = r.imu()
    assert abs(im["ax"]) < 1e-6 and abs(im["ay"]) < 1e-6 and abs(im["az"] - G) < 1e-6


def test_current_carries_a_resting_rov_away_from_the_wall():
    r = make()
    place(r, JET_X, 0.5, jets_of(r).outlets[0]["depth"])         # in the water 1 m out from the nozzle, on its axis
    start = r.y
    run(r, 1.5)
    assert r.y < start - 0.3 and r.v < -0.1, f"the current should carry the ROV away from the wall (moved {r.y - start:.2f} m, sideways speed {r.v:.2f} m/s)"
    run(r, 6)
    assert r.y < MAIN[2] + 0.6, "left alone it ends up against the far wall"


def test_imu_feels_the_current():
    quiet, jet = make(jets=False), make()
    for r in (quiet, jet):
        place(r, JET_X, 0.5, jets_of(jet).outlets[0]["depth"], yaw=0.0)        # facing +x, so the jet (-y) pushes it to its right: body y is LEFT, so a_left < 0
        run(r, 0.5)
    qa, ja = quiet.imu(), jet.imu()
    assert abs(qa["ay"]) < 1e-6
    assert ja["ay"] < -0.2, f"the accelerometer should show the push to the side: ay = {ja['ay']:.3f}"
    assert abs(ja["az"] - G) < 1.0, "gravity still reads about +9.8 up"
    # facing the wall, the jet pushes the ROV backwards: body x acceleration negative
    r2 = make()
    place(r2, JET_X, 0.5, jets_of(r2).outlets[0]["depth"], yaw=math.pi / 2)
    run(r2, 0.5)
    assert r2.imu()["ax"] < -0.2, f"facing the wall the push is backwards: ax = {r2.imu()['ax']:.3f}"
    # and once it is moving with the water the accelerometer settles back toward zero (the force is gone)
    run(r2, 6)
    assert abs(r2.imu()["ax"]) < 0.2


def test_the_rov_can_fight_the_current_but_not_near_the_nozzle():
    gains = {}
    for label, y0 in (("far", WALL_Y - 2.6), ("near", WALL_Y - 0.8)):
        r = make()
        place(r, JET_X, y0, jets_of(r).outlets[0]["depth"], yaw=math.pi / 2)   # facing the wall, level with the upper jet
        run(r, 6, t1=1.0, t2=1.0, t3=0.0, t4=0.0)
        gains[label] = r.y - y0
    assert gains["far"] > 0.5, f"far from the nozzle full thrust should make headway ({gains['far']:.2f} m in 6 s)"
    assert gains["near"] < gains["far"] - 0.5, f"near the nozzle the ROV should struggle far more: {gains}"


def test_the_rov_can_escape_sideways():
    r = make()
    place(r, JET_X, WALL_Y - 1.0, jets_of(r).outlets[0]["depth"], yaw=0.0)     # in the jet, facing along the wall
    run(r, 12, t1=1.0, t2=1.0)
    assert abs(r.x - JET_X) > 0.8, "it should be able to drive out of the jet sideways"
    wx, wy, _ = jets_of(r).flow(r.x, r.y, r.depth)
    assert math.hypot(wx, wy) < 0.25, f"... and then the water is calm ({math.hypot(wx, wy):.2f} m/s)"


def test_the_core_hook_works_for_any_prop_that_moves_the_water():
    class Wind:
        type = "wind"
        def reset(self): pass
        def step(self, rov, dt): pass
        def state(self): return {"type": "wind"}
        def flow(self, x, y, depth): return (0.3, 0.0, 0.0)
    r = Rov(buoyancy=0.0, tool="nose")
    r.props.append(Wind())
    place(r, 0.0, 0.0, 0.8)
    run(r, 8)
    assert r.x > 0.8 and 0.25 < r.u < 0.31, f"a steady 0.3 m/s current should carry it along at about that speed (x={r.x:.2f}, u={r.u:.2f})"


def test_state_is_plain_data_and_matches_the_flow():
    r = make()
    s = json.loads(json.dumps(r.state()))
    jets = [p for p in s["props"] if p["type"] == "jets"]
    assert len(jets) == 1 and len(jets[0]["outlets"]) == 2
    j = jets[0]
    for k in ("length", "u0", "k", "r0", "spread"):
        assert isinstance(j[k], (int, float))
    # the page recomputes the axial speed from these numbers: it must agree with the physics
    for s_ in (0.3, 0.8, 1.7, 2.6):
        page = min(j["u0"], j["k"] / s_)
        assert abs(page - rov_current.Jets.axial(s_)) < 1e-12


def test_current_coexists_with_the_other_add_ons_and_stays_fast():
    import rov_crab, rov_fish, rov_props
    r = Rov(buoyancy=0.0, tool="claw")
    rov_props.add_to(r, 3); rov_fish.add_to(r, 1); rov_crab.add_to(r, 2); rov_current.add_to(r)
    place(r, JET_X, 0.0, 0.8)
    t = time.time()
    for _ in range(600):
        r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT)
    ms = (time.time() - t) / 600 * 1000
    assert ms < 5.0, f"{ms:.1f} ms per step is too slow for 60 Hz"
    assert [p["type"] for p in r.state()["props"]].count("jets") == 1


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else ""
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_") and want in n]
    failed = 0
    for name, fn in tests:
        t = time.time()
        try:
            fn()
            print(f"PASS  {name}  ({time.time() - t:.1f}s)")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {name}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERROR {name}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed} of {len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
