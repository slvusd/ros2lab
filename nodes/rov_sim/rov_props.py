# =============================================================================
# rov_props.py — OPTIONAL extras in the pool: weighted rings to pick up and push around
# =============================================================================
# This whole file is an add-on. To remove it completely:
#   1. delete this file and web/props.js
#   2. (optional) delete the small "try: import rov_props" blocks in rov_sim.py and
#      keyboard_sim.py — they already skip quietly when this file is missing.
# The core code only knows "a prop has reset(), step(rov, dt), state()".
#
# THE RINGS: slightly buoyant hoops with a weight on their bottom edge, so each stands upright on the pool
# floor. (There are three by default; `rings` / --rings sets how many.) Ways to deal with a ring:
#
#   NOSE tool: drive the nose THROUGH the ring, then rise. The top of the nose meets the ring's inner rim and
#     carries it up; the ring hangs from the nose (its weighted edge swinging down, turning with the ROV).
#     Lower it to the floor and back out to leave it. Several rings can hang on the nose at once.
#   CLAW tool: open the claw and put the jaws around the rim's SIDE (a vertical bit of tube, anywhere
#     between the jaw hinges and the fingertips), then command the claw closed. It grips at once and
#     the jaws stop at the tube's thickness. Command the claw open again (above ~1/4) to let go. The claw
#     holds one ring at a time. (The HUD says "ring between jaws" when it is in position.)
#   BUMPING: every solid part of the ROV (pipes, thrusters, jaws, nose; see rov_shape.py) collides with the
#     rings. A ring that is touched is pushed along, spun by WHERE it was hit, and coasts to a stop in the
#     water; rings also push each other. The part that is hooking or gripping a ring doesn't push it.
#
# Game-style physics, not a full solver: contacts are capsule-to-capsule overlap tests, resolved by moving
# the (light) ring out of the way; the ROV is not slowed by what it pushes.
# =============================================================================
import math
import random

import rov_shape
from rov_physics import POOL_MAX_DEPTH, POOL_REGIONS, clamp, floor_at, nearest_in
from rov_shape import seg_seg


def wrap_half_pi(a):
    """Angle difference wrapped into (-pi/2, pi/2]: a ring looks the same turned by 180 degrees."""
    return (a + math.pi / 2) % math.pi - math.pi / 2


class Ring:
    type = "ring"
    R, TUBE = 0.14, 0.02          # hoop radius and tube radius (m)
    SINK = 0.15                   # m/s: how fast it falls once nothing holds it up
    TORQUE_HANGING, TORQUE_HELD = 1.7, 1.2        # N m of nose-down torque from the ring's weight out front
                                                  # (about 6 / 4 degrees of tilt; the front/rear thrusters can cancel it)

    # --- nose (shared with the collision shape) ---
    NOSE = rov_shape.NOSE_PTS
    NOSE_R = rov_shape.NOSE_R
    SLIDE = (0.31, 0.40)          # a hanging ring rests on the nose's low part, this far ahead of the ROV centre. (The nose reaches
                                  # 0.485 m, but tilting nose-down under the ring shortens that to ~0.46: keep clear of the tip)
    # --- claw (shared with the collision shape): hinged at JAW_X0 ahead of the centre, on the bottom bar ---
    JAW_X0, JAW_X1 = rov_shape.JAW_X0, 0.60   # the jaws cover this stretch ahead of the ROV centre
    JAW_Y0, JAW_HALF = rov_shape.JAW_Y0, rov_shape.JAW_HALF
    JAW_SWING = rov_shape.JAW_SWING
    JAW_Z, JAW_ZTOL = rov_shape.JAW_Z, 0.035  # jaw height relative to the ROV centre, and how far off a tube can be vertically
    CLAMP_COMMAND = 0.25          # a claw command at or below this means "squeeze"; above it, "open"
    HOLD_OPEN = 0.10              # jaws can't close past the tube's thickness
    # --- being bumped ---
    N_HOOP = 16                   # the hoop is checked as this many straight pieces
    SPIN = 0.9                    # how strongly an off-centre push turns the ring
    COAST_DRAG, SPIN_DRAG = 4.0, 5.0     # 1/s: how fast a pushed ring slows down in the water

    def __init__(self, x=0.8, y=0.0, yaw=math.pi / 2, color=0xff6a00, others=None):
        self.start = (x, y, yaw)
        self.color = color         # shown on the page
        self.others = others if others is not None else []     # the other rings, so they don't overlap
        self.reset()

    def _footprint(self):
        """The hoop stands in a vertical plane, so from above it is a line: its two ends and its middle."""
        ex, ey = math.cos(self.yaw) * self.R, math.sin(self.yaw) * self.R
        return [(self.x + ex, self.y + ey), (self.x - ex, self.y - ey), (self.x, self.y)]

    @property
    def floor(self):
        """Centre depth when standing on the floor right here: the shallowest floor under any part of the hoop
        (the shallow end is shallower)."""
        fl = [floor_at(x, y) for x, y in self._footprint()]
        fl = [f for f in fl if f is not None] or [POOL_MAX_DEPTH]
        return min(fl) - self.R - self.TUBE

    def reset(self):
        self.x, self.y, self.yaw = self.start
        self.vx = self.vy = self.wz = 0.0      # coasting after a push (m/s, m/s, rad/s)
        self.depth = self.floor
        self.held = False          # gripped by the claw
        self.hooked = False        # hanging on the nose
        self.lifting = False       # the nose is actually carrying the ring's weight
        self.in_jaws = False       # a piece of the hoop is between the open jaws (close the claw to grab it)
        self.prev_claw = 0.0
        self.rel = (0.0, 0.0, 0.0, 0.0)    # ring pose in the ROV's frame while held by the claw

    # ------------------------------------------------------------------ per-step
    def step(self, rov, dt):
        c, s = math.cos(rov.yaw), math.sin(rov.yaw)
        if rov.tool != "nose":
            self.hooked = False
        self.lifting = False
        self.in_jaws = False
        if rov.tool != "claw" and self.held:      # switched tools while holding: let go
            self._let_go(rov)

        if self.held:
            self._follow_claw(rov, c, s)
            if self.held:
                rov.claw_floor = self.HOLD_OPEN                    # the jaws can't squeeze through the tube
                rov.pitch_torque += self.TORQUE_HELD
        else:
            self.in_jaws = rov.tool == "claw" and rov.claw_holder is None and self._between_jaws(rov, c, s)
            self.depth = min(self.floor, self.depth + self.SINK * dt)      # gravity
            if rov.tool == "nose":
                self._nose(rov, c, s, dt)
            elif (self.in_jaws and rov.claw_target <= self.CLAMP_COMMAND and rov.claw < self.prev_claw - 1e-4):
                self.held = True       # the claw is closing with a piece of the hoop between the jaws
                rov.claw_holder = self
                rov.claw_floor = self.HOLD_OPEN
                self.vx = self.vy = self.wz = 0.0
                dx, dy = self.x - rov.x, self.y - rov.y
                self.rel = (c * dx + s * dy, -s * dx + c * dy,
                            -self.depth + rov.depth, self.yaw - rov.yaw)
        if self.lifting:
            rov.pitch_torque += self.TORQUE_HANGING
        self.prev_claw = rov.claw

        if self.held or self.hooked:
            self.vx = self.vy = self.wz = 0.0
        else:
            self._coast(dt)
        if not self.held:
            self._collide(rov, dt)                              # bumped by the ROV's pipes, thrusters, tool ...
            for other in self.others:                           # ... and by the other rings (a ring removed by Reset is skipped)
                if other is not self and other in rov.props:
                    self._collide_ring(other)
        for _ in range(3):                                      # keep both ends of the hoop inside the pool
            worst = None
            for px, py in self._footprint():
                qx, qy = nearest_in(POOL_REGIONS, px, py)
                d = (qx - px) ** 2 + (qy - py) ** 2
                if d > 1e-12 and (worst is None or d > worst[0]):
                    worst = (d, qx - px, qy - py)
            if worst is None:
                break
            self.x += worst[1]
            self.y += worst[2]
        self.depth = clamp(self.depth, self.R + self.TUBE, self.floor)

    # ------------------------------------------------------------------ being pushed
    def _coast(self, dt):
        """A ring that was pushed keeps drifting and spinning for a moment, slowing in the water."""
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.yaw += self.wz * dt
        k, ks = math.exp(-self.COAST_DRAG * dt), math.exp(-self.SPIN_DRAG * dt)
        self.vx *= k
        self.vy *= k
        self.wz *= ks

    def _hoop(self):
        """The hoop as N_HOOP + 1 points (the first repeated), each (x, y, up)."""
        ehx, ehy, upc = math.cos(self.yaw), math.sin(self.yaw), -self.depth
        pts = []
        for k in range(self.N_HOOP + 1):
            a = 2 * math.pi * k / self.N_HOOP
            h, v = self.R * math.cos(a), self.R * math.sin(a)
            pts.append((self.x + h * ehx, self.y + h * ehy, upc + v))
        return pts

    def _push(self, n, pen, contact, dt):
        """Move the ring out of an overlap: `pen` metres along unit vector `n`; an off-centre push also turns it."""
        px, py, pz = n[0] * pen, n[1] * pen, n[2] * pen
        rx, ry = contact[0] - self.x, contact[1] - self.y          # where it was hit, relative to the ring's centre
        dyaw = clamp(self.SPIN * (rx * py - ry * px) / (self.R * self.R), -0.15, 0.15)
        self.x += px
        self.y += py
        self.depth -= pz
        self.yaw += dyaw
        if dt > 0:                                                 # keep some of that motion as it drifts away
            self.vx = clamp(0.5 * self.vx + 0.5 * px / dt, -1.5, 1.5)
            self.vy = clamp(0.5 * self.vy + 0.5 * py / dt, -1.5, 1.5)
            self.wz = clamp(0.5 * self.wz + 0.5 * dyaw / dt, -4.0, 4.0)

    def _collide(self, rov, dt):
        """Push the ring away from any solid part of the ROV it overlaps (the part that is hooking it excepted)."""
        center = (self.x, self.y, -self.depth)
        reach = self.R + self.TUBE + 0.03
        near = []
        for a, b, r, tag in rov_shape.capsules(rov):
            if tag == "nose" and self.hooked:
                continue                                           # that is the part holding the ring up
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
            half = math.dist(a, b) / 2
            if math.dist(mid, center) <= half + r + reach:
                near.append((a, b, r))
        for _ in range(3):                                         # resolve the worst overlap, then look again
            if not near:
                return
            hoop = self._hoop()
            worst = None
            for a, b, r in near:
                for i in range(self.N_HOOP):
                    c1, c2, d = seg_seg(a, b, hoop[i], hoop[i + 1])
                    pen = r + self.TUBE - d
                    if pen > 1e-4 and (worst is None or pen > worst[0]):
                        worst = (pen, c1, c2, d)
            if worst is None:
                return
            pen, c1, c2, d = worst
            n = ((c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d, (c2[2] - c1[2]) / d) if d > 1e-9 else (0.0, 0.0, 1.0)
            self._push(n, pen + 0.0005, c2, dt)

    def _collide_ring(self, other):
        """Two rings don't pass through each other: each moves half the overlap (all of it if the other is held)."""
        if math.dist((self.x, self.y, -self.depth), (other.x, other.y, -other.depth)) > 2 * self.R + 0.1:
            return
        mine, theirs = self._hoop(), other._hoop()
        worst = None
        for i in range(self.N_HOOP):
            for j in range(other.N_HOOP):
                c1, c2, d = seg_seg(mine[i], mine[i + 1], theirs[j], theirs[j + 1])
                pen = 2 * self.TUBE - d
                if pen > 1e-4 and (worst is None or pen > worst[0]):
                    worst = (pen, c1, c2, d)
        if worst is None:
            return
        pen, c1, c2, d = worst
        n = ((c1[0] - c2[0]) / d, (c1[1] - c2[1]) / d, (c1[2] - c2[2]) / d) if d > 1e-9 else (1.0, 0.0, 0.0)
        share = 1.0 if (other.held or other.hooked) else 0.5
        self._push(n, pen * share + 0.0005, c1, 0.0)

    # ------------------------------------------------------------------ claw
    def _let_go(self, rov):
        self.held = False
        if rov.claw_holder is self:
            rov.claw_holder = None

    def _follow_claw(self, rov, c, s):
        if rov.claw_target > self.CLAMP_COMMAND:          # told to open: let go
            self._let_go(rov)
            return
        rx, ry, rz, ryaw = self.rel
        self.x = rov.x + c * rx - s * ry
        self.y = rov.y + s * rx + c * ry
        self.depth = rov.depth - rz
        self.yaw = rov.yaw + ryaw

    def _between_jaws(self, rov, c, s):
        """Is a piece of the hoop (running across the jaws, not along them) inside the space between the jaws?
        The opening is narrow at the hinges and wider toward the tips, and it widens as the claw opens."""
        ehx, ehy = math.cos(self.yaw), math.sin(self.yaw)           # the hoop's in-plane horizontal direction
        cp, sp = math.cos(rov.pitch), math.sin(rov.pitch)
        swing = math.sin(self.JAW_SWING * rov.claw)
        across = -s * ehx + c * ehy                                 # hoop direction vs the ROV's left-right axis
        for k in range(72):                                         # sample points around the hoop
            a = 2 * math.pi * k / 72
            h, v = self.R * math.cos(a), self.R * math.sin(a)
            dx, dy = self.x + h * ehx - rov.x, self.y + h * ehy - rov.y
            fwd, left = c * dx + s * dy, -s * dx + c * dy           # that point in the ROV's own frame
            up = -self.depth + v + rov.depth
            fx, fz = fwd * cp - up * sp, fwd * sp + up * cp         # (undo the ROV's pitch)
            if not self.JAW_X0 <= fx <= self.JAW_X1 or abs(fz - self.JAW_Z) > self.JAW_ZTOL:
                continue
            opening = self.JAW_Y0 + (fx - self.JAW_X0) * swing - self.JAW_HALF   # half-width of the gap here
            if abs(left) + self.TUBE > opening:
                continue                                            # would hit a jaw, not fit between them
            # The jaws close along left-right. A tube running that way slips out of them (the top and bottom of a
            # ring facing the ROV); the SIDE of the hoop runs vertically and grips.
            if abs(-math.sin(a) * across) < 0.6:
                return True
        return False

    # ------------------------------------------------------------------ nose
    @staticmethod
    def _tool_point(rov, c, s, fx, up):
        """World (x, y, up) of a point fixed to the ROV, (fx ahead, up above its centre), allowing for pitch."""
        cp, sp = math.cos(rov.pitch), math.sin(rov.pitch)
        fx2, up2 = fx * cp + up * sp, -fx * sp + up * cp            # nose-down pitch lowers things out front
        return rov.x + c * fx2, rov.y + s * fx2, -rov.depth + up2

    def _nose_points(self, rov, c, s):
        return [self._tool_point(rov, c, s, fx, up) for fx, up in self.NOSE]

    def _cross(self, pts):
        """Where the nose polyline crosses the ring's plane: (in-plane horizontal, vertical, point) or None."""
        nx, ny = -math.sin(self.yaw), math.cos(self.yaw)
        ehx, ehy = math.cos(self.yaw), math.sin(self.yaw)
        up_c = -self.depth
        d = [(p[0] - self.x) * nx + (p[1] - self.y) * ny for p in pts]
        for i in range(len(pts) - 1):
            if d[i] == d[i + 1] or d[i] * d[i + 1] > 0:
                continue
            t = d[i] / (d[i] - d[i + 1])
            q = [pts[i][k] + t * (pts[i + 1][k] - pts[i][k]) for k in range(3)]
            return (q[0] - self.x) * ehx + (q[1] - self.y) * ehy, q[2] - up_c, q
        return None

    def _nose(self, rov, c, s, dt):
        rho = self.R - self.TUBE - self.NOSE_R           # nose axis stays this far inside the hoop
        cross = self._cross(self._nose_points(rov, c, s))
        if cross is None:
            self.hooked = False                          # nose pulled out of the ring (or never in it)
            return
        dh, dv, q = cross
        if not self.hooked:
            if math.hypot(dh, dv) < rho - 0.01:          # the nose is through the hole
                self.hooked = True
            else:
                return
        dist = math.hypot(dh, dv)
        if dv < 0 and dist > rho + 0.03 and self.depth >= self.floor - 1e-6:
            self.hooked = False                          # nose dropped below the rim of a ring on the floor
            return
        ehx, ehy = math.cos(self.yaw), math.sin(self.yaw)
        # hang: the ring slides sideways until it is directly under the contact point ...
        if dv > 0 and dist > rho - 0.01:
            shift = dh * min(1.0, 6.0 * dt)
            self.x += ehx * shift; self.y += ehy * shift
            dh -= shift
        # ... and if the nose has reached the rim (it rose, or swung sideways), the ring is dragged along
        if dist > rho:
            k = (dist - rho) / dist
            self.x += ehx * dh * k; self.y += ehy * dh * k
            self.depth -= dv * k
        # a ring hanging on the rod slides to its low part and stays there: driving forward pushes it,
        # reversing carries it back up the curved tip (so it comes along instead of slipping off)
        hanging = dv > 0 and dist > rho - 0.02        # the nose is holding it up (not resting on the floor)
        self.lifting = hanging and self.depth < self.floor - 0.02
        a = (self.x - rov.x) * c + (self.y - rov.y) * s
        shove = clamp(a, *self.SLIDE) - a
        if shove > 0 or hanging:                      # the frame always pushes it; the tip only carries it if hanging
            self.x += shove * c; self.y += shove * s
        # the ring turns with the ROV so the nose keeps pointing through its hole
        self.yaw += wrap_half_pi(rov.yaw + math.pi / 2 - self.yaw) * min(1.0, 6.0 * dt)

    # ------------------------------------------------------------------ report
    def state(self):
        return {"type": "ring", "x": self.x, "y": self.y, "depth": self.depth,
                "yaw": self.yaw, "held": self.held, "hooked": self.hooked, "inJaws": self.in_jaws,
                "r": self.R, "tube": self.TUBE, "color": self.color}


# where the rings start (x, y, yaw, colour): the first faces the ROV's starting position; the rest are scattered
RING_STARTS = [
    (0.8, 0.0, math.pi / 2, 0xff6a00),            # orange
    (-0.4, -0.9, math.pi / 2 + 0.5, 0xffc400),    # yellow
    (1.9, 0.9, math.pi / 2 - 0.5, 0x2fbf5a),      # green
    (-1.9, 0.9, math.pi / 2 + 0.2, 0xb15cff),     # purple
    (2.3, -0.9, math.pi / 2 - 0.3, 0xff4d88),     # pink
]


MAX_RINGS = 10                  # the most rings the pool can hold (the page's "drop a ring" key stops here)


def drop_ring(rov, x, y):
    """Drop a NEW ring into the water at (x, y): it starts at the surface and sinks to the floor. Returns the ring, or None when the pool
    already has MAX_RINGS. It is a "transient" prop: Reset removes it again (the pool goes back to how it started)."""
    rings = [p for p in rov.props if getattr(p, "type", "") == "ring"]
    if len(rings) >= MAX_RINGS:
        return None
    others = rings[0].others if rings else []               # one shared list, so every ring knows every other ring
    x, y = nearest_in(POOL_REGIONS, x, y)                   # inside the pool, whatever was asked for
    ring = Ring(x, y, random.uniform(0.0, math.pi), RING_STARTS[len(rings) % len(RING_STARTS)][3], others=others)
    ring.depth = Ring.R + Ring.TUBE                         # the top of the hoop just at the surface
    ring.transient = True
    others.append(ring)
    rov.props.append(ring)
    return ring


def add_to(rov, n=3):
    """Called by the runners: put the standard props in the pool (n rings, 0 to 5)."""
    rings = []
    for x, y, yaw, color in RING_STARTS[:max(0, min(int(n), len(RING_STARTS)))]:
        rings.append(Ring(x, y, yaw, color, others=rings))
    rov.props.extend(rings)
