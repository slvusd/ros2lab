#!/usr/bin/env python3
# =============================================================================
# test_stairs.py — the three steps cut into the shallow end's outer wall (rov_physics.POOL_STAIRS)
# =============================================================================
#   python3 nodes/rov_sim/test_stairs.py
# =============================================================================
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rov_crab
import rov_fish
import rov_props
import rov_shape
from rov_physics import POOL_REGIONS, POOL_STAIRS, POOL_WATER, Rov, floor_at

DT = 1 / 60
SHELF = min(POOL_WATER, key=lambda r: r[4])


def in_stairs(x, y):
    return any(r[0] - 1e-6 <= x <= r[1] + 1e-6 and r[2] - 1e-6 <= y <= r[3] + 1e-6 for r in POOL_STAIRS)


def test_three_steps_in_the_outer_wall_of_the_shallow_end():
    assert len(POOL_STAIRS) == 3 and POOL_REGIONS == POOL_WATER + POOL_STAIRS
    first, second, third = POOL_STAIRS
    assert abs(first[0] - SHELF[1]) < 1e-9 and abs(second[0] - first[1]) < 1e-9 and abs(third[0] - second[1]) < 1e-9, "one after the other, going out from the shelf's end wall"
    assert 0 < third[4] < second[4] < first[4] < SHELF[4], "each step is shallower than the one before"
    assert third[4] > 0.34, "even the top step is deep enough for a whole ring (0.32 m high) to lie under the water"
    mid = (SHELF[2] + SHELF[3]) / 2
    assert abs((first[2] + first[3]) / 2 - mid) < 1e-9 and first[3] - first[2] <= SHELF[3] - SHELF[2] - 0.19, "in the middle of the wall, narrower than it"


def test_the_rov_can_drive_onto_the_first_step():
    r = Rov(buoyancy=1.5, tool="nose")                                                      # (floating at the surface)
    first, second, third = POOL_STAIRS
    r.x, r.y, r.depth, r.yaw = SHELF[1] - 1.0, (first[2] + first[3]) / 2, 0.3, 0.0          # on the shelf, near the surface, facing the stairs
    for k in ("t1", "t2"):
        r.set_cmd(k, 0.5)
    for _ in range(60 * 8):
        r.step(DT)
    assert r.x > first[0] + 0.3, f"it is over the first step (x {r.x:.2f}, the step starts at {first[0]:.2f})"
    assert in_stairs(r.x, r.y) and r.x < third[1] + 0.05, "and stopped by the end wall of the stairs"


def test_a_ring_lies_on_a_step():
    for step in POOL_STAIRS:
        x, y = (step[0] + step[1]) / 2, (step[2] + step[3]) / 2
        r = Rov(buoyancy=0.0, tool="nose")
        rov_props.add_to(r, 1)
        ring = [p for p in r.props if p.type == "ring"][0]
        ring.x, ring.y, ring.yaw, ring.depth = x, y, math.pi / 2, 0.2
        for _ in range(60 * 5):
            r.step(DT)
        want = step[4] - ring.R - ring.TUBE
        assert abs(ring.depth - want) < 0.02, f"the ring rests on the step ({ring.depth:.2f} m deep, the step's floor is {step[4]} so {want:.2f})"
        assert in_stairs(ring.x, ring.y)


def test_the_collision_shape_and_floor_follow_the_stairs():
    x, y = (POOL_STAIRS[2][0] + POOL_STAIRS[2][1]) / 2, (POOL_STAIRS[2][2] + POOL_STAIRS[2][3]) / 2
    assert floor_at(x, y) == POOL_STAIRS[2][4]
    assert floor_at(POOL_STAIRS[0][0] + 0.1, y) == POOL_STAIRS[0][4]


def test_the_crab_and_the_fish_stay_out_of_the_stairs():
    r = Rov(buoyancy=1.5, tool="nose")
    rov_crab.add_to(r, 3)
    rov_fish.add_to(r, 1)
    for _ in range(60 * 90):
        r.step(DT)
        for p in r.props:
            if p.type in ("crab", "fish"):
                assert not in_stairs(p.x, p.y), f"a {p.type} is on the stairs at ({p.x:.2f}, {p.y:.2f})"
    # shoving the crab hard towards the stairs does not get it onto them either
    crab = [p for p in r.props if p.type == "crab"][0]
    crab.x, crab.y = SHELF[1] - 0.2, (POOL_STAIRS[0][2] + POOL_STAIRS[0][3]) / 2
    crab.pvx = 1.0
    for _ in range(60 * 3):
        r.step(DT)
        assert not in_stairs(crab.x, crab.y), "the crab was shoved onto the stairs"


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    if len(sys.argv) > 1:
        tests = [(n, f) for n, f in tests if sys.argv[1] in n]
    failed = 0
    for n, f in tests:
        try:
            f()
            print("PASS ", n)
        except AssertionError as e:
            failed += 1
            print("FAIL ", n + ":", e)
    print(f"\n{len(tests) - failed} of {len(tests)} passed")
    sys.exit(1 if failed else 0)
