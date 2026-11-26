# =============================================================================
# rov_current.py — OPTIONAL: two water outlets in the side wall that make a current across the pool (a challenge for the driver and the IMU)
# =============================================================================
# It is not very realistic (a real pool has filter returns, not jets at 1/3 and 2/3 depth), but it gives the ROV something to fight:
# two nozzles in the middle of the pool's +y wall (the side the shallow end is on), at 1/3 and 2/3 of the way down, shoot water straight across
# the pool, as if filling it. Close to a nozzle the water is fast; it spreads out into a cone and slows with distance.
#
# How the ROV feels it: the physics (rov_physics.py) asks every prop that has a flow(x, y, depth) method how fast the water is moving at the
# ROV, and works out drag from the ROV's speed RELATIVE TO THE WATER. So the ROV is pushed along, has to be steered or powered against it,
# and the IMU's accelerometer shows the push, with no special code. Rings, fish and crabs are not affected (only the ROV).
#
# A jet (like a turbulent round jet, but wider and stronger): on the axis the speed is min(U0, K / s) at distance s from the nozzle; across the jet it falls off
# as a Gaussian, exp(-(r / b)^2), where b = R0 + SPREAD * s is how wide the jet has grown. Where the two jets overlap the speeds add.
#
# This whole file is an add-on. To remove it: delete this file and web/jets.js (and sim/current.js). The runners' "try: import rov_current"
# blocks skip quietly when it is missing; the core physics only knows "a prop may have a flow() method".
# =============================================================================
import math

from rov_physics import POOL_REGIONS

# Game-sized: gentle enough to drive against, strong enough to notice. A ROV floating at the SURFACE, well above the nozzles, feels about 0.15 to 0.25 m/s
# across the middle of the pool; at a nozzle's own depth it is stronger (about 0.5 m/s a couple of metres out), and within half a metre of a nozzle it is
# faster than the ROV can swim (its top speed is about 0.84 m/s). Turn all of it up or down with U0 and K together.
U0 = 1.0          # m/s at the nozzle
K = 0.5           # axial speed = K / s beyond s = K / U0 (0.5 m)
R0, SPREAD = 0.04, 0.20    # half-width b(s) = R0 + SPREAD * s


class Jets:
    """The two outlets. They are ALWAYS in the wall (the page draws them whether the water is running or not); `on` says whether water comes out."""
    type = "jets"

    def __init__(self, on=True):
        self.on = on
        self.reset()

    def reset(self):
        main = max(POOL_REGIONS, key=lambda r: r[4])                   # the deep end
        shelf = [r for r in POOL_REGIONS if r is not main and abs(r[2] - main[3]) < 1e-9]
        wall_x1 = min([r[0] for r in shelf], default=main[1])          # the +y wall runs from the near end to where the shallow end opens off it
        x = (main[0] + wall_x1) / 2                                    # the middle of that wall
        self.length = main[3] - main[2]                                # the jets cross the pool and stop at the far wall
        self.floor = main[4]                                           # (the page keeps the stream of bubbles inside the water)
        self.outlets = [{"x": x, "y": main[3], "depth": main[4] * f, "dx": 0.0, "dy": -1.0} for f in (1 / 3, 2 / 3)]

    def step(self, rov, dt):
        pass                                                           # the jets never change

    @staticmethod
    def axial(s):
        """Water speed on the axis of a jet, s metres from its nozzle."""
        return U0 if s * U0 <= K else K / s

    def flow(self, x, y, depth):
        """The water's velocity at this point: (world x, world y, down) in m/s: the sum of both jets."""
        vx = vy = 0.0
        if not self.on:
            return vx, vy, 0.0
        for o in self.outlets:
            rx, ry = x - o["x"], y - o["y"]
            s = rx * o["dx"] + ry * o["dy"]                            # distance along the jet from the nozzle
            if s <= 0.0 or s > self.length:
                continue
            lat = -rx * o["dy"] + ry * o["dx"]                         # sideways distance, across the pool
            r2 = lat * lat + (depth - o["depth"]) ** 2
            b = R0 + SPREAD * s
            v = self.axial(s) * math.exp(-r2 / (b * b))
            vx += v * o["dx"]
            vy += v * o["dy"]
        return vx, vy, 0.0

    def state(self):
        return {"type": "jets", "on": self.on, "outlets": [dict(o) for o in self.outlets], "length": self.length, "floor": self.floor, "u0": U0, "k": K, "r0": R0, "spread": SPREAD}


def add_to(rov, on=True):
    """Called by the runners: put the two outlets in the pool wall. They are always there; `on` says whether the water is running."""
    rov.props.append(Jets(on))
