# =============================================================================
# rov_fish.py — OPTIONAL whimsy: a coy fish that swims around and never lets the ROV catch it
# =============================================================================
# This whole file is an add-on. To remove it completely:
#   1. delete this file and web/fish.js
#   2. (optional) delete the small "try: import rov_fish" blocks in rov_sim.py and keyboard_sim.py —
#      they already skip quietly when this file is missing.
#
# THE FISH wanders the pool at a lazy pace, sometimes drifting over to look at the ROV from a polite distance.
# If the ROV gets close it bolts, faster than the ROV can swim. It can't be caught, so nothing has to happen
# when they "meet":
#   1. it starts fleeing early (FLEE_AT) and picks the escape route with the most room,
#   2. it swims faster than the ROV (BURST),
#   3. as a last resort a hard rule keeps it at least SAFE metres from the ROV's surface: it is pushed out, and if
#      the pool geometry won't let it (cornered), it darts to the free spot farthest from the ROV.
# It respects the pool: walls, the floor, the surface, and the step up to the shallow end (it only swims into the
# shallow end when its depth allows). It ignores the rings.
# =============================================================================
import math
import random

import rov_shape
from rov_physics import POOL_MAX_DEPTH, POOL_REGIONS, clamp, nearest_in


def wrap_pi(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Fish:
    type = "fish"
    SAFE = 0.55               # m: never closer than this to the ROV's surface
    FLEE_AT, CALM_AT = 1.6, 2.4       # starts fleeing inside the first, calms down outside the second
    CRUISE = (0.15, 0.35)     # m/s, lazy swimming
    BURST = 2.0               # m/s, bolting (faster than the ROV's top speed)
    ROV_SPEED = 1.3           # m/s: how fast the fish assumes the ROV can chase
    TURN_CRUISE, TURN_FLEE = 1.6, 5.0     # rad/s
    MARGIN = 0.3              # keep this far from walls, floor and surface

    def __init__(self, seed=1, color=0xff7a2a):
        self.seed = seed
        self.color = color
        self.rng = random.Random(seed)
        self.reset()

    # ------------------------------------------------------------------ setup
    def reset(self):
        self.rng = random.Random(self.seed)
        deep = max(POOL_REGIONS, key=lambda r: r[4])
        # start in the far half of the deep end, away from the ROV's starting corner
        self.x = self.rng.uniform(deep[0] + 0.6 * (deep[1] - deep[0]), deep[1] - 0.5)
        self.y = self.rng.uniform(deep[2] + 0.4, deep[3] - 0.4)
        self.depth = self.rng.uniform(0.7, min(1.2, deep[4] - 0.4))
        self.yaw = self.rng.uniform(-math.pi, math.pi)
        self.pitch = 0.0
        self.speed = 0.2
        self.mode = "wander"
        self.target = None
        self.cruise = 0.25
        self.retarget = 0.0            # seconds until a fleeing fish reconsiders its route
        self.gap = 99.0                # distance to the ROV's surface, last step
        self.darts = 0                 # how many times it had to dart (cornered)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _open_regions(depth):
        """Regions a fish at this depth may be over (the shelf is closed to a fish that is too deep)."""
        regs = [r for r in POOL_REGIONS if r[4] - Fish.MARGIN >= depth]
        return regs or [max(POOL_REGIONS, key=lambda r: r[4])]

    def _floor_here(self, x, y):
        ds = [r[4] for r in self._open_regions(self.depth) if r[0] <= x <= r[1] and r[2] <= y <= r[3]]
        return max(ds) if ds else POOL_MAX_DEPTH

    def _random_point(self):
        """A random spot in the water (area-weighted across regions), kept off the walls and the floor."""
        regs = [r for r in POOL_REGIONS if r[1] - r[0] > 2 * self.MARGIN and r[3] - r[2] > 2 * self.MARGIN and r[4] > 2 * self.MARGIN + 0.1]
        weights = [(r[1] - r[0]) * (r[3] - r[2]) for r in regs]
        r = self.rng.choices(regs, weights)[0]
        x = self.rng.uniform(r[0] + self.MARGIN, r[1] - self.MARGIN)
        y = self.rng.uniform(r[2] + self.MARGIN, r[3] - self.MARGIN)
        d = self.rng.uniform(self.MARGIN, r[4] - self.MARGIN)
        return x, y, d

    def _pick_wander(self, rov):
        self.cruise = self.rng.uniform(*self.CRUISE)
        if self.rng.random() < 0.3:                        # curious: drift over to look, but not too close
            a, r = self.rng.uniform(0, 2 * math.pi), self.rng.uniform(1.9, 2.8)
            x, y = nearest_in(POOL_REGIONS, rov.x + r * math.cos(a), rov.y + r * math.sin(a), self.MARGIN)
            self.target = (x, y, clamp(self.rng.uniform(0.4, 1.2), self.MARGIN, POOL_MAX_DEPTH - self.MARGIN))
        else:
            self.target = self._random_point()

    def _pick_escape(self, rov, near):
        """Choose a route by rehearsing it: for each direction, swim it for ~1.5 s (sliding along walls) while the
        ROV chases at full speed, and keep the route that leaves the most distance between us. A route along a wall,
        or past the ROV, beats running into a corner."""
        regions = self._open_regions(self.depth)
        away = math.atan2(self.y - near[1], self.x - near[0]) if math.hypot(self.x - near[0], self.y - near[1]) > 1e-6 else self.yaw
        best = None
        for k in range(16):
            a = away + (k - 7.5) * 0.4                        # all the way round, finest straight away
            x, y, px, py, gap_min = self.x, self.y, rov.x, rov.y, 99.0
            for _ in range(10):
                x, y = nearest_in(regions, x + self.BURST * 0.15 * math.cos(a), y + self.BURST * 0.15 * math.sin(a), self.MARGIN)
                d = math.hypot(x - px, y - py)
                if d > 1e-6:                                  # the ROV swims straight at us
                    px += (x - px) / d * self.ROV_SPEED * 0.15
                    py += (y - py) / d * self.ROV_SPEED * 0.15
                gap_min = min(gap_min, math.hypot(x - px, y - py))
            score = gap_min + 0.25 * math.hypot(x - px, y - py) + 0.05 * self.rng.random()
            if best is None or score > best[0]:
                best = (score, x, y)
        # swim up or down, away from the ROV's depth
        d = clamp(self.depth + (0.6 if self.depth < rov.depth else -0.6) + self.rng.uniform(-0.2, 0.2),
                  self.MARGIN, self._floor_here(best[1], best[2]) - self.MARGIN)
        self.target = (best[1], best[2], d)
        self.retarget = 0.4

    def _keep_in_water(self):
        """Walls, floor and surface (and the step: only the regions open at this depth)."""
        x, y = nearest_in(self._open_regions(self.depth), self.x, self.y, self.MARGIN)
        moved = abs(x - self.x) + abs(y - self.y) > 1e-9
        self.x, self.y = x, y
        self.depth = clamp(self.depth, self.MARGIN, max(self.MARGIN, self._floor_here(x, y) - self.MARGIN))
        return moved

    # ------------------------------------------------------------------ per-step
    def step(self, rov, dt):
        gap, near = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        self.retarget -= dt
        if gap < self.FLEE_AT:
            if self.mode != "flee" or self.retarget <= 0:
                self.mode = "flee"
                self._pick_escape(rov, near)
        elif self.mode == "flee" and gap > self.CALM_AT:
            self.mode = "wander"
            self.target = None
        if self.mode == "wander" and self.target is None:
            self._pick_wander(rov)

        tx, ty, td = self.target
        dx, dy, dd = tx - self.x, ty - self.y, td - self.depth
        hdist = math.hypot(dx, dy)
        if self.mode == "wander" and hdist < 0.25 and abs(dd) < 0.25:
            self.target = None                                  # arrived: choose somewhere else next step
        flee = self.mode == "flee"
        turn = self.TURN_FLEE if flee else self.TURN_CRUISE
        if hdist > 0.05:
            err = wrap_pi(math.atan2(dy, dx) - self.yaw)
            self.yaw = wrap_pi(self.yaw + clamp(err, -turn * dt, turn * dt))
        want = self.BURST if flee else self.cruise * clamp(hdist / 0.5, 0.4, 1.0)
        self.speed += (want - self.speed) * min(1.0, (6.0 if flee else 3.0) * dt)
        want_pitch = clamp(math.atan2(dd, max(hdist, 0.2)), -0.5, 0.5)
        self.pitch += clamp(want_pitch - self.pitch, -1.5 * dt, 1.5 * dt)

        hv = self.speed * math.cos(self.pitch)
        self.x += hv * math.cos(self.yaw) * dt
        self.y += hv * math.sin(self.yaw) * dt
        self.depth += self.speed * math.sin(self.pitch) * dt
        if self._keep_in_water() and self.mode == "wander":
            self.target = None                                  # bumped a wall: pick a new destination

        self._keep_clear(rov)
        self.gap = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))[0]      # reported AFTER the correction

    def _keep_clear(self, rov):
        """The rule that makes it uncatchable: stay SAFE metres from the ROV's surface, whatever happens."""
        gap, near = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        if gap >= self.SAFE:
            return
        p = (self.x - near[0], self.y - near[1], -self.depth - near[2])
        n = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
        if n < 1e-6:
            p, n = (math.cos(self.yaw), math.sin(self.yaw), 0.0), 1.0
        # new position: the nearest point on the ROV's surface, pushed out along the line from it by SAFE (plus a little)
        self.x = near[0] + p[0] / n * (self.SAFE + 0.03)
        self.y = near[1] + p[1] / n * (self.SAFE + 0.03)
        self.depth = clamp(-(near[2] + p[2] / n * (self.SAFE + 0.03)), 0.0, POOL_MAX_DEPTH)
        self._keep_in_water()
        gap2, _ = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        self.mode = "flee"
        if gap2 < self.SAFE - 0.02:                              # cornered: dart to the free spot farthest from the ROV
            best = None
            for _ in range(40):
                x, y, d = self._random_point()
                g, _n = rov_shape.distance_to_rov(rov, (x, y, -d))
                if best is None or g > best[0]:
                    best = (g, x, y, d)
            _, self.x, self.y, self.depth = best
            self.yaw = math.atan2(self.y - rov.y, self.x - rov.x)
            self.target = None
            self.darts += 1
        self._pick_escape(rov, near)

    # ------------------------------------------------------------------ report
    def state(self):
        return {"type": "fish", "x": self.x, "y": self.y, "depth": self.depth, "yaw": self.yaw,
                "pitch": self.pitch, "speed": self.speed, "flee": self.mode == "flee", "color": self.color}


FISH_COLORS = [0xff7a2a, 0xffb703, 0xf2efe6]


def add_to(rov, n=1):
    """Called by the runners: put n fish in the pool (0 to 3)."""
    for i in range(max(0, min(int(n), 3))):
        rov.props.append(Fish(seed=11 + 7 * i, color=FISH_COLORS[i % len(FISH_COLORS)]))
