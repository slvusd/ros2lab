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
# A jet (turbulent round jet, game-sized): on the axis the speed is min(U0, K / s) at distance s from the nozzle; across the jet it falls off
# as a Gaussian, exp(-(r / b)^2), where b = R0 + SPREAD * s is how wide the jet has grown. Where the two jets overlap the speeds add.
#
# This whole file is an add-on. To remove it: delete this file and web/jets.js (and sim/current.js). The runners' "try: import rov_current"
# blocks skip quietly when it is missing; the core physics only knows "a prop may have a flow() method".
# =============================================================================
import math

from rov_physics import POOL_REGIONS

U0 = 1.5          # m/s at the nozzle
D = 0.08          # m, nozzle diameter
K = 6.3 * D * U0  # axial speed = K / s beyond s = K / U0 (about 0.5 m): the usual round-jet decay
R0, SPREAD = D / 2, 0.16   # half-width b(s) = R0 + SPREAD * s


class Jets:
    type = "jets"

    def __init__(self):
        self.reset()

    def reset(self):
        main = max(POOL_REGIONS, key=lambda r: r[4])                   # the deep end
        shelf = [r for r in POOL_REGIONS if r is not main and abs(r[2] - main[3]) < 1e-9]
        wall_x1 = min([r[0] for r in shelf], default=main[1])          # the +y wall runs from the near end to where the shallow end opens off it
        x = (main[0] + wall_x1) / 2                                    # the middle of that wall
        self.length = main[3] - main[2]                                # the jets cross the pool and stop at the far wall
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
        return {"type": "jets", "outlets": [dict(o) for o in self.outlets], "length": self.length, "u0": U0, "k": K, "r0": R0, "spread": SPREAD}


def add_to(rov, on=True):
    """Called by the runners: put the two water outlets in the pool (when `on`)."""
    if on:
        rov.props.append(Jets())
