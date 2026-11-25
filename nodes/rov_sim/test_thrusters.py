#!/usr/bin/env python3
# =============================================================================
# test_thrusters.py — checks for the 3, 4, 6 and 8 thruster layouts (rov_physics.THRUSTER_LAYOUTS)
# =============================================================================
#   python3 nodes/rov_sim/test_thrusters.py          run everything
#   python3 nodes/rov_sim/test_thrusters.py roll     only tests whose name contains "roll"
# =============================================================================
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rov_physics as P
import rov_shape
from rov_physics import Rov, THRUSTER_LAYOUTS

DT = 1 / 60


def drive(n, cmds, secs=2.0, depth=1.0, **kw):
    kw.setdefault("buoyancy", 0.0)
    r = Rov(tool="nose", thrusters=n, **kw)
    r.depth, r.x, r.y = depth, -2.0, 0.0
    for k, v in cmds.items():
        assert r.set_cmd(k, v), k
    for _ in range(int(secs / DT)):
        r.step(DT)
    return r


def test_layouts_have_the_right_thrusters():
    counts = {3: (2, 1), 4: (2, 2), 6: (4, 2), 8: (4, 4)}                # (horizontal, vertical)
    for n, (nh, nv) in counts.items():
        lay = THRUSTER_LAYOUTS[n]
        assert [t["name"] for t in lay] == [f"t{i}" for i in range(1, n + 1)], n
        assert sum(t["kind"] == "h" for t in lay) == nh and sum(t["kind"] == "v" for t in lay) == nv, f"{n}: {nh} horizontal and {nv} vertical"
        for t in lay:
            assert {"name", "kind", "x", "y", "gx", "gy", "dx", "dy", "label", "color"} <= set(t)
            if t["kind"] == "h":
                assert abs(math.hypot(t["dx"], t["dy"]) - 1.0) < 1e-12, "a horizontal thruster points along a unit vector"
    four = {t["name"]: t for t in THRUSTER_LAYOUTS[4]}
    assert (four["t1"]["y"], four["t2"]["y"]) == (P.TURN_ARM, -P.TURN_ARM) and (four["t3"]["x"], four["t4"]["x"]) == (P.VERT_ARM, -P.VERT_ARM), "the original layout is unchanged"
    assert P.layout_for(5) is THRUSTER_LAYOUTS[4] and P.layout_for(7) is THRUSTER_LAYOUTS[4], "any other number gives the original four"


def test_six_and_eight_put_the_horizontal_thrusters_on_the_four_posts_and_the_vertical_ones_where_asked():
    for n in (6, 8):
        h = [t for t in THRUSTER_LAYOUTS[n] if t["kind"] == "h"]
        assert sorted((round(t["x"], 3), round(t["y"], 3)) for t in h) == [(-0.25, -0.25), (-0.25, 0.25), (0.25, -0.25), (0.25, 0.25)], "on the four vertical posts"
        assert all(abs(abs(t["dx"]) - math.sqrt(0.5)) < 1e-12 and abs(abs(t["dy"]) - math.sqrt(0.5)) < 1e-12 for t in h), "angled 45 degrees"
        assert {t["name"] for t in h if t["y"] > 0} == {"t1", "t3"} and all(t["color"] == "red" for t in h if t["y"] > 0), "t1 and t3 are the left ones (red)"
        assert all(t["color"] == "green" for t in h if t["y"] < 0)
    v6 = [t for t in THRUSTER_LAYOUTS[6] if t["kind"] == "v"]
    assert [(t["x"], t["y"]) for t in v6] == [(P.VERT_ARM, 0.0), (-P.VERT_ARM, 0.0)], "two vertical thrusters on the centre line, where t3 and t4 are in the 4 layout"
    v8 = [t for t in THRUSTER_LAYOUTS[8] if t["kind"] == "v"]
    assert sorted((t["x"], t["y"]) for t in v8) == [(-0.2, -0.2), (-0.2, 0.2), (0.2, -0.2), (0.2, 0.2)], "four vertical thrusters on the corners"
    v3 = [t for t in THRUSTER_LAYOUTS[3] if t["kind"] == "v"]
    assert len(v3) == 1 and (v3[0]["x"], v3[0]["y"]) == (0.0, 0.0), "the 3 layout has one up/down thruster in the middle"


def test_channels_follow_the_layout():
    for n in (3, 4, 6, 8):
        r = Rov(thrusters=n)
        assert list(r.cmd) == [f"t{i}" for i in range(1, n + 1)] and r.thrusters == n
        s = json.loads(json.dumps(r.state()))
        assert s["thrusters"] == n and len(s["layout"]) == n and all(f"t{i}" in s for i in range(1, n + 1)) and f"t{n + 1}" not in s
    r = Rov(thrusters=4)
    assert r.set_cmd("t5", 1.0) is False and "t5" not in r.cmd, "a channel this layout does not have is ignored"
    assert r.set_cmd("t1", 5.0) and r.cmd["t1"] == 1.0, "and commands are clamped to -1..1"
    r.set_cmd("t3", 0.5)
    r.set_layout(6)
    assert list(r.cmd) == [f"t{i}" for i in range(1, 7)] and all(v == 0.0 for v in r.cmd.values()), "switching layout zeroes the commands"
    r.reset()
    assert all(v == 0.0 for v in r.cmd.values())


def test_six_thrusters_forward_turn_and_strafe_come_from_the_vectored_posts():
    fwd = drive(6, dict(t1=1, t2=1, t3=1, t4=1))
    assert fwd.x - (-2.0) > 1.0 and abs(fwd.y) < 1e-9 and abs(fwd.yaw) < 1e-9, f"all four forward: straight ahead (x {fwd.x:.2f}, y {fwd.y:.3f}, yaw {fwd.yaw:.3f})"
    turn = drive(6, dict(t1=1, t3=1, t2=-1, t4=-1))
    assert turn.yaw < -1.0 and abs(turn.x + 2.0) < 1e-6 and abs(turn.y) < 1e-6, "left pair forward, right pair back: a pure turn to the right (clockwise, yaw negative)"
    strafe = drive(6, dict(t1=1, t4=1, t2=-1, t3=-1))
    assert strafe.y < -0.5 and abs(strafe.yaw) < 1e-9 and abs(strafe.x + 2.0) < 1e-6, f"t1 and t4 forward, t2 and t3 back: slide to the RIGHT (y {strafe.y:.2f}, yaw {strafe.yaw:.3f})"
    left = drive(6, dict(t2=1, t3=1, t1=-1, t4=-1))
    assert left.y > 0.5 and abs(left.yaw) < 1e-9, "and the mirror image slides left"
    four = drive(4, dict(t1=1, t2=1))
    assert fwd.x > four.x, "four thrusters push harder than two (every thruster is the same size)"
    # the 4 layout cannot slide sideways at all: a pure turn leaves it where it was
    pivot = drive(4, dict(t1=1, t2=-1))
    assert abs(pivot.y) < 1e-6 and abs(pivot.x + 2.0) < 1e-6 and pivot.yaw < -0.5


def test_eight_has_the_same_horizontal_control_as_six():
    for cmds in (dict(t1=1, t2=1, t3=1, t4=1), dict(t1=1, t3=1, t2=-1, t4=-1), dict(t1=1, t4=1, t2=-1, t3=-1)):
        a, b = drive(6, cmds), drive(8, cmds)
        assert abs(a.x - b.x) < 1e-9 and abs(a.y - b.y) < 1e-9 and abs(a.yaw - b.yaw) < 1e-9, cmds


def test_three_thrusters_one_vertical_is_half_of_the_vertical_push_and_cannot_pitch():
    up3, up4 = drive(3, dict(t3=1), 1.0, buoyancy=0.0), drive(4, dict(t3=1, t4=1), 1.0)
    assert 0 < (1.0 - up3.depth) < (1.0 - up4.depth), "it rises, but not as fast as with two"
    assert abs((1.0 - up3.depth) * 2 - (1.0 - up4.depth)) < 0.5 * (1.0 - up4.depth)
    assert up3.pitch == 0.0 and abs(up3.roll) < 1e-12, "a single thruster in the middle has no lever: no pitch"
    two = drive(4, dict(t3=1), 1.0)
    assert abs(two.pitch) > 0.01, "while one of two (off-centre) thrusters does tilt the ROV"
    fwd = drive(3, dict(t1=1, t2=1))
    ref = drive(4, dict(t1=1, t2=1))
    assert abs(fwd.x - ref.x) < 1e-9, "the side thrusters are the same as in the 4 layout"


def test_eight_corner_vertical_thrusters_lift_hold_pitch_and_roll():
    up8, up4 = drive(8, dict(t5=1, t6=1, t7=1, t8=1), 1.0), drive(4, dict(t3=1, t4=1), 1.0)
    assert (1.0 - up8.depth) > 1.3 * (1.0 - up4.depth), "four vertical thrusters lift more than two"
    assert abs(up8.pitch) < 1e-12 and abs(up8.roll) < 1e-12, "level push: no tilt"
    roll = drive(8, dict(t5=1, t7=1, t6=-1, t8=-1), 1.0)
    assert roll.roll > 0.1 and abs(roll.pitch) < 1e-9, f"left side up: roll positive, the right side goes DOWN ({math.degrees(roll.roll):.1f} deg)"
    rev = drive(8, dict(t6=1, t8=1, t5=-1, t7=-1), 1.0)
    assert rev.roll < -0.1 and abs(rev.roll + roll.roll) < 1e-9, "and the mirror image rolls the other way"
    nose = drive(8, dict(t5=1, t6=1, t7=-1, t8=-1), 1.0)
    assert nose.pitch < -0.1 and abs(nose.roll) < 1e-9, f"front up, rear down: nose UP (pitch negative, {math.degrees(nose.pitch):.1f} deg)"
    six = drive(6, dict(t5=1, t6=-1), 1.0)
    assert abs(six.roll) < 1e-12, "the 6 layout has no way to roll the ROV"


def test_a_corner_propeller_that_is_out_of_the_water_loses_its_push():
    """A ROV near the surface and heeled over: the raised side's propellers come out of the water first, so the push is lopsided."""
    levels = []
    for depth in (1.0, -0.15):
        r = Rov(buoyancy=0.0, tool="nose", thrusters=8)
        r.depth, r.roll = depth, 0.1
        for k in ("t5", "t6", "t7", "t8"):
            r.set_cmd(k, 1.0)
        r.step(DT)
        levels.append(r.roll_rate)
    assert levels[1] < levels[0] - 0.001, f"near the surface the raised (left) side pushes less: roll rate {levels}"


def test_the_collision_shape_follows_the_layout():
    counts = {}
    for n in (3, 4, 6, 8):
        r = Rov(thrusters=n)
        caps = rov_shape.capsules(r)
        counts[n] = sum(c[3] == "thruster" for c in caps)
    assert counts == {3: 4 + 3, 4: 4 + 6, 6: 8 + 6, 8: 8 + 12}, counts
    r6 = Rov(thrusters=6)
    th = [c for c in rov_shape.capsules(r6) if c[3] == "thruster"]
    xs = [p - r6.x for c in th for p in (c[0][0], c[1][0])]               # (the capsules are in world coordinates: measure from the ROV)
    ys = [p - r6.y for c in th for p in (c[0][1], c[1][1])]
    assert max(xs) > 0.3 and min(xs) < -0.3 and max(ys) > 0.3 and min(ys) < -0.3, "the posts' thrusters stick out at all four corners"
    r = Rov(thrusters=4)
    k1 = rov_shape.capsules(r)
    r.set_layout(6)
    assert rov_shape.capsules(r) is not k1 and len(rov_shape.capsules(r)) != len(k1), "the shape cache notices a layout change"


def test_a_ring_can_be_pushed_by_the_corner_thrusters():
    import rov_props
    r = Rov(buoyancy=0.0, tool="nose", thrusters=6)
    rov_props.add_to(r, 1)
    ring = [p for p in r.props if p.type == "ring"][0]
    ring.x, ring.y, ring.yaw = 0.0, 0.3, math.pi / 2                       # in line with the left rear corner thruster
    r.x, r.y, r.yaw, r.depth = -1.0, 0.3, 0.0, 1.55
    for k in ("t1", "t2", "t3", "t4"):
        r.set_cmd(k, 0.6)
    for _ in range(60 * 4):
        r.step(DT)
    assert ring.x > r.x, f"the ROV with posts' thrusters still pushes a ring ahead of it (ring x {ring.x:.2f}, ROV x {r.x:.2f})"


def test_speed_setting_scales_every_horizontal_thruster_but_not_the_vertical_ones():
    a, b = drive(6, dict(t1=1, t2=1, t3=1, t4=1, t5=1), 0.5, speed=1.0), drive(6, dict(t1=1, t2=1, t3=1, t4=1, t5=1), 0.5, speed=2.0)
    assert b.u > 1.6 * a.u, "speed 2 doubles the horizontal thrust"
    assert abs(a.w - b.w) < 1e-9, "and leaves the vertical ones alone"


def test_physics_with_eight_thrusters_runs_at_60_hz():
    r = Rov(buoyancy=1.5, tool="claw", thrusters=8)
    t = time.time()
    for i in range(600):
        for k in r.cmd:
            r.set_cmd(k, 0.4)
        r.step(DT)
    ms = (time.time() - t) / 600 * 1000
    assert ms < 5.0, f"{ms:.2f} ms per step"


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
