# =============================================================================
# rov_pushable.py — OPTIONAL base class: things that rest on the pool floor and get pushed out of the way when the ROV touches them
# =============================================================================
# A Pushable is a small body (a vertical capsule standing on the floor) that lives inside one rectangle of the pool. Each step:
#   1. think()      the subclass says how it wants to move by itself (a crab walks, a rock does nothing)
#   2. it moves, plus whatever speed a push gave it (which dies away in the water, like the rings)
#   3. every solid part of the ROV (rov_shape.capsules: pipes, thrusters, jaws, nose) that overlaps it pushes it out along the floor,
#      and a push that is not through its middle turns it a little
#   4. it is kept inside its rectangle (it never leaves the pool, or climbs the step)
# It only ever moves along the floor. Game-style physics like the rings: overlap tests, resolved by moving the light object;
# the ROV is not slowed by what it pushes. The crab (rov_crab.py) is the first user; a rock or a lobster pot would be a few lines.
#
# This whole file is an add-on: the core only knows "a prop has reset(), step(rov, dt), state()".
# Remove: delete this file and rov_crab.py (and web/crab.js).
# =============================================================================
import math

import rov_shape
from rov_physics import POOL_REGIONS, clamp, nearest_in
from rov_shape import seg_seg


class Pushable:
    type = "pushable"
    RADIUS = 0.05                      # m: how wide it is (a part of the ROV closer than this, plus its own radius, pushes it)
    BODY_LOW, BODY_HIGH = 0.005, 0.040  # the body stands from this height above the floor to this one
    MARGIN = 0.06                      # keeps this far from the walls of its rectangle
    COAST_DRAG, SPIN_DRAG = 4.0, 5.0   # 1/s: how fast a pushed object slows down in the water
    SPIN = 0.6                         # how strongly an off-centre push turns it
    MAX_PUSH_SPEED = 1.0               # m/s: a push never throws it faster than this

    def __init__(self, x, y, yaw=0.0):
        self.start = (x, y, yaw)
        self.reset()

    # ------------------------------------------------------------------ what a subclass provides
    def home(self):
        """The rectangle (x0, x1, y0, y1, floor depth) it lives in: by default the shallowest part of the pool."""
        return min(POOL_REGIONS, key=lambda r: r[4])

    def think(self, rov, dt):
        """Its own motion this step as (vx, vy) in m/s along the floor. A thing that never moves by itself returns (0, 0)."""
        return 0.0, 0.0

    # ------------------------------------------------------------------ common
    def reset(self):
        self.x, self.y, self.yaw = self.start
        self.pvx = self.pvy = self.pw = 0.0          # motion from pushes: m/s, m/s, rad/s
        self.pushed = False                          # touched by the ROV during the last step

    @property
    def floor(self):
        return self.home()[4]

    def step(self, rov, dt):
        vx, vy = self.think(rov, dt)
        self.x += (vx + self.pvx) * dt
        self.y += (vy + self.pvy) * dt
        self.yaw += self.pw * dt
        k, ks = math.exp(-self.COAST_DRAG * dt), math.exp(-self.SPIN_DRAG * dt)
        self.pvx *= k
        self.pvy *= k
        self.pw *= ks
        self.pushed = False
        self._collide(rov, dt)
        self._keep_inside()

    def _keep_inside(self):
        r = self.home()
        self.x, self.y = nearest_in([r], self.x, self.y, self.MARGIN)

    def _collide(self, rov, dt):
        """Push this body out of every part of the ROV it overlaps (up to three rounds: resolve the worst, look again)."""
        floor = self.floor
        a = (self.x, self.y, -floor + self.BODY_LOW)
        b = (self.x, self.y, -floor + self.BODY_HIGH)
        parts = [(ca, cb, r) for ca, cb, r, _tag in rov_shape.capsules(rov)
                 if min(ca[2], cb[2]) - r < -floor + 0.5 and math.hypot((ca[0] + cb[0]) / 2 - self.x, (ca[1] + cb[1]) / 2 - self.y) < 1.2]   # near the floor and near us
        for _ in range(3):
            worst = None
            a = (self.x, self.y, a[2])
            b = (self.x, self.y, b[2])
            for ca, cb, r in parts:
                c1, c2, d = seg_seg(a, b, ca, cb)
                pen = r + self.RADIUS - d
                if pen > 1e-4 and (worst is None or pen > worst[0]):
                    worst = (pen, c1, c2, d)
            if worst is None:
                return
            pen, c1, c2, d = worst
            nx, ny = c1[0] - c2[0], c1[1] - c2[1]                 # along the floor, from the ROV part toward us
            h = math.hypot(nx, ny)
            if h < 1e-6:                                          # straight under a part: get out of the way of the ROV's front
                nx, ny, h = math.cos(rov.yaw), math.sin(rov.yaw), 1.0
            frac = clamp(h / d, 0.35, 1.0) if d > 1e-9 else 1.0   # a mostly-sideways contact moves us the whole overlap; an under-the-part one moves us further
            move = min((pen + 0.0005) / frac, 0.08)
            px, py = nx / h * move, ny / h * move
            rx, ry = c2[0] - self.x, c2[1] - self.y               # where it was hit, relative to the middle
            dyaw = clamp(self.SPIN * (rx * py - ry * px) / (self.RADIUS * self.RADIUS), -0.2, 0.2)
            self.x += px
            self.y += py
            self.yaw += dyaw
            self.pushed = True
            if dt > 0:                                            # keep some of that motion as it drifts away
                self.pvx = clamp(0.5 * self.pvx + 0.5 * px / dt, -self.MAX_PUSH_SPEED, self.MAX_PUSH_SPEED)
                self.pvy = clamp(0.5 * self.pvy + 0.5 * py / dt, -self.MAX_PUSH_SPEED, self.MAX_PUSH_SPEED)
                self.pw = clamp(0.5 * self.pw + 0.5 * dyaw / dt, -3.0, 3.0)
            self._keep_inside()

    def state(self):
        return {"type": self.type, "x": self.x, "y": self.y, "depth": self.floor - 0.02, "yaw": self.yaw, "r": self.RADIUS}
