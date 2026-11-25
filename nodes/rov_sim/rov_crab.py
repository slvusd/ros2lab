# =============================================================================
# rov_crab.py — OPTIONAL whimsy: a small European green crab crawling about on the floor of the shallow end
# =============================================================================
# (The 2026 scout task is to remove invasive species: the green crab. For now the crab just lives there: it crawls sideways like a real
#  crab, scuttles away when the ROV comes close (but far too slowly to get away: the ROV is several times faster), and when the ROV
#  touches it, it is simply shoved out of the way, like the rings. Picking one up is a future job.)
#
# It is a Pushable (rov_pushable.py): that file does the pushing and keeps it on the floor and inside the shallow end; this file only
# decides where it wants to walk. To remove it completely: delete this file and web/crab.js (and, optionally, the small
# "try: import rov_crab" blocks in rov_sim.py and keyboard_sim.py: they already skip quietly when this file is missing).
#
#   pause    it sits still for a few seconds
#   walk     it picks a spot on the shelf and crawls there, sideways (the claws lead, the body is turned across the way it goes)
#   scuttle  if the ROV gets within SCARE_AT it hurries straight away from it until it is CALM_AT clear, then pauses
# =============================================================================
import math
import random

import rov_shape
from rov_pushable import Pushable
from rov_physics import clamp


def wrap_pi(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Crab(Pushable):
    type = "crab"
    RADIUS = 0.05                      # about 10 cm wide counting the legs: a bit bigger than the real 1.5 inch end cap crabs, so it can be seen
    WALK = (0.03, 0.07)                # m/s, an unhurried crawl
    SCUTTLE = 0.16                     # m/s when frightened: still about five times slower than the ROV
    SCARE_AT, CALM_AT = 0.45, 0.8      # metres from the ROV's surface
    PAUSE = (1.0, 5.0)                 # seconds it sits still between walks
    ARRIVE = 0.04                      # m: close enough to the spot to stop

    def __init__(self, seed=1, color=0x3f8f3a):
        self.seed = seed
        self.color = color
        super().__init__(0.0, 0.0)

    def reset(self):
        self.rng = random.Random(self.seed)
        r = self.home()
        m = self.MARGIN + 0.1
        self.start = (self.rng.uniform(r[0] + m, r[1] - m), self.rng.uniform(r[2] + m, r[3] - m), self.rng.uniform(-math.pi, math.pi))
        super().reset()
        self.mode = "pause"
        self.timer = self.rng.uniform(0.2, 2.0)
        self.target = None
        self.side = 1                  # which way it walks sideways: +1 or -1
        self.walk_speed = 0.05
        self.speed = 0.0
        self.gap = 99.0                # distance to the ROV's surface, as of the last step

    def _pick_target(self):
        r = self.home()
        m = self.MARGIN + 0.05
        for _ in range(8):             # a spot 0.25 to 0.9 m away, if there is one
            ang = self.rng.uniform(-math.pi, math.pi)
            dist = self.rng.uniform(0.25, 0.9)
            tx, ty = self.x + math.cos(ang) * dist, self.y + math.sin(ang) * dist
            if r[0] + m <= tx <= r[1] - m and r[2] + m <= ty <= r[3] - m:
                return tx, ty
        return self.rng.uniform(r[0] + m, r[1] - m), self.rng.uniform(r[2] + m, r[3] - m)

    def _face(self, heading, dt, rate=4.0):
        """Turn the body so that moving along `heading` is sideways: the claws point a quarter turn away from the way it goes."""
        want = heading - self.side * math.pi / 2
        self.yaw = wrap_pi(self.yaw + clamp(wrap_pi(want - self.yaw), -rate * dt, rate * dt))

    def think(self, rov, dt):
        floor = self.floor
        gap, near = rov_shape.distance_to_rov(rov, (self.x, self.y, -floor + 0.02))
        self.gap = gap
        if gap < self.SCARE_AT:
            self.mode = "scuttle"
        elif self.mode == "scuttle" and gap > self.CALM_AT:
            self.mode, self.timer = "pause", self.rng.uniform(*self.PAUSE)

        if self.mode == "scuttle":
            away = math.atan2(self.y - near[1], self.x - near[0]) if math.hypot(self.x - near[0], self.y - near[1]) > 1e-6 else rov.yaw
            self._face(away, dt, 8.0)
            self.speed = self.SCUTTLE
            return math.cos(away) * self.speed, math.sin(away) * self.speed

        if self.mode == "pause":
            self.speed = 0.0
            self.timer -= dt
            if self.timer <= 0:
                self.mode, self.target = "walk", self._pick_target()
                self.side = self.rng.choice((-1, 1))
                self.walk_speed = self.rng.uniform(*self.WALK)
            return 0.0, 0.0

        dx, dy = self.target[0] - self.x, self.target[1] - self.y      # walk
        dist = math.hypot(dx, dy)
        if dist < self.ARRIVE:
            self.mode, self.timer, self.speed = "pause", self.rng.uniform(*self.PAUSE), 0.0
            return 0.0, 0.0
        heading = math.atan2(dy, dx)
        self._face(heading, dt)
        self.speed = self.walk_speed * clamp(dist / 0.15, 0.3, 1.0)
        return math.cos(heading) * self.speed, math.sin(heading) * self.speed

    def state(self):
        d = super().state()
        d.update(speed=self.speed, mode=self.mode, moving=self.speed > 0.005, color=self.color)
        return d


def add_to(rov, n=1):
    """Called by the runners: put n crabs (0 to 5) on the shallow end's floor."""
    for i in range(max(0, min(int(n), 5))):
        rov.props.append(Crab(seed=21 + 5 * i))
