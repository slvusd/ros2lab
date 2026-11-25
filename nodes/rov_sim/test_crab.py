#!/usr/bin/env python3
# =============================================================================
# test_crab.py — checks for the green crab and the Pushable base class (plain Python, no ROS, no browser)
# =============================================================================
#   python3 nodes/rov_sim/test_crab.py          run everything
#   python3 nodes/rov_sim/test_crab.py chase    only tests whose name contains "chase"
# Separate from test_physics.py on purpose: the crab is an optional add-on with its own tests (delete rov_crab.py and this file together).
# =============================================================================
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rov_crab
import rov_pushable
import rov_shape
from rov_physics import POOL_REGIONS, Rov

DT = 1 / 60
SHELF = min(POOL_REGIONS, key=lambda r: r[4])
FLOOR = SHELF[4]


def make(crabs=1, **kw):
    kw.setdefault("buoyancy", 0.0)
    kw.setdefault("tool", "nose")
    r = Rov(**kw)
    rov_crab.add_to(r, crabs)
    return r, [p for p in r.props if p.type == "crab"]


def inside_shelf(c, slack=1e-6):
    return SHELF[0] - slack <= c.x <= SHELF[1] + slack and SHELF[2] - slack <= c.y <= SHELF[3] + slack


def put_rov_on_the_shelf(r, x, y, yaw=0.0):
    r.x, r.y, r.yaw = x, y, yaw
    r.depth = FLOOR - 0.28 - 0.002        # resting on the floor: the lowest bits of the frame are a couple of cm above it


def min_gap(r, c):
    """Closest the ROV's surface gets to the crab's body (negative = overlapping)."""
    return rov_shape.distance_to_rov(r, (c.x, c.y, -FLOOR + 0.02))[0] - c.RADIUS


def test_crab_crawls_on_the_floor_of_the_shallow_end():
    r, (c,) = make()
    r.x, r.y = -2.5, -1.0                       # the ROV is far away in the deep end
    xs, ys, modes, speeds = [], [], set(), []
    for _ in range(60 * 240):
        r.step(DT)
        assert inside_shelf(c), f"left the shallow end at ({c.x:.2f}, {c.y:.2f})"
        xs.append(c.x); ys.append(c.y); modes.add(c.mode); speeds.append(c.speed)
    assert max(xs) - min(xs) > 0.4 or max(ys) - min(ys) > 0.4, "the crab barely moved in 4 minutes"
    assert {"pause", "walk"} <= modes, f"it should sit and crawl: {modes}"
    assert max(speeds) <= rov_crab.Crab.SCUTTLE + 1e-9 and max(speeds) < 0.1, f"crawls at {max(speeds):.2f} m/s"
    s = c.state()
    assert abs(s["depth"] - (FLOOR - 0.02)) < 1e-9, "it stays on the floor"


def test_crab_walks_sideways():
    """The body is turned across the way it goes: the claws point about a quarter turn away from the direction of travel."""
    r, (c,) = make()
    r.x, r.y = -2.5, -1.0
    checked = 0
    last = (c.x, c.y)
    for i in range(60 * 120):
        r.step(DT)
        if c.mode == "walk" and i % 30 == 0:
            heading = math.atan2(c.y - last[1], c.x - last[0]) if math.hypot(c.x - last[0], c.y - last[1]) > 1e-5 else None
            if heading is not None:
                err = abs((c.yaw - heading + math.pi) % (2 * math.pi) - math.pi)
                if abs(err - math.pi / 2) < 0.5:
                    checked += 1
        if i % 30 == 0:
            last = (c.x, c.y)
    assert checked > 5, f"only {checked} samples with the claws a quarter turn from the direction of travel"


def test_crab_is_pushed_out_of_the_way_by_the_rov():
    r, (c,) = make()
    c.x, c.y = 1.8, 2.6                          # the middle of the shelf
    c.timer = 1e9                                # sitting still, so only the ROV moves it
    put_rov_on_the_shelf(r, 1.8 - 0.9, 2.6, 0.0)
    start = (c.x, c.y)
    touched = 0
    worst_overlap = 0.0
    r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0)
    for _ in range(60 * 6):
        r.step(DT)
        touched += c.pushed
        worst_overlap = min(worst_overlap, min_gap(r, c))
        assert inside_shelf(c)
    assert touched > 0, "the ROV drove through the crab without touching it"
    assert c.x > start[0] + 0.25, f"the crab was only moved {c.x - start[0]:.2f} m along the ROV's path"
    assert worst_overlap > -0.02, f"the crab ended up {-worst_overlap * 100:.1f} cm inside the ROV"


def test_crab_is_not_touched_by_a_ROV_passing_well_above_it():
    r, (c,) = make()
    c.x, c.y = 1.8, 2.6
    c.timer = 1e9
    r.x, r.y, r.yaw, r.depth = 0.9, 2.6, 0.0, 0.30     # the ROV's lowest part is about 0.4 m above the shelf floor, far above the crab
    r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0)
    for _ in range(60 * 5):
        r.step(DT)
        assert not c.pushed, "a ROV high above the floor pushed the crab"


def test_crab_cannot_outrun_the_rov():
    """A ROV that chases it flat out reaches it (and shoves it) well within a minute, whatever it does."""
    for seed_offset in (0, 7):
        r, (c,) = make(speed=1.0)
        c.seed += seed_offset
        c.reset()
        put_rov_on_the_shelf(r, SHELF[0] + 0.3, SHELF[2] + 0.3)
        contacts = 0
        top = 0.0
        for _ in range(60 * 60):
            err = math.atan2(c.y - r.y, c.x - r.x) - r.yaw
            err = (err + math.pi) % (2 * math.pi) - math.pi
            r.set_cmd("t1", max(-1, min(1, 1 - 1.5 * err))); r.set_cmd("t2", max(-1, min(1, 1 + 1.5 * err)))
            r.step(DT)
            contacts += c.pushed
            top = max(top, c.speed)
            assert inside_shelf(c)
        assert contacts > 0, f"seed +{seed_offset}: the ROV never got to the crab in a minute"
        assert top <= rov_crab.Crab.SCUTTLE + 1e-9


def test_crab_scuttles_away_when_the_rov_gets_close():
    r, (c,) = make()
    c.x, c.y = 1.8, 3.0
    c.timer = 1e9
    put_rov_on_the_shelf(r, 1.8, 2.0)            # 1 m away (its surface is ~0.7 m from the crab): outside the scare distance
    for _ in range(30):
        r.step(DT)
    assert c.mode == "pause", f"it should not mind a ROV that far away ({c.mode}, gap {c.gap:.2f})"
    r.x, r.y = 1.8, 2.7                           # now 0.3 m away: its surface is well inside the scare distance
    for _ in range(60 * 2):
        r.step(DT)
        r.x, r.y = 1.8, 2.7                       # hold the ROV still, close to the crab
        r.u = r.v = 0.0
    assert c.mode == "scuttle" or c.gap > c.SCARE_AT, "a close ROV should send it scuttling"
    assert c.y >= 3.0 - 1e-6, "it should move away from the ROV, not toward it"


def test_crab_stays_inside_the_shallow_end_even_when_shoved_hard():
    r, (c,) = make()
    for corner in ((SHELF[1] - 0.2, SHELF[3] - 0.2), (SHELF[0] + 0.2, SHELF[3] - 0.2), (SHELF[1] - 0.2, SHELF[2] + 0.2)):
        c.x, c.y = corner
        c.timer = 1e9
        for heading in (0.0, math.pi / 2, math.pi, -math.pi / 2):
            put_rov_on_the_shelf(r, c.x - math.cos(heading) * 0.7, c.y - math.sin(heading) * 0.7, heading)
            r.u = r.v = 0.0
            r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0)
            for _ in range(60 * 3):
                r.step(DT)
                assert inside_shelf(c), f"pushed out of the shallow end: ({c.x:.2f}, {c.y:.2f})"
            r.set_cmd("t1", 0.0); r.set_cmd("t2", 0.0)


def test_pushable_base_class_works_on_its_own():
    """The base class is generic: a thing that never moves by itself is still shoved by the ROV and kept inside its rectangle."""
    class Rock(rov_pushable.Pushable):
        type = "rock"
    r = Rov(buoyancy=0.0, tool="nose")
    rock = Rock(1.8, 2.6)
    r.props.append(rock)
    put_rov_on_the_shelf(r, 0.9, 2.6)
    r.set_cmd("t1", 1.0); r.set_cmd("t2", 1.0)
    for _ in range(60 * 5):
        r.step(DT)
    assert rock.x > 2.0, f"the rock should have been pushed along (x={rock.x:.2f})"
    assert rock.state()["type"] == "rock" and SHELF[0] <= rock.x <= SHELF[1]
    r.reset()
    assert (rock.x, rock.y) == (1.8, 2.6), "Reset puts it back"


def test_crab_reset_and_state():
    r, _crabs = make(crabs=2)
    r.x, r.y = -2.5, -1.0
    first = [(p.x, p.y) for p in r.props]
    for _ in range(60 * 30):
        r.step(DT)
    r.reset()
    assert [(p.x, p.y) for p in r.props] == first, "Reset puts the crabs back where they started"
    assert len({(round(x, 3), round(y, 3)) for x, y in first}) == 2, "two crabs start in different places"
    s = json.loads(json.dumps(r.state()))                # the whole state must stay JSON-friendly
    crabs = [p for p in s["props"] if p["type"] == "crab"]
    assert len(crabs) == 2 and {"x", "y", "depth", "yaw", "speed", "moving", "color", "r"} <= set(crabs[0])


def test_crab_coexists_with_rings_and_fish():
    import rov_fish
    import rov_props
    r = Rov(buoyancy=0.0, tool="claw")
    rov_props.add_to(r, 3)
    rov_fish.add_to(r, 1)
    rov_crab.add_to(r, 1)
    r.x, r.y = -2.5, -1.0
    for _ in range(60 * 20):
        r.step(DT)
    types = [p["type"] for p in r.state()["props"]]
    assert types.count("ring") == 3 and types.count("fish") == 1 and types.count("crab") == 1


def test_crab_speed_with_everything_on():
    import rov_fish
    import rov_props
    r = Rov(buoyancy=0.0, tool="claw")
    rov_props.add_to(r, 3); rov_fish.add_to(r, 1); rov_crab.add_to(r, 3)
    put_rov_on_the_shelf(r, 1.0, 2.0)
    t = time.time()
    for _ in range(600):
        r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT)
    ms = (time.time() - t) / 600 * 1000
    assert ms < 5.0, f"{ms:.1f} ms per step is too slow for 60 Hz"


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
