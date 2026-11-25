#!/usr/bin/env python3
# =============================================================================
# test_physics.py — checks for the simulator's physics, in plain Python (no ROS, no browser)
# =============================================================================
#   python3 nodes/rov_sim/test_physics.py            run everything (takes about a minute)
#   python3 nodes/rov_sim/test_physics.py ring       run only tests whose name contains "ring"
# Prints PASS/FAIL per test and exits with a non-zero code if anything failed.
# =============================================================================
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rov_shape
from rov_physics import POOL_REGIONS, ROV_BOTTOM, Rov, floor_at, nearest_in

DT = 1 / 60


def run(r, seconds, **cmd):
    for k, v in cmd.items():
        r.set_cmd(k, v)
    for _ in range(int(seconds / DT)):
        r.step(DT)
    for k in ("t1", "t2", "t3", "t4"):
        r.set_cmd(k, 0)


def floor_under(x, y, eps=1e-4):
    """Like floor_at but forgiving by 0.1 mm: the walls tolerate a few micrometres of overshoot, so the checks must too."""
    ds = [r[4] for r in POOL_REGIONS if r[0] - eps <= x <= r[1] + eps and r[2] - eps <= y <= r[3] + eps]
    return max(ds) if ds else None


def inside_pool(x, y):
    return any(r[0] - 1e-6 <= x <= r[1] + 1e-6 and r[2] - 1e-6 <= y <= r[3] + 1e-6 for r in POOL_REGIONS)


def with_props(tool="claw", rings=1, fish=0, **kw):
    import rov_props
    kw.setdefault("buoyancy", 0.0)                  # neutral, so a ROV stays at the depth the test puts it at
    r = Rov(tool=tool, **kw)
    rov_props.add_to(r, rings)
    if fish:
        import rov_fish
        rov_fish.add_to(r, fish)
    return r


def rings_of(r):
    return [p for p in r.props if p.type == "ring"]


# ------------------------------------------------------------------ the pool
def test_pool_random_driving_stays_inside():
    """Random driving at every depth and buoyancy: the footprint never leaves the pool or passes any floor."""
    random.seed(1)
    worst_out = worst_floor = 0.0
    for _ in range(25):
        r = Rov(buoyancy=random.choice([0.0, -1.5, 1.5]))
        r.depth = random.uniform(0.3, 1.7)
        r.x, r.y, r.yaw = random.uniform(-2.5, 2.5), random.uniform(-1, 1), random.uniform(0, 6.28)
        for i in range(60 * 20):
            if i % 80 == 0:
                for k in ("t1", "t2", "t3", "t4"):
                    r.set_cmd(k, random.uniform(-1, 1))
            r.step(DT)
            c, s = math.cos(r.yaw), math.sin(r.yaw)
            for wx, wy in r._footprint(c, s):
                if not inside_pool(wx, wy):
                    qx, qy = nearest_in(POOL_REGIONS, wx, wy)
                    worst_out = max(worst_out, math.hypot(qx - wx, qy - wy))
                f = floor_under(wx, wy)
                if f is not None:
                    worst_floor = max(worst_floor, r.depth + ROV_BOTTOM - f)
    assert worst_out < 1e-6, f"left the pool by {worst_out:.4f} m"
    assert worst_floor < 1e-6, f"went through a floor by {worst_floor:.4f} m"


def test_pool_step_is_a_wall_to_a_deep_rov():
    r = Rov(buoyancy=0.0)
    r.depth, r.x, r.y, r.yaw = 1.5, 1.5, 0.0, math.pi / 2
    run(r, 6, t1=1, t2=1)
    assert r.y + 0.6 <= 1.5 + 1e-6, f"tool tip got over the step (y={r.y + 0.6:.2f})"
    assert abs(r.depth - 1.5) < 1e-6, "touching the step changed the depth"


def test_pool_shallow_rov_passes_and_rests_on_shelf():
    r = Rov(buoyancy=0.0)
    r.depth, r.x, r.y, r.yaw = 0.5, 1.5, 0.0, math.pi / 2
    run(r, 3, t1=1, t2=1)
    run(r, 3)
    assert r.y > 2.0, "a shallow ROV could not get onto the shelf"
    run(r, 6, t3=-1, t4=-1)
    assert abs(r.depth - 0.72) < 0.01 and r.y > 2.0, f"diving over the shelf ended at depth {r.depth:.2f}, y {r.y:.2f}"


def test_pool_no_upward_jump_from_any_legal_pose():
    """Sweep many legal poses: with no thrust and no buoyancy a step never moves the ROV UP (the 'bounce' bug)."""
    bad = 0
    for ix in range(-29, 30, 2):
        for iy in range(-14, 40, 2):
            x, y = ix * 0.1, iy * 0.1
            if floor_at(x, y) is None:
                continue
            for k in range(8):
                yaw = k * math.pi / 4
                for depth in (0.3, 0.6, 0.9, 1.4, 1.7):
                    pre = Rov(buoyancy=0.0)
                    pre.x, pre.y, pre.yaw, pre.depth = x, y, yaw, depth
                    pre._walls(math.cos(yaw), math.sin(yaw), depth)
                    if abs(pre.x - x) > 1e-9 or abs(pre.y - y) > 1e-9:
                        continue                                  # not a legal starting pose
                    r = Rov(buoyancy=0.0)
                    r.x, r.y, r.yaw, r.depth, r.u = x, y, yaw, depth, 0.8
                    r.step(DT)
                    if r.depth < depth - 1e-6:
                        bad += 1
    assert bad == 0, f"{bad} poses where a step moved the ROV up with no thrust"


# ------------------------------------------------------------------ rings: bumping
def test_ring_is_pushed_not_passed_through():
    r = with_props("claw")
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = -0.3, 0.0, 0.0, 1.6
    ring.x, ring.y, ring.yaw = 0.9, 0.0, math.pi / 2
    run(r, 3, t1=0.6, t2=0.6)
    assert ring.x > 1.5 and ring.x > r.x, f"ring ended at x={ring.x:.2f} with the ROV at {r.x:.2f}"


def test_ring_corner_catch_spins_the_right_way():
    turns = []
    for side in (+1, -1):
        r = with_props("claw")
        ring = rings_of(r)[0]
        r.x, r.y, r.yaw, r.depth = -0.3, 0.0, 0.0, 1.55
        ring.x, ring.y, ring.yaw = 1.0, 0.36 * side, math.pi / 2
        y0 = ring.yaw
        run(r, 3.5, t1=0.5, t2=0.5)
        turns.append(ring.yaw - y0)
    assert abs(turns[0]) > 0.3 and abs(turns[1]) > 0.3, f"turns {turns}"
    assert turns[0] * turns[1] < 0, "mirrored hits should spin the ring in opposite directions"


def test_ring_nose_through_hole_is_not_a_collision():
    r = with_props("nose")
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = -0.3, 0.0, 0.0, 1.55
    ring.x, ring.y, ring.yaw = 0.9, 0.0, math.pi / 2
    for _ in range(int(0.9 / DT)):                       # until the nose tip is just through the hole
        r.set_cmd("t1", 0.4); r.set_cmd("t2", 0.4); r.step(DT)
    assert abs(ring.x - 0.9) < 0.01 and abs(ring.y) < 0.01, "a nose passing cleanly through the hole moved the ring"


def test_ring_coasts_then_stops():
    r = with_props("claw")
    ring = rings_of(r)[0]
    r.x, r.y = -2.5, -1.0
    ring.x, ring.y, ring.vx = 0.0, 0.0, 1.0
    for _ in range(60 * 3):
        r.step(DT)
    d3 = ring.x
    for _ in range(60 * 2):
        r.step(DT)
    assert 0.1 < d3 < 0.5 and abs(ring.x - d3) < 0.01, f"coasted {d3:.2f} m then moved {ring.x - d3:.3f} m more"


def test_ring_cannot_be_pushed_through_a_wall():
    r = with_props("claw")
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = 1.5, 0.0, 0.0, 1.6
    ring.x, ring.y = 2.4, 0.0
    run(r, 5, t1=0.9, t2=0.9)
    assert ring.x + ring.R <= 3.0 + 1e-6 and r.x < 3.0, f"ring x {ring.x:.2f}, ROV x {r.x:.2f}"


def test_ring_nothing_ends_up_inside_the_rov():
    r = with_props("claw")
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = -0.3, 0.0, 0.0, 1.55
    ring.x, ring.y, ring.yaw = 0.9, 0.0, 0.0
    run(r, 3, t1=1.0, t2=1.0)
    closest = min(rov_shape.distance_to_rov(r, p)[0] for p in ring._hoop())
    assert closest > ring.TUBE - 0.005, f"ring overlaps the ROV by {(ring.TUBE - closest) * 100:.1f} cm"


def test_rings_do_not_overlap_each_other():
    r = with_props("claw", rings=2)
    a, b = rings_of(r)
    a.x, a.y, b.x, b.y = 0.0, 0.0, 0.03, 0.0
    a.yaw = b.yaw = math.pi / 2
    r.x, r.y = -2.5, -1.0
    for _ in range(120):
        r.step(DT)
    assert math.dist((a.x, a.y), (b.x, b.y)) > 0.039, "rings still overlap"


# ------------------------------------------------------------------ rings: picking up
def test_ring_nose_lift_and_carry():
    r = with_props("nose", buoyancy=0.0)
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = ring.x - 0.60, ring.y, 0.0, 1.55
    run(r, 0.9, t1=.5, t2=.5)
    run(r, 0.5)
    assert ring.hooked, "nose did not hook the ring"
    run(r, 2.0, t3=0.7, t4=0.7)
    assert ring.hooked and ring.depth < 1.3, f"ring did not lift (depth {ring.depth:.2f})"
    assert 0.07 < r.pitch < 0.14, f"ROV did not tilt under the ring ({math.degrees(r.pitch):.1f} deg)"
    run(r, 1.5, t1=0.5, t2=0.5)
    assert ring.hooked, "ring came off while being carried"


def test_ring_stays_on_the_nose_through_manoeuvres():
    """Picking a ring up and then driving about (reversing, turning, diving) must not make it slide off the tip."""
    random.seed(4)
    for trial in range(6):
        r = with_props("nose")                                  # defaults, including the positive buoyancy
        ring = rings_of(r)[0]
        r.x, r.y, r.yaw = -1.5, 0.0, 0.0

        def hold(target, extra=None):
            v = max(-1, min(1, -1.8 * (target - r.depth) - 0.6 * r.w - 0.15))
            r.set_cmd("t3", v); r.set_cmd("t4", v)
            for k, val in (extra or {}).items():
                r.set_cmd(k, val)
            r.step(DT)
        for _ in range(60 * 8):
            hold(1.62)
        while not ring.hooked and r.x < 2.0:
            hold(1.62, {"t1": 0.5, "t2": 0.5})
        for _ in range(30):
            hold(1.62)
        assert ring.hooked, f"trial {trial}: never hooked"
        for _ in range(60 * 3):
            r.set_cmd("t3", 0.8); r.set_cmd("t4", 0.8); r.step(DT)
        for i in range(60 * 30):
            if i % 90 == 0:
                cmds = {"t1": random.uniform(-.6, .6), "t2": random.uniform(-.6, .6),
                        "t3": random.uniform(-0.2, 0.7), "t4": random.uniform(-0.2, 0.7)}
            for k, v in cmds.items():
                r.set_cmd(k, v)
            r.step(DT)
            assert ring.hooked, f"trial {trial}: the ring slid off the nose after {i / 60:.0f} s of manoeuvring"


def test_ring_claw_grab_hold_release():
    r = with_props("claw", buoyancy=0.0)
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = -1.0, 0.0, 0.0, 1.5
    ring.x, ring.y, ring.depth = r.x + 0.5, r.y - ring.R, r.depth + 0.25
    r.claw = r.claw_target = 1.0
    for _ in range(20):
        r.step(DT)
    r.claw_target = 0.0
    for _ in range(60):
        r.step(DT)
    assert ring.held and r.claw_holder is ring, "claw did not grip the ring"
    run(r, 3, t3=0.6, t4=0.6)
    assert ring.held and ring.depth < 1.0, "ring did not come up with the ROV"
    r.claw_target = 1.0
    for _ in range(30):
        r.step(DT)
    assert not ring.held and r.claw_holder is None, "claw did not let go"


def test_ring_claw_holds_only_one():
    r = with_props("claw", rings=2, buoyancy=0.0)
    a, b = rings_of(r)
    r.x, r.y, r.yaw, r.depth = -1.0, 0.0, 0.0, 1.5
    for ring in (a, b):
        ring.x, ring.y, ring.yaw, ring.depth = r.x + 0.5, r.y - ring.R, math.pi / 2, r.depth + 0.25
    r.claw = r.claw_target = 1.0
    for _ in range(20):
        r.step(DT)
    r.claw_target = 0.0
    for _ in range(60):
        r.step(DT)
    assert [a.held, b.held].count(True) == 1, f"held: {[a.held, b.held]}"


def test_ring_carried_to_the_shallow_end():
    r = with_props("nose", buoyancy=0.0)
    ring = rings_of(r)[0]
    r.x, r.y, r.yaw, r.depth = 1.8, -0.2, math.pi / 2, 1.55
    ring.x, ring.y, ring.yaw = 1.8, 0.4, 0.0
    run(r, 0.9, t1=.5, t2=.5)
    run(r, 0.5)
    run(r, 2.2, t3=0.7, t4=0.7)
    run(r, 1.0)
    run(r, 6.0, t1=0.5, t2=0.5)
    run(r, 1.0)
    assert ring.hooked and ring.y > 1.7, f"ring not carried over the step (y={ring.y:.2f}, hooked={ring.hooked})"
    run(r, 3.0, t3=-0.4, t4=-0.4)
    run(r, 1.5)
    run(r, 2.5, t1=-0.6, t2=-0.6)
    assert not ring.hooked and abs(ring.depth - (1.0 - ring.R - ring.TUBE)) < 0.02, f"ring depth {ring.depth:.2f}"


# ------------------------------------------------------------------ the fish
def chase(r, fish, seconds, speed=1.0):
    """Autopilot: steer straight at the fish at full thrust, matching its depth. Returns the closest gap seen."""
    closest = 99.0
    for i in range(int(seconds / DT)):
        bearing = math.atan2(fish.y - r.y, fish.x - r.x)
        err = (bearing - r.yaw + math.pi) % (2 * math.pi) - math.pi
        r.set_cmd("t1", max(-1, min(1, speed - 1.5 * err)))
        r.set_cmd("t2", max(-1, min(1, speed + 1.5 * err)))
        v = -max(-1, min(1, 2.0 * (fish.depth - r.depth)))
        r.set_cmd("t3", v)
        r.set_cmd("t4", v)
        r.step(DT)
        closest = min(closest, fish.gap)
        assert inside_pool(fish.x, fish.y), f"fish left the pool at ({fish.x:.2f}, {fish.y:.2f})"
        assert 0.0 <= fish.depth <= (floor_under(fish.x, fish.y) or 0) + 1e-6, f"fish depth {fish.depth:.2f} outside the water"
    return closest


def test_fish_is_never_caught():
    """An autopilot chases the fish flat out for minutes: the fish must never get within SAFE_HARD of the ROV."""
    import rov_fish
    worst, darts = 99.0, 0
    for seed in range(4):
        r = with_props("claw", rings=0, fish=1, buoyancy=0.0)
        fish = [p for p in r.props if p.type == "fish"][0]
        fish.seed = 100 + seed
        fish.reset()
        r.depth = 0.9
        closest = chase(r, fish, 120)
        worst = min(worst, closest)
        darts += fish.darts
    assert worst >= rov_fish.Fish.SAFE_HARD - 0.03, f"the ROV got within {worst * 100:.0f} cm of the fish"
    assert darts <= 40, f"the fish had to dart {darts} times in 8 minutes of relentless chasing"
    print(f"        (closest approach in 8 minutes of chasing: {worst * 100:.0f} cm; fish had to dart {darts} times)")


def corner_distance(x, y):
    return min(math.hypot(x - cx, y - cy) for r in POOL_REGIONS for cx in (r[0], r[1]) for cy in (r[2], r[3]))


def test_fish_does_not_get_stuck_in_corners():
    """While being chased the fish should use the open water: little time in corners, never pinned against a wall."""
    near = steps = 0
    longest_stuck = still = 0
    for seed in (11, 18, 25):
        r = with_props("claw", rings=0, fish=1, buoyancy=0.0)
        fish = [p for p in r.props if p.type == "fish"][0]
        fish.seed = seed
        fish.reset()
        r.x, r.y, r.depth = -2.5, -1.0, 1.0
        last = (fish.x, fish.y, fish.depth)
        for _ in range(60 * 80):
            bearing = math.atan2(fish.y - r.y, fish.x - r.x)
            err = (bearing - r.yaw + math.pi) % (2 * math.pi) - math.pi
            r.set_cmd("t1", max(-1, min(1, 1 - 1.5 * err)))
            r.set_cmd("t2", max(-1, min(1, 1 + 1.5 * err)))
            v = -max(-1, min(1, 2.0 * (fish.depth - r.depth)))
            r.set_cmd("t3", v); r.set_cmd("t4", v)
            r.step(DT)
            steps += 1
            near += corner_distance(fish.x, fish.y) < 0.8
            moved = math.dist((fish.x, fish.y, fish.depth), last)
            last = (fish.x, fish.y, fish.depth)
            still = still + 1 if (fish.speed > 1.0 and moved < 0.005) else 0     # "swimming hard" but going nowhere
            longest_stuck = max(longest_stuck, still)
    assert near / steps < 0.20, f"{near / steps * 100:.0f}% of the time in a corner"
    assert longest_stuck < 60, f"pressed against a wall for {longest_stuck / 60:.1f} s"


def test_fish_peeks_at_a_still_rov_and_stays_wary_of_a_moving_one():
    import rov_fish, rov_shape
    r = with_props("claw", rings=0, fish=1, buoyancy=0.0)
    fish = [p for p in r.props if p.type == "fish"][0]
    r.x, r.y, r.depth, r.yaw = -2.0, 0.0, 1.0, 0.0
    fish.x, fish.y, fish.depth = 1.0, 0.5, 1.0
    peek_steps, closest_lens, worst_gap = 0, 99.0, 99.0
    for _ in range(60 * 150):
        r.step(DT)
        peek_steps += fish.mode == "peek"
        cx, cy, cu = rov_shape.local_to_world(r, *rov_shape.CAM_POS)
        closest_lens = min(closest_lens, math.dist((cx, cy, cu), (fish.x, fish.y, -fish.depth)))
        worst_gap = min(worst_gap, fish.gap)
    assert peek_steps > 60 * 20, f"only {peek_steps / 60:.0f} s peeking at a ROV that sat still for 2.5 minutes"
    assert closest_lens < 1.1, f"never came within {closest_lens:.2f} m of the camera"
    assert worst_gap >= rov_fish.Fish.SAFE_HARD - 0.03, f"got within {worst_gap * 100:.0f} cm of the ROV"
    # now the ROV starts moving: the trust must go, and the fish must get out of the way
    for _ in range(60 * 10):
        bearing = math.atan2(fish.y - r.y, fish.x - r.x)
        err = (bearing - r.yaw + math.pi) % (2 * math.pi) - math.pi
        r.set_cmd("t1", max(-1, min(1, 1 - 1.5 * err))); r.set_cmd("t2", max(-1, min(1, 1 + 1.5 * err)))
        r.step(DT)
        worst_gap = min(worst_gap, fish.gap)
    assert not fish.trusting, "the fish still trusted a ROV that is chasing it"
    assert worst_gap >= rov_fish.Fish.SAFE_HARD - 0.03, f"the moving ROV got within {worst_gap * 100:.0f} cm"


def test_fish_peeks_promptly_at_a_default_rov_floating_at_the_surface():
    """The default ROV is positively buoyant, so it floats up and sits at the surface: the fish must still come to look."""
    import rov_shape
    results = []
    for seed in (11, 25, 39):
        r = Rov(tool="claw")                                    # ALL defaults (buoyancy +1.5 N)
        import rov_props, rov_fish
        rov_props.add_to(r, 3)
        rov_fish.add_to(r, 1)
        fish = [p for p in r.props if p.type == "fish"][0]
        fish.seed = seed
        fish.reset()
        r.x, r.y, r.depth, r.yaw = -1.5, 0.0, 0.8, 0.0
        first, peek, spooked, prev, near = None, 0, 0, None, 0
        for i in range(60 * 150):
            r.step(DT)
            if fish.mode == "peek":
                peek += 1
                first = i / 60 if first is None else first
                cx, cy, cu = rov_shape.local_to_world(r, *rov_shape.CAM_POS)
                near += math.dist((cx, cy, cu), (fish.x, fish.y, -fish.depth)) < 1.1
            spooked += prev == "peek" and fish.mode == "flee"
            prev = fish.mode
        results.append((first, peek / 60, spooked, near / 60))
        assert first is not None and first < 30, f"seed {seed}: first peek only at {first}"
        assert peek > 60 * 40, f"seed {seed}: peeked for only {peek / 60:.0f} s of 150"
        assert near > 60 * 8, f"seed {seed}: within 1.1 m of the lens for only {near / 60:.0f} s"
        assert spooked <= 3, f"seed {seed}: spooked itself {spooked} times"
    print("        (first peek, seconds peeking, times it spooked itself, seconds close to the lens):", [tuple(round(x, 1) if x is not None else None for x in rr) for rr in results])


def test_two_rings_on_the_nose_tilt_twice_as_much():
    r = with_props("nose", rings=2, buoyancy=0.0)
    a, b = rings_of(r)
    a.x, a.y, a.yaw = 0.8, 0.0, math.pi / 2
    b.x, b.y, b.yaw = 1.5, 0.0, math.pi / 2
    r.x, r.y, r.yaw, r.depth = -1.5, 0.0, 0.0, 1.62
    def hold(extra):
        v = max(-1, min(1, -1.8 * (1.62 - r.depth) - 0.6 * r.w))
        r.set_cmd("t3", v); r.set_cmd("t4", v)
        for k, val in extra.items():
            r.set_cmd(k, val)
        r.step(DT)
    for _ in range(60 * 3):
        hold({})
    for _ in range(60 * 5):
        hold({"t1": 0.4, "t2": 0.4})
    assert a.hooked and b.hooked, f"hooked: {a.hooked}, {b.hooked}"
    for _ in range(60 * 3):
        r.set_cmd("t1", 0); r.set_cmd("t2", 0); r.set_cmd("t3", 0.8); r.set_cmd("t4", 0.8); r.step(DT)
    for _ in range(60):
        r.step(DT)
    assert a.lifting and b.lifting, "the nose should be carrying both rings"
    assert 0.17 < r.pitch < 0.26, f"two rings should tilt about 11 degrees, got {math.degrees(r.pitch):.1f}"


def test_fish_threads_the_rings_now_and_then():
    r = with_props("claw", rings=3, fish=1, buoyancy=0.0)
    fish = [p for p in r.props if p.type == "fish"][0]
    r.x, r.y, r.depth, r.yaw = -2.5, -1.0, 1.0, 0.0
    through, side = 0, {}
    for _ in range(60 * 600):
        r.step(DT)
        for ring in rings_of(r):
            nx, ny = -math.sin(ring.yaw), math.cos(ring.yaw)
            s_now = (fish.x - ring.x) * nx + (fish.y - ring.y) * ny
            in_hole = math.hypot((fish.x - ring.x) * math.cos(ring.yaw) + (fish.y - ring.y) * math.sin(ring.yaw),
                                 fish.depth - ring.depth) < ring.R - ring.TUBE
            if id(ring) in side and side[id(ring)] * s_now < 0 and in_hole:
                through += 1
            side[id(ring)] = s_now
    assert through >= 3, f"swam through a ring only {through} times in 10 minutes"


def test_fish_respects_the_step():
    """A fish that is deeper than the shallow end never ends up over its shelf."""
    r = with_props("claw", rings=0, fish=1)
    fish = [p for p in r.props if p.type == "fish"][0]
    r.x, r.y = -2.5, -1.0
    over_shelf_deep = 0
    for _ in range(60 * 120):
        r.step(DT)
        if fish.y > 1.55 and fish.depth > 0.75:
            over_shelf_deep += 1
    assert over_shelf_deep == 0, f"fish was deeper than the shallow end's floor allows on {over_shelf_deep} steps"


def test_fish_wanders_and_swims_at_sane_speeds():
    r = with_props("claw", rings=0, fish=1)
    fish = [p for p in r.props if p.type == "fish"][0]
    r.x, r.y = -2.5, -1.0
    xs, ys, speeds = [], [], []
    for _ in range(60 * 60):
        r.step(DT)
        xs.append(fish.x); ys.append(fish.y); speeds.append(fish.speed)
    assert max(xs) - min(xs) > 1.0 or max(ys) - min(ys) > 1.0, "the fish barely moved in a minute"
    assert max(speeds) < 2.0, f"fish speed reached {max(speeds):.1f} m/s"


# ------------------------------------------------------------------ speed
def test_speed_with_everything_on():
    r = with_props("claw", rings=3, fish=1)
    r.x, r.y, r.yaw, r.depth = -0.3, 0.0, 0.0, 1.6
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
        except Exception as e:                      # a crash is a failure too
            failed += 1
            print(f"ERROR {name}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed} of {len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
