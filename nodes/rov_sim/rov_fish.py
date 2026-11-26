# =============================================================================
# rov_fish.py — OPTIONAL whimsy: a coy fish that swims around and never lets the ROV catch it
# =============================================================================
# (A current from the water jets, rov_current.py, also shoves the fish along a little: FLOW_PUSH.)
#
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
from rov_physics import POOL_MAX_DEPTH, POOL_WATER, clamp, nearest_in      # (POOL_WATER: the pool proper; the fish keeps out of the stairs)


def wrap_pi(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Fish:
    type = "fish"
    # --- how close it lets the ROV get (distances are to the ROV's surface, metres) ---
    SAFE_HARD = 0.30                  # never closer than this, whatever happens
    FLEE_AT, CALM_AT = 1.6, 2.4       # starts fleeing inside the first, calms down outside the second
    FLEE_AT_TRUST, CALM_AT_TRUST = 0.38, 0.5     # the same, once it trusts a ROV that is sitting still
    IDLE_AFTER = 2.0                  # seconds of a still ROV before it trusts it
    CURIOUS_DELAY = (1.0, 5.0)        # then it takes a moment to decide to go and look
    PEEK_FOR = (8.0, 16.0)            # how long it hovers in view of the camera
    PEEK_COOLDOWN = (8.0, 20.0)       # after a visit it goes away for a while before coming back
    PEEK_SPEED = 0.55                 # m/s: a purposeful swim over to the ROV
    FLOW_PUSH = 0.45                  # a current (the water jets, rov_current.py) carries the fish along by this fraction of the water's speed:
                                      # it swims against it a little, but a strong stream still shoves it about
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
    SURFACE_MARGIN = 0.18             # while peeking it may come this close to the surface (so it can reach a ROV floating there)

    def __init__(self, seed=1, color=0xff7a2a):
        self.seed = seed
        self.color = color
        self.reset()

    # ------------------------------------------------------------------ setup
    def reset(self):
        self.rng = random.Random(self.seed)
        deep = max(POOL_WATER, key=lambda r: r[4])
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
        self.peek_ready = 0.0          # earliest time for the next visit
        self.curious_in = None         # countdown to going over to the ROV once it has gone still
        self.peek_local = (1.0, 0.0, 0.05)
        self.peek_via = None           # a waypoint to swim around the ROV on the way to the viewing spot
        self.pinned_t = 0.0            # how long a fleeing fish has been pressed against a wall
        self.dm = self.MARGIN          # depth margin (smaller while threading a ring)
        self.gap = 99.0                # distance to the ROV's surface, after the last step
        self.darts = 0                 # how many times it had to dart (cornered)

    # ------------------------------------------------------------------ helpers
    def _open_regions(self, depth):
        """Regions a fish at this depth may be over (the shelf is closed to a fish that is too deep)."""
        regs = [r for r in POOL_WATER if r[4] - self.dm >= depth]
        return regs or [max(POOL_WATER, key=lambda r: r[4])]

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
        regs = [r for r in POOL_WATER if r[1] - r[0] > 2 * self.WANDER_MARGIN and r[3] - r[2] > 2 * self.WANDER_MARGIN and r[4] > 0.9]
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
        if self.trusting and self.clock >= self.peek_ready and roll < 0.8 and self._start_peek(rov):
            pass                                                # the ROV is sitting still: go and have a look at it
        elif roll < (0.12 if self.trusting else 0.2) and self._start_route(rov):    # thread a ring now and then
            pass
        else:
            self.target = self._random_point(avoid=None if self.trusting else rov)

    def _start_peek(self, rov):
        """Go and hover in view of the ROV's camera. Returns False if no good spot exists right now."""
        local = self._choose_peek_spot(rov)
        if local is None:
            return False
        self.mode = "peek"
        self.peek_local = local
        self.peek_until = self.clock + self.rng.uniform(*self.PEEK_FOR)
        self.peek_via = None
        self.target = self._peek_point(rov)
        return True

    def _route_around(self, rov, spot):
        """If the straight swim to the viewing spot would pass close to the ROV, return a waypoint beside it to go via."""
        fx, fy, fz = self.x, self.y, self.depth
        dx, dy, dz = spot[0] - fx, spot[1] - fy, spot[2] - fz
        L2 = dx * dx + dy * dy + dz * dz
        if L2 < 1e-6:
            return None
        t = clamp(((rov.x - fx) * dx + (rov.y - fy) * dy + (rov.depth - fz) * dz) / L2, 0.0, 1.0)
        nearest = (fx + dx * t, fy + dy * t, fz + dz * t)
        if math.dist(nearest, (rov.x, rov.y, rov.depth)) > 1.0:
            return None                                          # the straight line is clear
        px, py = -dy, dx                                          # sideways, perpendicular to the swim
        n = math.hypot(px, py) or 1.0
        best = None
        for side in (1, -1):
            wx, wy = rov.x + side * px / n * 1.5, rov.y + side * py / n * 1.5
            qx, qy = nearest_in(self._open_regions(fz), wx, wy, self.MARGIN)
            if abs(qx - wx) + abs(qy - wy) > 1e-6:
                continue                                          # that side is against a wall
            length = math.dist((fx, fy), (wx, wy)) + math.dist((wx, wy), (spot[0], spot[1]))
            if best is None or length < best[0]:
                best = (length, (wx, wy, clamp(0.5 * (fz + spot[2]), self.MARGIN, POOL_MAX_DEPTH - self.MARGIN)))
        return best[1] if best else None

    def _choose_peek_spot(self, rov):
        """The nearest spot to the camera lens that is in its picture, above the claw, and that the fish is happy with:
        inside the water it may use, and far enough from every part of the ROV that it won't spook itself."""
        tilt = rov_shape.CAM_TILT
        want_gap = self.FLEE_AT_TRUST + 0.05                       # (hovering is stationary now, so no need for a big margin)
        best = None
        for dist in (0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.8, 2.2):
            for dlat in (0.0, 0.12, -0.12, 0.25, -0.25):
                for dup in (0.0, 0.08, 0.16, 0.25, 0.35, 0.45):      # on the axis, or higher (away from the claw)
                    local = (rov_shape.CAM_POS[0] + dist * math.cos(tilt), dlat * dist,
                             rov_shape.CAM_POS[2] - dist * math.sin(tilt) + dup)
                    x, y, up = rov_shape.local_to_world(rov, *local)
                    z = -up
                    if not self.SURFACE_MARGIN <= z <= self._floor_here(x, y, self._open_regions(z)) - self.MARGIN:
                        continue
                    qx, qy = nearest_in(self._open_regions(z), x, y, self.MARGIN)
                    if abs(qx - x) + abs(qy - y) > 1e-6:
                        continue
                    if rov_shape.distance_to_rov(rov, (x, y, up))[0] < want_gap:
                        continue
                    score = dist + 0.5 * abs(dlat) + 0.5 * dup + 0.02 * self.rng.random()
                    if best is None or score < best[0]:
                        best = (score, local)
            if best is not None and dist >= 0.9:
                break                                               # found something near enough; don't look further
        return best[1] if best else None

    def _peek_point(self, rov):
        """The chosen viewing spot in world coordinates (it follows the ROV if it moves slightly), with a gentle bob."""
        x, y, up = rov_shape.local_to_world(rov, *self.peek_local)
        z = clamp(-up + 0.03 * math.sin(2.0 * self.clock), self.SURFACE_MARGIN, POOL_MAX_DEPTH - self.MARGIN)
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
        was = self.trusting
        self.trusting = self.idle_t > self.IDLE_AFTER
        if self.trusting and not was:                           # just decided the ROV is harmless: go and look soon
            self.curious_in = self.rng.uniform(*self.CURIOUS_DELAY)
        elif not self.trusting:
            self.curious_in = None

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

        if self.curious_in is not None:
            self.curious_in -= dt
            if self.curious_in <= 0:
                self.curious_in = None
                if self.mode == "wander" and self.clock >= self.peek_ready:
                    self._start_peek(rov)                       # drop what it was doing and swim over
        if self.mode == "peek":
            if not self.trusting or self.clock > self.peek_until:
                self.mode, self.target = "wander", None
                self.peek_ready = self.clock + self.rng.uniform(*self.PEEK_COOLDOWN)
            else:
                spot = self._peek_point(rov)
                if self.peek_via is None and math.dist((self.x, self.y, self.depth), spot) > 1.2:
                    self.peek_via = self._route_around(rov, spot)             # don't swim through the ROV
                if self.peek_via is not None and math.dist((self.x, self.y, self.depth), self.peek_via) < 0.35:
                    self.peek_via = None
                self.target = self.peek_via if self.peek_via is not None else spot
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
        dist3 = math.dist((self.x, self.y, self.depth), (tx, ty, td))
        if self.mode == "peek" and self.peek_via is None and dist3 < 0.12:
            cx, cy, _cu = rov_shape.local_to_world(rov, *rov_shape.CAM_POS)    # at the spot: stop, and look into the camera
            want_yaw = math.atan2(cy - self.y, cx - self.x)
            want = 0.0
        else:
            want_yaw = math.atan2(dy, dx) if hdist > 0.05 else self.yaw
            if flee:
                want = self.BURST
            elif self.mode == "route":
                want = 0.2 if math.dist((self.x, self.y, self.depth), self.route_center) < 0.4 else 0.3
            elif self.mode == "peek":
                want = self.PEEK_SPEED * clamp(dist3 / 1.0, 0.12, 1.0)   # a purposeful swim, slowing right down as it arrives
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
        flow_at = getattr(rov, "_flow_at", None)                # the water itself may be moving: a stream shoves the fish a bit
        if flow_at is not None:
            wx, wy, wd = flow_at(self.x, self.y, self.depth)
            self.x += wx * self.FLOW_PUSH * dt
            self.y += wy * self.FLOW_PUSH * dt
            self.depth += wd * self.FLOW_PUSH * dt
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
        top = self.SURFACE_MARGIN if self.mode == "peek" else self.MARGIN
        self.depth = clamp(self.depth, top, max(top, self._floor_here(x, y) - self.dm))
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
