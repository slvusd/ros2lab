# =============================================================================
# rov_shape.py — the ROV's physical shape, for collisions. NO ROS in here.
# =============================================================================
# Every solid part of the ROV is described as a CAPSULE: a line segment with a radius (a pipe, a thruster
# body, a claw jaw). That is close enough to detect "that pipe touched the ring" without a real physics engine.
# The pool ring, the fish and anything else added later can all test against capsules(rov).
#
# It mirrors the 3D model in web/app.js (pipes, thrusters, the claw or the nose), which is purely for show:
# if you change the look of the ROV, update the numbers here to match.
#
# Axes, as everywhere: x forward, y LEFT, up = z. A point in the ROV's own frame is (fx, ly, uz).
# Pitch (nose-down positive) tilts the whole shape about the ROV's centre.
# =============================================================================
import math

H = 0.25                                   # half the cube side: the frame pipes run along +-H
PIPE_R = 0.014                             # PVC pipe radius

# --- the nose: a polyline from the front bottom bar, (forward, up) in the ROV frame ---
NOSE_PTS = [(0.25, -0.25), (0.35, -0.25), (0.43, -0.238), (0.485, -0.195)]
NOSE_R = 0.016

# --- the claw: two jaws hinged on the front bottom bar ---
JAW_X0 = 0.42                              # the hinges are this far ahead of the ROV's centre
JAW_Y0 = 0.03                              # and this far to the left / right of the centreline
JAW_HALF = 0.0125                          # half a jaw's thickness
JAW_LEN, TIP_LEN, TIP_BEND = 0.14, 0.055, 0.55
JAW_SWING = 0.7                            # radians each jaw swings outward when the claw is fully open
JAW_Z = -0.25                              # the claw rides on the bottom bar


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _clamp01(v):
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def seg_seg(p1, q1, p2, q2):
    """Closest points between segments p1-q1 and p2-q2: returns (point on 1, point on 2, distance)."""
    d1, d2, r = _sub(q1, p1), _sub(q2, p2), _sub(p1, p2)
    a, e, f = _dot(d1, d1), _dot(d2, d2), _dot(d2, r)
    if a <= 1e-12 and e <= 1e-12:
        s = t = 0.0
    elif a <= 1e-12:
        s, t = 0.0, _clamp01(f / e)
    else:
        c = _dot(d1, r)
        if e <= 1e-12:
            t, s = 0.0, _clamp01(-c / a)
        else:
            b = _dot(d1, d2)
            denom = a * e - b * b
            s = _clamp01((b * f - c * e) / denom) if denom > 1e-12 else 0.0
            t = (b * s + f) / e
            if t < 0.0:
                t, s = 0.0, _clamp01(-c / a)
            elif t > 1.0:
                t, s = 1.0, _clamp01((b - c) / a)
    c1 = (p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s)
    c2 = (p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t)
    d = _sub(c1, c2)
    return c1, c2, math.sqrt(_dot(d, d))


def point_seg(p, a, b):
    """Closest point on segment a-b to point p: returns (point, distance)."""
    ab, ap = _sub(b, a), _sub(p, a)
    L2 = _dot(ab, ab)
    t = _clamp01(_dot(ap, ab) / L2) if L2 > 1e-12 else 0.0
    q = (a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t)
    d = _sub(p, q)
    return q, math.sqrt(_dot(d, d))


def local_to_world(rov, fx, ly, uz):
    """A point in the ROV's own frame (fx ahead, ly left, uz up of its centre) as a world (x, y, up), allowing for yaw and pitch."""
    cy, sy = math.cos(rov.yaw), math.sin(rov.yaw)
    cp, sp = math.cos(rov.pitch), math.sin(rov.pitch)
    fx2, uz2 = fx * cp + uz * sp, -fx * sp + uz * cp
    return (rov.x + cy * fx2 - sy * ly, rov.y + sy * fx2 + cy * ly, -rov.depth + uz2)


# the ROV camera (see web/app.js): top front, looking forward and down
CAM_POS = (0.23, 0.0, 0.20)
CAM_TILT = 0.5                             # radians below the ROV's forward direction


def capsules(rov):
    """The ROV's solid parts in WORLD coordinates, as (a, b, radius, tag): a and b are (x, y, up) end points.
    tag is "frame", "thruster", "nose" or "claw" so callers can ignore the parts that are meant to touch something
    (the nose hooking a ring, the jaws gripping one)."""
    key = (rov.x, rov.y, rov.depth, rov.yaw, rov.pitch, rov.claw, rov.tool, rov.thrusters)
    cached = getattr(rov, "_shape_cache", None)
    if cached and cached[0] == key:
        return cached[1]
    cy, sy = math.cos(rov.yaw), math.sin(rov.yaw)
    cp, sp = math.cos(rov.pitch), math.sin(rov.pitch)
    base_up = -rov.depth

    def W(fx, ly, uz):                                   # ROV frame -> world
        fx2, uz2 = fx * cp + uz * sp, -fx * sp + uz * cp
        return (rov.x + cy * fx2 - sy * ly, rov.y + sy * fx2 + cy * ly, base_up + uz2)

    out = []

    def add(a, b, r, tag):
        out.append((W(*a), W(*b), r, tag))

    for s1 in (-1, 1):                                   # the 12 pipes of the cube
        for s2 in (-1, 1):
            add((-H, s1 * H, s2 * H), (H, s1 * H, s2 * H), PIPE_R, "frame")      # along x
            add((s1 * H, -H, s2 * H), (s1 * H, H, s2 * H), PIPE_R, "frame")      # along y
            add((s1 * H, s2 * H, -H), (s1 * H, s2 * H, H), PIPE_R, "frame")      # vertical
    for sgn in (-1, 1):
        add((-H, sgn * H, 0), (H, sgn * H, 0), PIPE_R, "frame")                  # the side rails
    add((0.15, 0, H - 0.05), (0.21, 0, H - 0.05), 0.026, "frame")             # the camera housing, top front
    add((0, -H, -H), (0, H, -H), PIPE_R, "frame")                                # bottom crossbars
    add((-H, 0, -H), (H, 0, -H), PIPE_R, "frame")

    # the thrusters, from the layout (rov_physics.THRUSTER_LAYOUTS): a horizontal one is a body and a rear shroud along its direction, a vertical one is
    # a body, a shroud and a propeller. (Horizontal ones in the order of their gy, then gx: for the original layout that is the order this file always had.)
    layout = getattr(rov, "layout", None) or []
    for th in sorted((t for t in layout if t["kind"] == "h"), key=lambda t: (t["gy"], t["gx"])):
        gx, gy, dx, dy = th["gx"], th["gy"], th["dx"], th["dy"]
        add((gx - dx * 0.065, gy - dy * 0.065, 0), (gx + dx * 0.065, gy + dy * 0.065, 0), 0.036, "thruster")
        add((gx - dx * 0.075, gy - dy * 0.075, 0), (gx - dx * 0.06, gy - dy * 0.06, 0), 0.053, "thruster")
    for th in (t for t in layout if t["kind"] == "v"):
        gx, gy = th["gx"], th["gy"]
        add((gx, gy, -0.215), (gx, gy, -0.085), 0.036, "thruster")
        add((gx, gy, -0.09), (gx, gy, -0.07), 0.056, "thruster")
        add((gx, gy, -0.078), (gx, gy, -0.072), 0.08, "thruster")

    if rov.tool == "nose":
        pts = NOSE_PTS
        for (f0, u0), (f1, u1) in zip(pts, pts[1:]):
            add((f0, 0, u0), (f1, 0, u1), NOSE_R, "nose")
        add((pts[-1][0], 0, pts[-1][1]), (pts[-1][0], 0, pts[-1][1]), 0.02, "nose")       # the ball at the tip
    else:
        add((0.25, 0, JAW_Z), (0.37, 0, JAW_Z), 0.013, "claw")                            # arm
        add((0.37, 0, JAW_Z), (0.42, 0, JAW_Z), 0.03, "claw")                             # palm
        th = JAW_SWING * rov.claw
        for sgn in (1, -1):                              # +1 = left jaw, -1 = right jaw
            hinge = (JAW_X0, sgn * JAW_Y0, JAW_Z)
            end1 = (hinge[0] + JAW_LEN * math.cos(th), hinge[1] + sgn * JAW_LEN * math.sin(th), JAW_Z)
            end2 = (end1[0] + TIP_LEN * math.cos(th - TIP_BEND), end1[1] + sgn * TIP_LEN * math.sin(th - TIP_BEND), JAW_Z)
            add(hinge, end1, JAW_HALF, "claw")
            add(end1, end2, JAW_HALF, "claw")

    rov._shape_cache = (key, out)
    return out


def distance_to_rov(rov, p):
    """Shortest distance from a world point to the ROV's surface (negative inside it), and the nearest point."""
    best = (1e9, None)
    for a, b, r, _tag in capsules(rov):
        q, d = point_seg(p, a, b)
        if d - r < best[0]:
            best = (d - r, q)
    return best
