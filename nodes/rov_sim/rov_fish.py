# =============================================================================
# rov_fish.py — OPTIONAL whimsy: a coy fish that swims around and never lets the ROV catch it
# =============================================================================
# This whole file is an add-on. To remove it completely:
#   1. delete this file and web/fish.js
#   2. (optional) delete the small "try: import rov_fish" blocks in rov_sim.py and keyboard_sim.py —
#      they already skip quietly when this file is missing.
#
# WHAT THE FISH DOES
#   wander  lazy swimming between random spots in open water (kept away from the walls and corners).
#   route   now and then it threads a pool ring: in one side, through the hoop, out the other.
#   peek    if the ROV has been sitting still for a couple of seconds the fish trusts it, and drifts over to hover in
#           view of the ROV's camera, looking into it (about 0.8 m from the lens), then wanders off. The moment the
#           ROV moves, that trust is gone.
#   flee    if the ROV comes close it bolts, faster than the ROV can swim. It plans its escape in THREE dimensions:
#           for every direction (including diving and rising) it rehearses ~1.5 s of swimming against a chasing ROV,
#           and keeps the route that leaves the most distance and the most open water around it. The ROV is slow at
#           going up and down, so a fish that dives or climbs usually gets clear; routes into walls and corners score
#           badly. If it still finds itself pinned against a wall it re-plans immediately.
#
# IT CAN NEVER BE CAUGHT, so nothing has to happen when they "meet": it flees early (1.6 m), it is faster than the ROV,
# and a hard rule keeps it at least SAFE_HARD (30 cm) from the ROV's surface: it is pushed clear, and if the pool
# geometry won't let it (cornered) it darts to the free spot farthest from the ROV. It respects the pool (walls, floor,
# surface, and the step up to the shallow end: it only swims in there when its depth allows) and ignores the rings
# except to swim through them.
# =============================================================================
import math
import random

import rov_shape
from rov_physics import POOL_MAX_DEPTH, POOL_REGIONS, clamp, nearest_in


def wrap_pi(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Fish:
    type = "fish"
    # --- how close it lets the ROV get (distances are to the ROV's surface, metres) ---
    SAFE_HARD = 0.30                  # never closer than this, whatever happens
    FLEE_AT, CALM_AT = 1.6, 2.4       # starts fleeing inside the first, calms down outside the second
    FLEE_AT_TRUST, CALM_AT_TRUST = 0.45, 0.6     # the same, once it trusts a ROV that is sitting still
    IDLE_AFTER = 2.0                  # seconds of a still ROV before it trusts it
    REACTION = 0.0                    # extra seconds of warning: flees earlier by (ROV closing speed x this). Tried 0.5-1.0:
                                      # it just runs out of pool sooner, so it is off; the knob is here if you want to try
    # --- swimming ---
    CRUISE = (0.15, 0.35)             # m/s, lazy
    BURST = 2.0                       # m/s, bolting (faster than the ROV's top speed)
    ROV_SPEED, ROV_VSPEED = 1.3, 0.8  # m/s: what the fish assumes the ROV can do when chasing (horizontal, vertical)
    TURN_CRUISE, TURN_FLEE = 1.6, 7.0         # rad/s (a bolting fish turns sharply)
    PITCH_CRUISE, PITCH_FLEE = 0.5, 1.1       # how steeply it may climb or dive (radians)
    MARGIN = 0.3                      # keeps this far from the walls, floor and surface
    WANDER_MARGIN = 0.8               # ... and wanders at least this far from the walls
    RING_MARGIN = 0.15                # while threading a ring it may get this close to the floor

    def __init__(self, seed=1, color=0xff7a2a):
        self.seed = seed
        self.color = color
        self.reset()

    # ------------------------------------------------------------------ setup
    def reset(self):
        self.rng = random.Random(self.seed)
        deep = max(POOL_REGIONS, key=lambda r: r[4])
        # start in the far half of the deep end, away from the ROV's starting corner
        self.x = self.rng.uniform(deep[0] + 0.6 * (deep[1] - deep[0]), deep[1] - 0.8)
        self.y = self.rng.uniform(deep[2] + 0.6, deep[3] - 0.6)
        self.depth = self.rng.uniform(0.7, min(1.2, deep[4] - 0.5))
        self.yaw = self.rng.uniform(-math.pi, math.pi)
        self.pitch = 0.0
        self.speed = 0.2
        self.mode = "wander"
        self.target = None
        self.route = []                # waypoints while threading a ring
        self.route_ring = None
        self.route_center = None
        self.cruise = 0.25
        self.retarget = 0.0            # seconds until a fleeing fish reconsiders its route
        self.clock = 0.0
        self.idle_t = 0.0              # how long the ROV has been still
        self.trusting = False
        self.peek_until = 0.0
        self.peek_local = (1.0, 0.0, 0.05)
        self.pinned_t = 0.0            # how long a fleeing fish has been pressed against a wall
        self.dm = self.MARGIN          # depth margin (smaller while threading a ring)
        self.gap = 99.0                # distance to the ROV's surface, after the last step
        self.darts = 0                 # how many times it had to dart (cornered)

    # ------------------------------------------------------------------ helpers
    def _open_regions(self, depth):
        """Regions a fish at this depth may be over (the shelf is closed to a fish that is too deep)."""
        regs = [r for r in POOL_REGIONS if r[4] - self.dm >= depth]
        return regs or [max(POOL_REGIONS, key=lambda r: r[4])]

    def _floor_here(self, x, y, regions=None):
        ds = [r[4] for r in (regions or self._open_regions(self.depth)) if r[0] <= x <= r[1] and r[2] <= y <= r[3]]
        return max(ds) if ds else POOL_MAX_DEPTH

    def _random_point(self, avoid=None):
        """A random spot in open water (area-weighted across regions), well off the walls, floor and surface.
        With `avoid` (the ROV) it picks one that is at least 2.5 m from it, if it can find one."""
        for _ in range(10 if avoid is not None else 1):
            x, y, z = self._random_spot()
            if avoid is None or math.dist((x, y, z), (avoid.x, avoid.y, avoid.depth)) > 2.5:
                break
        return (x, y, z)

    def _random_spot(self):
        regs = [r for r in POOL_REGIONS if r[1] - r[0] > 2 * self.WANDER_MARGIN and r[3] - r[2] > 2 * self.WANDER_MARGIN and r[4] > 0.9]
        weights = [(r[1] - r[0]) * (r[3] - r[2]) for r in regs]
        r = self.rng.choices(regs, weights)[0]
        return (self.rng.uniform(r[0] + self.WANDER_MARGIN, r[1] - self.WANDER_MARGIN),
                self.rng.uniform(r[2] + self.WANDER_MARGIN, r[3] - self.WANDER_MARGIN),
                self.rng.uniform(0.4, r[4] - 0.4))

    def _clearance(self, regions, x, y, z):
        """0..1: how much open water surrounds this spot (0 = against a wall, the floor or the surface, 1 = plenty)."""
        h = 0.0
        for m in (0.4, 0.7, 1.0, 1.4):
            qx, qy = nearest_in(regions, x, y, m)
            if abs(qx - x) + abs(qy - y) > 1e-9:
                break
            h = m
        v = min(z - self.MARGIN, self._floor_here(x, y, regions) - self.MARGIN - z)
        return min(h / 1.4, max(v, 0.0) / 0.5, 1.0)

    # ------------------------------------------------------------------ choosing where to go
    def _rehearse(self, rov, a, pitch, regions):
        """Swim toward heading `a` and climb angle `pitch` for ~1.8 s, with the fish's real limits (it has to TURN from
        the way it is facing, speed up, and tilt), while the ROV chases flat out; report how it goes. A route that needs
        a U-turn out of a wall costs what it really costs."""
        x, y, z = self.x, self.y, self.depth
        yaw, pit, spd = self.yaw, self.pitch, self.speed
        px, py, pz = rov.x, rov.y, rov.depth
        dt, gap_min = 0.15, 99.0
        for _ in range(12):
            yaw += clamp(wrap_pi(a - yaw), -self.TURN_FLEE * dt, self.TURN_FLEE * dt)
            pit += clamp(pitch - pit, -4.0 * dt, 4.0 * dt)
            spd += (self.BURST - spd) * min(1.0, 6.0 * dt)
            x += spd * math.cos(pit) * math.cos(yaw) * dt
            y += spd * math.cos(pit) * math.sin(yaw) * dt
            z += spd * math.sin(pit) * dt
            x, y = nearest_in(regions, x, y, self.MARGIN)                 # walls: slide along them
            z = clamp(z, self.MARGIN, max(self.MARGIN, self._floor_here(x, y, regions) - self.MARGIN))
            dx, dy, dz = x - px, y - py, z - pz
            dh = math.hypot(dx, dy)
            if dh > 1e-6:                                                  # the ROV swims straight at us ...
                px += dx / dh * self.ROV_SPEED * dt
                py += dy / dh * self.ROV_SPEED * dt
            pz += clamp(dz, -self.ROV_VSPEED * dt, self.ROV_VSPEED * dt)   # ... but is slow going up and down
            gap_min = min(gap_min, math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2) - 0.45)
        final_gap = math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2) - 0.45
        return gap_min, final_gap, (x, y, z), self._clearance(regions, x, y, z)

    def _enter_flee(self, rov, near):
        self.mode = "flee"
        self.route = []
        self._pick_escape(rov, near)

    def _pick_escape(self, rov, near):
        """Rehearse every direction (level, diving, climbing), keep the one that leaves the most room and distance."""
        regions = self._open_regions(self.depth)
        away = math.atan2(self.y - near[1], self.x - near[0]) if math.hypot(self.x - near[0], self.y - near[1]) > 1e-6 else self.yaw
        wall_weight = 1.2 if self.pinned_t > 0.2 else 0.6          # pinned against a wall: care even more about open water
        best = None
        for k in range(16):
            a = away + (k - 7.5) * 0.4
            for pitch in (0.0, -0.9, 0.9):
                gap_min, final_gap, end, clear = self._rehearse(rov, a, pitch, regions)
                score = gap_min + 0.25 * final_gap + wall_weight * clear + 0.05 * self.rng.random()
                if best is None or score > best[0]:
                    best = (score, end)
        self.target = best[1]
        self.retarget = 0.4
        self.pinned_t = 0.0

    def _pick_next(self, rov):
        """Choose what to do next while calm."""
        self.cruise = self.rng.uniform(*self.CRUISE)
        roll = self.rng.random()
        if roll < 0.2 and self._start_route(rov):               # thread a ring now and then
            pass
        elif self.trusting and roll < 0.7:                      # the ROV is sitting still: go and have a look at it
            self._start_peek(rov)
        else:
            self.target = self._random_point(avoid=None if self.trusting else rov)

    def _start_peek(self, rov):
        self.mode = "peek"
        self.peek_until = self.clock + self.rng.uniform(5.0, 10.0)
        self.peek_local = (1.0 + self.rng.uniform(-0.1, 0.25), self.rng.uniform(-0.18, 0.18), self.rng.uniform(0.0, 0.12))
        self.target = self._peek_point(rov)

    def _peek_point(self, rov):
        """A spot in front of and a little above the ROV's claw, in view of its camera (about 0.8 m from the lens)."""
        x, y, up = rov_shape.local_to_world(rov, *self.peek_local)
        z = clamp(-up + 0.03 * math.sin(2.0 * self.clock), self.MARGIN, POOL_MAX_DEPTH - self.MARGIN)     # a gentle bob
        x, y = nearest_in(self._open_regions(z), x, y, self.MARGIN)
        return (x, y, z)

    def _start_route(self, rov):
        """Plan a swim through one of the rings: in one side, through the middle, out the other."""
        rings = [p for p in rov.props if getattr(p, "type", "") == "ring" and not p.held and not p.hooked]
        if not rings:
            return False
        ring = self.rng.choice(rings)
        nx, ny = -math.sin(ring.yaw), math.cos(ring.yaw)                 # the hoop's axis (horizontal)
        side = 1 if (self.x - ring.x) * nx + (self.y - ring.y) * ny >= 0 else -1
        pts = [(ring.x + side * nx * k, ring.y + side * ny * k, ring.depth) for k in (0.6, 0.0, -0.6)]
        regions = self._open_regions(ring.depth)
        for x, y, _z in pts:                                               # both ends must be in open water
            qx, qy = nearest_in(regions, x, y, self.MARGIN)
            if abs(qx - x) + abs(qy - y) > 1e-6:
                return False
        self.mode, self.route, self.route_ring = "route", pts, ring
        self.route_center = (ring.x, ring.y, ring.depth)
        self.target = pts[0]
        return True

    def _update_route(self, rov):
        ring = self.route_ring
        c = self.route_center
        if (not self.route or ring.held or ring.hooked
                or math.dist((ring.x, ring.y, ring.depth), c) > 0.25):       # the ring was moved or picked up: forget it
            self.mode, self.route, self.target = "wander", [], None
            return
        self.target = self.route[0]
        if math.dist((self.x, self.y, self.depth), self.target) < 0.18:
            self.route.pop(0)
            if not self.route:
                self.mode, self.target = "wander", None

    # ------------------------------------------------------------------ per-step
    def _closing_speed(self, rov):
        """How fast the ROV is approaching the fish right now (m/s, 0 if it is moving away or across)."""
        c, s = math.cos(rov.yaw), math.sin(rov.yaw)
        vx, vy, vz = rov.u * c - rov.v * s, rov.u * s + rov.v * c, -rov.w          # vz: up
        dx, dy, dz = self.x - rov.x, self.y - rov.y, -self.depth + rov.depth
        d = math.sqrt(dx * dx + dy * dy + dz * dz)
        return max(0.0, (vx * dx + vy * dy + vz * dz) / d) if d > 1e-6 else 0.0

    def _update_trust(self, rov, dt):
        active = (math.hypot(rov.u, rov.v) > 0.1 or abs(rov.r) > 0.1 or abs(rov.w) > 0.35
                  or any(abs(v) > 0.05 for v in rov.cmd.values()))
        self.idle_t = 0.0 if active else self.idle_t + dt
        self.trusting = self.idle_t > self.IDLE_AFTER

    def step(self, rov, dt):
        self.clock += dt
        self._update_trust(rov, dt)
        gap, near = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        self.retarget -= dt
        flee_at, calm_at = (self.FLEE_AT_TRUST, self.CALM_AT_TRUST) if self.trusting else (self.FLEE_AT, self.CALM_AT)
        closing = self._closing_speed(rov)                      # a ROV rushing in is noticed from further away
        flee_at += self.REACTION * closing
        calm_at += self.REACTION * closing
        if gap < flee_at:
            if self.mode != "flee" or self.retarget <= 0 or self.pinned_t > 0.3:
                self._enter_flee(rov, near)
        elif self.mode == "flee" and gap > calm_at:
            self.mode, self.target = "wander", None

        if self.mode == "peek":
            if not self.trusting or self.clock > self.peek_until:
                self.mode, self.target = "wander", None
            else:
                self.target = self._peek_point(rov)
        elif self.mode == "route":
            self._update_route(rov)
        if self.mode == "wander" and self.target is None:
            self._pick_next(rov)
        self.dm = self.RING_MARGIN if self.mode == "route" else self.MARGIN

        tx, ty, td = self.target
        dx, dy, dd = tx - self.x, ty - self.y, td - self.depth
        hdist = math.hypot(dx, dy)
        if self.mode == "wander" and hdist < 0.25 and abs(dd) < 0.25:
            self.target = None                                  # arrived: choose something else next step
        flee = self.mode == "flee"
        turn = self.TURN_FLEE if flee else self.TURN_CRUISE
        near_target = math.dist((self.x, self.y, self.depth), (tx, ty, td)) < 0.3
        if self.mode == "peek" and near_target:                 # hovering in front of the camera: look into it
            cx, cy, _cu = rov_shape.local_to_world(rov, *rov_shape.CAM_POS)
            want_yaw = math.atan2(cy - self.y, cx - self.x)
            want = 0.04
        else:
            want_yaw = math.atan2(dy, dx) if hdist > 0.05 else self.yaw
            if flee:
                want = self.BURST
            elif self.mode == "route":
                want = 0.2 if math.dist((self.x, self.y, self.depth), self.route_center) < 0.4 else 0.3
            elif self.mode == "peek":
                want = 0.3
            else:
                want = self.cruise * clamp(hdist / 0.5, 0.4, 1.0)
        self.yaw = wrap_pi(self.yaw + clamp(wrap_pi(want_yaw - self.yaw), -turn * dt, turn * dt))
        self.speed += (want - self.speed) * min(1.0, (6.0 if flee else 3.0) * dt)
        lim = self.PITCH_FLEE if flee else self.PITCH_CRUISE
        want_pitch = clamp(math.atan2(dd, max(hdist, 0.2)), -lim, lim)
        self.pitch += clamp(want_pitch - self.pitch, -(4.0 if flee else 1.5) * dt, (4.0 if flee else 1.5) * dt)

        hv = self.speed * math.cos(self.pitch)
        self.x += hv * math.cos(self.yaw) * dt
        self.y += hv * math.sin(self.yaw) * dt
        self.depth += self.speed * math.sin(self.pitch) * dt
        bumped = self._keep_in_water()
        self.pinned_t = self.pinned_t + dt if (bumped and flee) else 0.0
        if bumped and self.mode == "wander":
            self.target = None                                  # touched a wall: pick a new destination

        self._keep_clear(rov)
        self.gap = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))[0]      # reported AFTER the correction

    def _keep_in_water(self):
        """Walls, floor and surface (and the step: only the regions open at this depth). True if a wall had to stop it."""
        x, y = nearest_in(self._open_regions(self.depth), self.x, self.y, self.MARGIN if self.mode != "route" else 0.1)
        moved = abs(x - self.x) + abs(y - self.y) > 1e-6
        self.x, self.y = x, y
        self.depth = clamp(self.depth, self.MARGIN, max(self.MARGIN, self._floor_here(x, y) - self.dm))
        return moved

    def _keep_clear(self, rov):
        """The rule that makes it uncatchable: stay SAFE_HARD metres from the ROV's surface, whatever happens."""
        gap, near = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        if gap >= self.SAFE_HARD:
            return
        p = (self.x - near[0], self.y - near[1], -self.depth - near[2])
        n = math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
        if n < 1e-6:
            p, n = (math.cos(self.yaw), math.sin(self.yaw), 0.0), 1.0
        out = self.SAFE_HARD + 0.03                               # push it out along the line from the ROV's surface
        self.x = near[0] + p[0] / n * out
        self.y = near[1] + p[1] / n * out
        self.depth = clamp(-(near[2] + p[2] / n * out), 0.0, POOL_MAX_DEPTH)
        self._keep_in_water()
        gap2, _ = rov_shape.distance_to_rov(rov, (self.x, self.y, -self.depth))
        if gap2 < self.SAFE_HARD - 0.02:                          # cornered: dart to the free spot farthest from the ROV
            best = None
            for _ in range(40):
                x, y, d = self._random_point()
                g, _n = rov_shape.distance_to_rov(rov, (x, y, -d))
                if best is None or g > best[0]:
                    best = (g, x, y, d)
            _, self.x, self.y, self.depth = best
            self.yaw = math.atan2(self.y - rov.y, self.x - rov.x)
            self.darts += 1
        self._enter_flee(rov, near)

    # ------------------------------------------------------------------ report
    def state(self):
        return {"type": "fish", "x": self.x, "y": self.y, "depth": self.depth, "yaw": self.yaw,
                "pitch": self.pitch, "speed": self.speed, "flee": self.mode == "flee", "mode": self.mode,
                "color": self.color}


FISH_COLORS = [0xff7a2a, 0xffb703, 0xf2efe6]


def add_to(rov, n=1):
    """Called by the runners: put n fish in the pool (0 to 3)."""
    for i in range(max(0, min(int(n), 3))):
        rov.props.append(Fish(seed=11 + 7 * i, color=FISH_COLORS[i % len(FISH_COLORS)]))
