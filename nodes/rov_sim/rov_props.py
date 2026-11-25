# =============================================================================
# rov_props.py — OPTIONAL extras in the pool: a weighted ring to pick up
# =============================================================================
# This whole file is an add-on. To remove it completely:
#   1. delete this file and web/props.js
#   2. (optional) delete the small "try: import rov_props" blocks in rov_sim.py and
#      keyboard_sim.py — they already skip quietly when this file is missing.
# The core code only knows "a prop has reset(), step(rov, dt), state()".
#
# THE RING: a slightly buoyant hoop with a weight on its bottom edge, so it stands upright
# on the pool floor, facing the ROV's starting position. Two ways to lift it:
#
#   NOSE tool: drive the nose THROUGH the ring, then rise. The top of the nose meets the
#     ring's inner rim and carries it up; the ring hangs from the nose (its weighted edge
#     swinging down, turning with the ROV). Lower it to the floor and back out to leave it.
#     Reversing out of the ring (the tip pulling back through) also lets it go.
#   CLAW tool: open the claw and put the jaws around the rim's SIDE (a vertical bit of tube, anywhere
#     between the jaw hinges and the fingertips), then command the claw closed. It grips at once and
#     the jaws stop at the tube's thickness. Command the claw open again (above ~1/4) to let go; the
#     ring then sinks back to the floor. (The HUD says "ring between jaws" when it is in position.)
#
# Game-style physics, not a contact solver: the nose test is "the nose crosses the ring's
# plane inside the hole"; after that the ring is just kept within reach of the nose.
# =============================================================================
import math

from rov_physics import POOL_MAX_DEPTH, POOL_REGIONS, clamp, floor_at, nearest_in


def wrap_half_pi(a):
    """Angle difference wrapped into (-pi/2, pi/2]: a ring looks the same turned by 180 degrees."""
    return (a + math.pi / 2) % math.pi - math.pi / 2


class Ring:
    type = "ring"
    R, TUBE = 0.14, 0.02          # hoop radius and tube radius (m)
    SINK = 0.15                   # m/s: how fast it falls once nothing holds it up
    START = dict(x=0.8, y=0.0, yaw=math.pi / 2)   # yaw pi/2: the hoop faces the ROV's start
    TORQUE_HANGING, TORQUE_HELD = 1.7, 1.2        # N m of nose-down torque from the ring's weight out front
                                                  # (about 6 / 4 degrees of tilt; the front/rear thrusters can cancel it)

    # --- nose: a polyline from the front bottom bar, (forward, up) in metres from the ROV centre ---
    NOSE = [(0.25, -0.25), (0.35, -0.25), (0.43, -0.238), (0.485, -0.195)]
    NOSE_R = 0.016
    SLIDE = (0.31, 0.45)          # a hanging ring rests on the nose's low part, this far ahead of the ROV centre
    # --- claw ---
    # the jaws, in the ROV's frame (matches the model in web/app.js): hinged at JAW_X0 ahead of the centre,
    # on the bottom bar, each swinging outward by up to JAW_SWING radians
    JAW_X0, JAW_X1 = 0.42, 0.60   # the jaws cover this stretch ahead of the ROV centre
    JAW_Y0, JAW_HALF = 0.03, 0.0125   # hinge sits this far left/right of centre; half a jaw's thickness
    JAW_SWING = 0.7
    JAW_Z, JAW_ZTOL = -0.25, 0.035    # jaw height relative to the ROV centre, and how far off a tube can be vertically
    CLAMP_COMMAND = 0.25          # a claw command at or below this means "squeeze"; above it, "open"
    HOLD_OPEN = 0.10              # jaws can't close past the tube's thickness

    def __init__(self):
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
        self.x, self.y, self.yaw = self.START["x"], self.START["y"], self.START["yaw"]
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
            self.held = False
            rov.claw_floor = 0.0

        if self.held:
            self._follow_claw(rov, c, s)
            if self.held:
                rov.pitch_torque += self.TORQUE_HELD
        else:
            if rov.tool == "claw":
                rov.claw_floor = 0.0
            self.in_jaws = rov.tool == "claw" and self._between_jaws(rov, c, s)
            self.depth = min(self.floor, self.depth + self.SINK * dt)      # gravity
            if rov.tool == "nose":
                self._nose(rov, c, s, dt)
            elif (self.in_jaws and rov.claw_target <= self.CLAMP_COMMAND and rov.claw < self.prev_claw - 1e-4):
                self.held = True       # the claw is closing with a piece of the hoop between the jaws
                rov.claw_floor = self.HOLD_OPEN
                dx, dy = self.x - rov.x, self.y - rov.y
                self.rel = (c * dx + s * dy, -s * dx + c * dy,
                            -self.depth + rov.depth, self.yaw - rov.yaw)
        if self.lifting:
            rov.pitch_torque += self.TORQUE_HANGING
        self.prev_claw = rov.claw
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

    # ------------------------------------------------------------------ claw
    def _follow_claw(self, rov, c, s):
        if rov.claw_target > self.CLAMP_COMMAND:          # told to open: let go
            self.held = False
            rov.claw_floor = 0.0
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
                "r": self.R, "tube": self.TUBE}


def add_to(rov):
    """Called by the runners: put the standard props in the pool."""
    rov.props.append(Ring())
