# =============================================================================
# rov_physics.py — the ROV's physics + the tiny web server. NO ROS in here.
# =============================================================================
# Shared by rov_sim.py (ROS 2 topics drive it) and keyboard_sim.py (the browser's
# keyboard drives it). Tune the feel of the vehicle here, in one place.
#
# PHYSICS  (approximate on purpose — "feels like water", not a research model)
#   THRUSTERS (each command is -1.0 .. 1.0):
#     t1  left,  horizontal, pushes forward   (red, port side)
#     t2  right, horizontal, pushes forward   (green, starboard side)
#     t3  front, vertical,   pushes up        (near the nose)
#     t4  rear,  vertical,   pushes up        (near the tail)
#   There is no "forward" or "turn" command: if t1 and t2 are equal the ROV drives straight, if they
#   differ it turns. t3 + t4 heave it up and down, and if they differ it tilts (pitch). A real ROV has
#   6-8 thrusters; adding t5.. later means extending cmd and step() below.
#   (internally: T_LEFT, T_RIGHT, T_FRONT, T_REAR)
#   Water pushes back with linear + quadratic drag, and the vehicle's mass is
#   increased ("added mass") because it has to shove water out of the way.
#   Result: speeds up gradually, coasts to a stop, can't go through pool walls.
#   The ROV is slightly POSITIVELY buoyant (like a real one): with thrusters off it drifts up
#   and floats with the top of the frame just out of the water. Pushing it down needs thrust.
#   An IMU is simulated from the motion: tilt, rotation rate, and acceleration (what a real
#   accelerometer reads, so +9.8 m/s^2 up when sitting still).
# =============================================================================
import json
import math
import os
import random
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

# THE POOL (metres): a list of rectangles seen from above, each with the depth of its floor. They must touch along
# their edges to form one connected pool. x is along the pool, y to the left of the ROV's start heading, depth is
# measured down from the surface. The page draws whatever is listed here, so you can reshape the pool by editing it.
#
#   y
#   4.0 |            +--------+        <- the SHALLOW END (1 m deep), off to the left at the far end
#       |            | shallow|
#   1.5 +------------+--------+
#       |      deep end (2 m)  |      <- the original pool: 6 m x 3 m
#  -1.5 +----------------------+
#      -3.0         0.5       3.0   x
POOL_REGIONS = [
    (-3.0, 3.0, -1.5, 1.5, 2.0),     # x0, x1, y0, y1, floor depth: the deep end
    (0.5, 3.0, 1.5, 4.0, 1.0),       # the shallow end: a 1 m deep shelf, joined to the deep end along y = 1.5
]
POOL_MAX_DEPTH = max(r[4] for r in POOL_REGIONS)
ROV_HALF = 0.25                       # ROV is ~0.5 m on a side (to the middle of the frame pipes)
ROV_BOTTOM = 0.28                     # lowest point below the centre: the bottom pipes (radius 1.4 cm) and the tool/thruster
                                      # clamps hang below the pipe centre line, so the floor stops THIS, not ROV_HALF
START = dict(x=-1.5, y=0.0, depth=0.8, yaw=0.0)

SIDE_THRUST = 0.5    # the red (t1) and green (t2) thrusters give this fraction of max_thrust at a command of 1.0: the normal ("1x") speed.
                     # The `speed` setting multiplies it (0.25 .. 4). It was 1.0 before; halved so the ROV is easier to drive.
TURN_ARM = 0.22      # m: thruster offset from centre line (torque = diff * arm)
INERTIA = 1.2        # kg m^2 about the vertical axis, incl. added mass
LIN_DRAG, QUAD_DRAG = 6.0, 10.0      # forward/vertical: N per (m/s), N per (m/s)^2
YAW_LIN, YAW_QUAD = 1.6, 1.0         # rotation drag
HEAVE_MASS_BOOST = 1.5               # moving up/down shoves more water (flat frame)
CLAW_TIME = 0.6                      # seconds to open or close

# Surface and floor behaviour (skipped with hard_limits=True, the old "stop dead" walls)
SURF_DEPTH = ROV_HALF   # depth at which the top of the cube reaches the water surface
BUOYANCY = 1.5          # N of spare buoyancy when fully submerged (positive = floats up, gently)
BUOYANCY_MODES = {"positive": BUOYANCY, "neutral": 0.0, "negative": -BUOYANCY}   # the page's Buoyancy button
EMERGE_SOFT = 0.08      # the first 8 cm out is just the top bars and a bit of foam: buoyancy falls slowly ...
EMERGE_K1 = 25.0        # ... N per metre for that first stretch (BUOYANCY 1.5 N floats it with ~6 cm out)
EMERGE_K2 = 140.0       # ... and faster after that: the frame is mostly open, so lifting it further is harder.
                        # At 80% up-thrust (9.6 N) it rests ~14 cm out
EMERGE_DAMP = 45.0      # N per (m/s) while poking out: slapping the surface slows it, bobbing dies out
EMERGE_MAX = 0.45       # can't rise more than this far out of the water
FLOOR_BOUNCE = 0.2      # fraction of speed kept when it hits the pool floor
THRUSTER_UP = -0.15     # height of the vertical thruster above the ROV centre (m); negative = low on the frame.
                        # Its propeller only works while under water, so a high mount stops the ROV rising
                        # as far (try +0.15 to see the old, top-mounted behaviour)
# Pitch (nose up/down tilt). Torques are nose-DOWN positive (about the ROV's left axis, like REP-103).
CORNER_SHARE = 0.75   # a tilted corner thruster (8-thruster layout) gives this fraction of what a horizontal one gives
VERT_ARM = 0.2          # m: front/rear vertical thrusters sit this far ahead of / behind the centre
PITCH_I = 0.6           # kg m^2, incl. added mass
PITCH_KS = 16.8         # N m per rad: buoyancy keeps it level (a 1.7 N m load tilts it ~6 degrees)
PITCH_DS = 3.0          # N m per (rad/s): water damps the swing
MAX_PITCH = 0.6         # rad (~35 degrees)
# Roll (heeling over sideways) works like pitch: a spring from buoyancy, damping from the water. Only a current (the water pushing the frame) makes it roll.
# Roll is positive with the TOP of the ROV going to its right (right side down). It is shown on the page and in the IMU; the collision shape ignores it.
ROLL_I = 0.6            # kg m^2, incl. added mass
ROLL_KS = 12.0          # N m per rad
ROLL_DS = 3.0           # N m per (rad/s)
MAX_ROLL = 0.6          # rad (~35 degrees)
# How a current tilts the ROV: the water's push on the frame acts this far above its middle (so a push from the side heels it over, and a push from
# ahead or behind pitches it), plus the difference between the push on the top of the frame and on the bottom (a jet that hits only the upper part).
TILT_ARM, SHEAR_ARM = 0.30, 0.20   # m: for pitch
ROLL_ARM, ROLL_SHEAR = 0.55, 0.35   # m: for roll (a sideways push is weaker than a head-on one, so a longer lever shows it)
G = 9.81

# Footprint seen from above, metres from the centre (x forward, y left): the frame plus the side
# thrusters, and the tip of the front tool. The walls stop THIS shape, so turning near a wall works.
BODY_HX, BODY_HY, TOOL_TIP = 0.26, 0.33, 0.60


T_LEFT, T_RIGHT, T_FRONT, T_REAR = "t1", "t2", "t3", "t4"      # thruster channel names (see the table above)


# THRUSTER LAYOUTS: 3, 4 (the original), 6 or 8 thrusters. Each thruster is a dict:
#   name   the channel (t1 ... t8)             kind  "h" horizontal (pushes along (dx, dy)) or "v" vertical (pushes up for a + command)
#   x, y   its LEVER ARM for the torques: metres ahead of / to the LEFT of the ROV's middle
#   gx, gy where it is drawn and where its solid parts are for collisions (metres, same axes)
#   dx, dy for a horizontal one: the direction a + command pushes the ROV (a unit vector)
#   label  a short name for the page; color  "red" (left) / "green" (right) / "white" for the page's model
# 3:  t1 left, t2 right (horizontal, on the sides), t3 one vertical in the middle
# 4:  t1 left, t2 right, t3 front vertical, t4 rear vertical (the original; what a scout ROV often has)
# 6:  t1-t4 horizontal on the four vertical posts, angled 45 degrees in an "X" (front left, front right, rear left, rear right: so it can also slide
#     sideways), t5 front vertical, t6 rear vertical (where t3 and t4 are in the 4-thruster layout)
# 8:  one thruster just outside EACH of the cube's 8 corners, all tilted 45 degrees: t1-t4 on the top corners and t5-t8 on the bottom ones (front left,
#     front right, rear left, rear right). Seen from above each points along the same "X" diagonal as the 6-layout's posts; it also leans up (top corners)
#     or down (bottom corners) by 45 degrees, so it is 45 / 135 degrees to the PVC. Eight directions give all six movements (kind "c": it has a z lever arm and dz)
# A horizontal thruster gives max_thrust * SIDE_THRUST * speed newtons at a command of 1.0, a vertical one max_thrust / 2, a corner one CORNER_SHARE of a horizontal one.
_C = math.sqrt(0.5)


def _h(name, x, y, gx, gy, dx, dy, label, color):
    return {"name": name, "kind": "h", "x": x, "y": y, "z": 0.0, "gx": gx, "gy": gy, "gz": 0.0, "dx": dx, "dy": dy, "dz": 0.0, "label": label, "color": color}


def _v(name, x, y, gx, gy, label):
    return {"name": name, "kind": "v", "x": x, "y": y, "z": 0.0, "gx": gx, "gy": gy, "gz": 0.0, "dx": 0.0, "dy": 0.0, "dz": 0.0, "label": label, "color": "white"}


def _c(name, sx, sy, sz, label):
    """A thruster at the corner (sx, sy, sz = +-1: ahead/behind, left/right, top/bottom), 45 degrees up or down from the 6-layout's horizontal diagonal."""
    return {"name": name, "kind": "c", "x": 0.25 * sx, "y": 0.25 * sy, "z": 0.25 * sz, "gx": 0.30 * sx, "gy": 0.30 * sy, "gz": 0.30 * sz,
            "dx": 0.5 * sx, "dy": -0.5 * sy, "dz": sz * _C, "label": label, "color": "red" if sy > 0 else "green"}


_CORNERS = [(1, 1, "front left"), (1, -1, "front right"), (-1, 1, "rear left"), (-1, -1, "rear right")]


_SIDES = [_h("t1", 0.0, 0.22, 0.0, 0.32, 1.0, 0.0, "left", "red"), _h("t2", 0.0, -0.22, 0.0, -0.32, 1.0, 0.0, "right", "green")]
_POSTS = [_h("t1", 0.25, 0.25, 0.30, 0.30, _C, -_C, "front left", "red"), _h("t2", 0.25, -0.25, 0.30, -0.30, _C, _C, "front right", "green"),
          _h("t3", -0.25, 0.25, -0.30, 0.30, _C, _C, "rear left", "red"), _h("t4", -0.25, -0.25, -0.30, -0.30, _C, -_C, "rear right", "green")]
THRUSTER_LAYOUTS = {
    3: _SIDES + [_v("t3", 0.0, 0.0, 0.0, 0.0, "vertical")],
    4: _SIDES + [_v("t3", 0.2, 0.0, 0.17, 0.0, "front"), _v("t4", -0.2, 0.0, -0.17, 0.0, "rear")],
    6: _POSTS + [_v("t5", 0.2, 0.0, 0.17, 0.0, "front vertical"), _v("t6", -0.2, 0.0, -0.17, 0.0, "rear vertical")],
    8: [_c("t%d" % (i + 1), sx, sy, 1, lab + " top") for i, (sx, sy, lab) in enumerate(_CORNERS)]
       + [_c("t%d" % (i + 5), sx, sy, -1, lab + " bottom") for i, (sx, sy, lab) in enumerate(_CORNERS)],
}


def layout_for(n):
    """The thruster layout for n thrusters (3, 4, 6 or 8); anything else gives the original 4."""
    return THRUSTER_LAYOUTS.get(int(n), THRUSTER_LAYOUTS[4])


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def floor_at(x, y):
    """Depth of the pool floor under (x, y): the deepest region containing that point, or None outside the pool."""
    ds = [r[4] for r in POOL_REGIONS if r[0] - 1e-9 <= x <= r[1] + 1e-9 and r[2] - 1e-9 <= y <= r[3] + 1e-9]
    return max(ds) if ds else None


def nearest_in(regions, x, y, margin=0.0):
    """The closest point to (x, y) that lies inside the union of the rectangles (each shrunk by `margin`)."""
    best = None
    for r in regions:
        x0, x1, y0, y1 = r[0] + margin, r[1] - margin, r[2] + margin, r[3] - margin
        if x0 > x1 or y0 > y1:
            continue
        qx, qy = clamp(x, x0, x1), clamp(y, y0, y1)
        d = (qx - x) ** 2 + (qy - y) ** 2
        if best is None or d < best[0]:
            best = (d, qx, qy)
    return (best[1], best[2]) if best else (x, y)


class Rov:
    """The vehicle. Set .cmd / .claw_target, call step(dt) ~60 times a second."""

    def __init__(self, max_thrust=12.0, mass=8.0, buoyancy=BUOYANCY, hard_limits=False, tool="claw", imu_noise=0.0, imu_resolution=0.0, speed=1.0, thrusters=4):
        self.max_thrust, self.mass, self.buoyancy = max_thrust, mass, buoyancy
        self.speed_mult = clamp(float(speed), 0.25, 4.0)    # multiplies the red / green thrusters' power (1.0 = normal)
        self.hard_limits = hard_limits
        self.tool = tool            # front tool: "claw" (servo jaws) or "nose" (fixed upturned bar)
        self.props = []             # optional extras in the pool (see rov_props.py); each has reset/step/state
        self.claw_floor = 0.0       # an extra can hold the jaws open a little (a ring between them)
        self.claw_holder = None     # the extra currently gripped in the claw, if any (only one at a time)
        self.thruster_up = THRUSTER_UP
        self.pitch = self.pitch_rate = 0.0   # radians, positive = nose DOWN
        self.roll = self.roll_rate = 0.0     # radians, positive = right side DOWN (the top goes to the right)
        self.pitch_torque = 0.0              # extras (a hanging ring) add to this each step, N m nose-down
        self.imu_noise = imu_noise           # std-dev of Gaussian noise on the IMU readings (0 = clean)
        self.imu_resolution = imu_resolution # accelerometer step in m/s^2 (0 = exact; 0.01 like a BNO055, 0.0006 like an MPU-6050)
        self.imu_acc = (0.0, 0.0, G)         # what the accelerometer reads (body frame, m/s^2)
        # event counters (never reset): the page splashes / puffs silt when they change
        self.splash_n = self.floor_n = 0
        self.splash_v = self.floor_v = 0.0
        self.cmd = {}                   # thruster commands, each -1..1, by channel name (t1 ... t3, t4, t6 or t8: see THRUSTER_LAYOUTS)
        self.set_layout(thrusters)
        self.claw_target = 0.0          # servo command: 0 closed .. 1 fully open
        self.reset()

    def reset(self):
        self.props = [p for p in self.props if not getattr(p, "transient", False)]     # rings dropped into the pool disappear on Reset
        self.x, self.y, self.depth, self.yaw = (START[k] for k in ("x", "y", "depth", "yaw"))
        self.u = self.v = self.w = self.r = 0.0   # speeds: forward, sideways, down, yaw rate
        self.claw = 0.0
        for k in self.cmd:
            self.cmd[k] = 0.0
        self.pitch = self.pitch_rate = 0.0
        self.roll = self.roll_rate = 0.0
        self.claw_holder = None
        self._depth_before = self.depth
        self._prev = (0.0, 0.0, 0.0, 0.0)                 # last step's u, v, w, r (for the accelerometer)
        self.imu_acc = (0.0, 0.0, G)
        for p in self.props:
            p.reset()

    def set_layout(self, n):
        """Switch to 3, 4, 6 or 8 thrusters (any other number gives 4). The commands go back to zero; nothing else changes."""
        self.layout = layout_for(n)
        self.thrusters = len(self.layout)
        self.cmd = {th["name"]: 0.0 for th in self.layout}

    def set_cmd(self, name, value):
        """A thruster command, -1..1. A channel this layout does not have (t5 with 4 thrusters) is ignored: returns False."""
        if name not in self.cmd:
            return False
        self.cmd[name] = clamp(float(value), -1.0, 1.0)
        return True

    def step(self, dt):
        mt, m = self.max_thrust, self.mass
        side = mt * SIDE_THRUST * self.speed_mult                  # what a command of 1.0 gives a horizontal thruster (N)
        h0 = -self.depth + self.thruster_up * math.cos(self.pitch)
        sp_, sr_ = math.sin(self.pitch), math.sin(self.roll)
        fx = fy = yaw_t = 0.0                                      # the horizontal thrusters: force along and across the ROV, and the twist about the vertical
        fv = pitch_t = roll_t = 0.0                                # the vertical ones: total push up, and the twists (nose DOWN +, top-to-the-right +)
        for th in self.layout:
            if th["kind"] == "h":
                f = self.cmd[th["name"]] * side
                fx += f * th["dx"]
                fy += f * th["dy"]
                yaw_t += th["x"] * f * th["dy"] - th["y"] * f * th["dx"]
            elif th["kind"] == "c":
                # a corner thruster tilted 45 degrees: its force has all three parts. It works at 3/4 of a horizontal one (CORNER_SHARE), and a propeller
                # only pushes water while it is under the surface (its height allows for pitch and roll too)
                f = self.cmd[th["name"]] * side * CORNER_SHARE
                f *= clamp(0.5 - (-self.depth + th["z"] * math.cos(self.pitch) - th["x"] * sp_ + th["y"] * sr_) / 0.08, 0.0, 1.0)
                tx, ty, tz = f * th["dx"], f * th["dy"], f * th["dz"]
                fx += tx
                fy += ty
                fv += tz
                yaw_t += th["x"] * ty - th["y"] * tx
                pitch_t += th["z"] * tx - th["x"] * tz                                         # forward above the middle tips the nose down; up ahead lifts it
                roll_t += th["y"] * tz - th["z"] * ty                                          # up on the left lifts the left side; left at the top leans the top left
            else:
                # each vertical thruster is half of max_thrust; a propeller only pushes water while it is under the surface (heights allow for pitch and roll)
                f = self.cmd[th["name"]] * mt / 2
                f *= clamp(0.5 - (h0 - th["x"] * sp_ + th["y"] * sr_) / 0.08, 0.0, 1.0)        # nose down: the front is lower; right side down: the right is lower
                fv += f
                pitch_t -= f * th["x"]                                                         # a push up ahead of the middle lifts the nose (nose DOWN is positive)
                roll_t += f * th["y"]                                                          # a push up on the left lifts the left side (the top goes to the right)
        # the water itself may be moving (a current from the optional jets, rov_current.py): drag works on the speed RELATIVE to the water.
        # With no current this is exactly the old behaviour (the water is still: wx = wy = wd = 0).
        wx, wy, wd = self._water()
        c0, s0 = math.cos(self.yaw), math.sin(self.yaw)
        ur, vr, wr = self.u - (wx * c0 + wy * s0), self.v - (-wx * s0 + wy * c0), self.w - wd
        # forces in the vehicle's own frame
        surge = fx - LIN_DRAG * ur - QUAD_DRAG * ur * abs(ur)
        torque = yaw_t - YAW_LIN * self.r - YAW_QUAD * self.r * abs(self.r)
        # thrust up (+) reduces depth. w = d(depth)/dt, so drag pushes against w
        heave_up = fv + self.buoyancy + LIN_DRAG * wr + QUAD_DRAG * wr * abs(wr)
        if not self.hard_limits:      # cube poking out of the water: less buoyancy, so it sinks back
            out = max(0.0, SURF_DEPTH - self.depth)
            heave_up -= EMERGE_K1 * min(out, EMERGE_SOFT) + EMERGE_K2 * max(0.0, out - EMERGE_SOFT)
            if out > 0:
                heave_up += EMERGE_DAMP * self.w
        sway = fy - LIN_DRAG * 2 * vr            # side-slip dies quickly (keel-like frame); the angled thrusters of the 6 and 8 layouts can push sideways

        self.u += surge / m * dt
        self.v += sway / m * dt
        self.w += -heave_up / (m * HEAVE_MASS_BOOST) * dt
        self.r += torque / INERTIA * dt

        self.yaw += self.r * dt
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        self.x += (self.u * c - self.v * s) * dt
        self.y += (self.u * s + self.v * c) * dt
        prev_depth = self.depth
        self.depth += self.w * dt

        self._depth_before = prev_depth
        self._walls(c, s, prev_depth)
        floor = self._floor_limit(c, s)
        if self.hard_limits:
            if self.depth < 0.15 or self.depth > floor:
                self.depth = clamp(self.depth, 0.15, floor); self.w = 0.0
        else:
            if (prev_depth - SURF_DEPTH) * (self.depth - SURF_DEPTH) < 0 and abs(self.w) > 0.05:
                self.splash_n += 1; self.splash_v = abs(self.w)   # top of cube crossed the surface
            top = SURF_DEPTH - EMERGE_MAX
            if self.depth < top:
                self.depth = top; self.w = max(self.w, 0.0)
            if self.depth > floor:                                # bump the floor, small bounce
                if self.w > 0.05:
                    self.floor_n += 1; self.floor_v = self.w
                self.depth = floor
                self.w = -self.w * FLOOR_BOUNCE if self.w > 0.1 else 0.0

        k = dt / CLAW_TIME
        self.claw += clamp(self.claw_target - self.claw, -k, k)   # servo turns at a fixed speed
        self.claw = max(self.claw, self.claw_floor)
        self.pitch_torque = 0.0
        self.claw_floor = 0.0                # extras that hold something in the jaws set it again below
        for p in self.props:
            p.step(self, dt)
        tp, tr = self._water_torque()                               # what a current does to the tilt (exactly 0, 0 with no current)
        tilt = pitch_t + self.pitch_torque + tp                     # rear pushing up = nose down
        self.pitch_rate += (tilt - PITCH_KS * self.pitch - PITCH_DS * self.pitch_rate) / PITCH_I * dt
        self.pitch = clamp(self.pitch + self.pitch_rate * dt, -MAX_PITCH, MAX_PITCH)
        self.roll_rate += (tr + roll_t - ROLL_KS * self.roll - ROLL_DS * self.roll_rate) / ROLL_I * dt
        self.roll = clamp(self.roll + self.roll_rate * dt, -MAX_ROLL, MAX_ROLL)
        self._accelerometer(dt)

    def _flow_at(self, x, y, depth):
        """The water's velocity at a point: (world x, world y, DOWN) in m/s. Any prop with a flow(x, y, depth) method moves the water
        (the jets in rov_current.py do); with none, the water is still."""
        wx = wy = wd = 0.0
        for p in self.props:
            f = getattr(p, "flow", None)
            if f is not None:
                a, b, c = f(x, y, depth)
                wx += a
                wy += b
                wd += c
        return wx, wy, wd

    def _water(self):
        """The water's own velocity at the ROV's middle."""
        return self._flow_at(self.x, self.y, self.depth)

    def _water_torque(self):
        """The twist a current gives the frame: (pitch torque, nose DOWN +; roll torque, top-to-the-right +), N m. The push of the water is worked
        out at the top, middle and bottom of the frame (a jet usually hits only part of it), from the water's speed RELATIVE to the ROV: a ROV carried
        along with the water is not pushed over, one held against it is. It fades in with the strength of the current, so with the water still it is
        exactly (0.0, 0.0) and driving about does not tilt the ROV."""
        if not any(getattr(p, "flow", None) is not None for p in self.props):
            return 0.0, 0.0
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        forces, strongest = [], 0.0
        for dz in (-ROV_HALF, 0.0, ROV_HALF):                       # top (shallower), middle, bottom (deeper)
            wx, wy, _ = self._flow_at(self.x, self.y, self.depth + dz)
            strongest = max(strongest, math.hypot(wx, wy))
            ur, vr = wx * c + wy * s - self.u, -wx * s + wy * c - self.v      # the water's speed along and across the ROV, relative to the ROV
            forces.append((LIN_DRAG * ur + QUAD_DRAG * ur * abs(ur), LIN_DRAG * 2 * vr))
        fade = min(1.0, strongest / 0.1)                              # 0 with still water, 1 once the current is 0.1 m/s or more
        (fxt, fyt), (fxm, fym), (fxb, fyb) = forces
        return fade * (TILT_ARM * fxm + SHEAR_ARM * (fxt - fxb)), -fade * (ROLL_ARM * fym + ROLL_SHEAR * (fyt - fyb))

    def _accelerometer(self, dt):
        """What an IMU's accelerometer reads: the real acceleration minus gravity, in the ROV's own axes
        (x forward, y left, z up), so a level ROV at rest reads (0, 0, +9.8)."""
        u0, v0, w0, r0 = self._prev
        self._prev = (self.u, self.v, self.w, self.r)
        if dt <= 0:
            return
        a_fwd = (self.u - u0) / dt - self.r * self.v           # body-frame acceleration includes the turn term
        a_left = (self.v - v0) / dt + self.r * self.u
        f_up = -(self.w - w0) / dt + G                         # vertical acceleration plus gravity's reaction
        cp, sp = math.cos(self.pitch), math.sin(self.pitch)    # nose-down tilt swings gravity into the x axis
        ax, az = a_fwd * cp - f_up * sp, a_fwd * sp + f_up * cp
        cr, sr = math.cos(self.roll), math.sin(self.roll)      # heeling over swings gravity into the y axis (the up direction leans toward the left)
        ay, az = a_left * cr + az * sr, az * cr - a_left * sr
        n = self.imu_noise
        acc = (ax + random.gauss(0, n), ay + random.gauss(0, n), az + random.gauss(0, n)) if n else (ax, ay, az)
        q = self.imu_resolution
        self.imu_acc = tuple(round(v / q) * q for v in acc) if q else acc

    def imu(self):
        """Simulated IMU reading, ROS REP-103 axes: orientation (roll, pitch, yaw, radians; pitch + = nose down),
        angular velocity (rad/s) and linear acceleration (m/s^2, includes gravity like a real accelerometer)."""
        n = self.imu_noise
        g = (lambda: random.gauss(0, n * 0.1)) if n else (lambda: 0.0)
        return {"roll": self.roll, "pitch": self.pitch, "yaw": self.yaw,
                "gx": self.roll_rate + g(), "gy": self.pitch_rate + g(), "gz": self.r + g(),
                "ax": self.imu_acc[0], "ay": self.imu_acc[1], "az": self.imu_acc[2]}

    def _footprint(self, c, s):
        """World (x, y) of the footprint's corners and the tool tip."""
        pts = [(BODY_HX, BODY_HY), (BODY_HX, -BODY_HY), (-BODY_HX, BODY_HY), (-BODY_HX, -BODY_HY), (TOOL_TIP, 0.0)]
        return [(self.x + c * px - s * py, self.y + s * px + c * py) for px, py in pts]

    def _open_regions(self, depth):
        """The regions the ROV may be over at this depth: those whose floor is deeper than its lowest point."""
        need = depth + ROV_BOTTOM
        return [r for r in POOL_REGIONS if r[4] >= need - 1e-6] or [max(POOL_REGIONS, key=lambda r: r[4])]

    def _floor_limit(self, c, s):
        """Deepest the ROV's centre may go: its lowest point can't pass the floor under ANY part of its footprint.
        Only regions that are open to the ROV count: a region it is too deep to enter (the shallow end, seen from the
        deep end) never limits its depth, so touching a wall can't lift it onto the shelf's floor."""
        regions = self._open_regions(self._depth_before)
        floors = []
        for x, y in self._footprint(c, s):
            ds = [r[4] for r in regions if r[0] - 1e-9 <= x <= r[1] + 1e-9 and r[2] - 1e-9 <= y <= r[3] + 1e-9]
            if ds:
                floors.append(max(ds))
        return (min(floors) if floors else POOL_MAX_DEPTH) - ROV_BOTTOM

    def _walls(self, c, s, depth):
        """Keep the whole footprint (corners, thrusters, tool tip) inside the pool: push the ROV back and cancel the
        part of its motion that goes into the wall, so it slides along it. A region is only open to the ROV while its
        floor is deeper than the ROV's lowest point, so the step up to the shallow end is a wall to a ROV that is
        too deep to pass over it. `depth` is the ROV's depth at the START of this step, so diving while over the
        shelf stops on the shelf floor (see _floor_limit) instead of throwing the ROV off the shelf."""
        open_regions = self._open_regions(depth)
        vx, vy = self.u * c - self.v * s, self.u * s + self.v * c       # velocity in pool coordinates
        for _ in range(4):                                              # fix the worst corner, then look again
            worst = None
            for wx, wy in self._footprint(c, s):
                qx, qy = nearest_in(open_regions, wx, wy)
                dx, dy = qx - wx, qy - wy
                d = dx * dx + dy * dy
                if d > 1e-12 and (worst is None or d > worst[0]):
                    worst = (d, dx, dy)
            if worst is None:
                break
            _, dx, dy = worst
            self.x += dx
            self.y += dy
            if dx > 0: vx = max(vx, 0.0)
            elif dx < 0: vx = min(vx, 0.0)
            if dy > 0: vy = max(vy, 0.0)
            elif dy < 0: vy = min(vy, 0.0)
        self.u, self.v = vx * c + vy * s, -vx * s + vy * c

    def state(self, keys=False):
        return {"x": self.x, "y": self.y, "depth": self.depth, "yaw": self.yaw,
                **self.cmd, "thrusters": self.thrusters, "layout": self.layout, "claw": self.claw,
                "speed": math.sqrt(self.u ** 2 + self.v ** 2 + self.w ** 2),
                "splash_n": self.splash_n, "splash_v": self.splash_v,
                "floor_n": self.floor_n, "floor_v": self.floor_v,
                "props": [p.state() for p in self.props], "tool": self.tool, "pitch": self.pitch, "roll": self.roll, "imu": self.imu(), "buoyancy": self.buoyancy,
                "regions": [list(r) for r in POOL_REGIONS], "keys": keys, "water": list(self._water())}


class Shared:
    """Glue between the simulation loop and the web threads."""
    def __init__(self, keys=False):
        self.lock = threading.Lock()
        self.state = {}
        self.reset_requested = False
        self.keys = keys            # True: the browser may send keyboard commands
        self.commands = {}          # latest keyboard command from the browser
        self.joys = [[0.0, 0.0], [0.0, 0.0]]   # the page's two on-screen joysticks (joy1, joy2): each [axis 0 (left +), axis 1 (up +)]
        self.ros = False            # True when a ROS 2 node is also driving this sim (the page shows the topic list)
        self._kb_prev = {}          # the keyboard command we last acted on
        self.tool_request = None    # "claw" / "nose", set when the page's Tool button is pressed
        self.buoyancy_request = None   # "positive" / "neutral" / "negative", from the page's Buoyancy button
        self.ring_drops = []        # (x, y) spots where the page asked for a new ring (its N key), handled by the sim loop


def apply_ring_drops(shared, rov):
    """Drop the rings the page asked for (the optional add-on rov_props.py does the work; without it nothing happens)."""
    while shared.ring_drops:
        x, y = shared.ring_drops.pop(0)
        try:
            import rov_props
        except ImportError:
            shared.ring_drops.clear()
            return
        rov_props.drop_ring(rov, x, y)


def apply_keyboard(shared, rov):
    """Apply the page's keyboard command to the ROV, but only the channels whose value CHANGED since last time.
    So when a ROS node drives the same ROV, whichever side sends a new value for a thruster last wins, and a
    key you aren't touching doesn't keep overwriting what ROS commanded."""
    c, prev = shared.commands, shared._kb_prev
    for k in rov.cmd:
        if c.get(k, 0.0) != prev.get(k, 0.0):
            rov.set_cmd(k, c.get(k, 0.0))
    if c.get("claw", 0.0) != prev.get("claw", 0.0):
        rov.claw_target = clamp(float(c.get("claw", 0.0)), 0.0, 1.0)
    shared._kb_prev = dict(c)


def make_handler(shared):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=WEB, **kw)

        def log_message(self, *a):          # keep the terminal quiet for students
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self):
            if self.path == "/ping":        # lets the page tell "a sim server is here" from "just a static web host"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"rov_sim")
                return
            if self.path != "/events":
                return super().do_GET()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:                            # push state ~30 times a second
                while True:
                    with shared.lock:
                        data = json.dumps(shared.state)
                    self.wfile.write(f"data: {data}\n\n".encode())
                    self.wfile.flush()
                    time.sleep(1 / 30)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass

        def do_POST(self):
            if self.path == "/reset":
                shared.reset_requested = True
            elif self.path == "/buoyancy":
                n = int(self.headers.get("Content-Length", 0))
                m = self.rfile.read(min(n, 20)).decode("ascii", "ignore").strip()
                if m in BUOYANCY_MODES:
                    shared.buoyancy_request = m
            elif self.path == "/joy":
                try:
                    n = int(self.headers.get("Content-Length", 0))
                    d = json.loads(self.rfile.read(min(n, 200)))
                    i, ax = int(d["n"]) - 1, d["axes"]                 # n is 1 or 2
                    if i in (0, 1):
                        shared.joys[i] = [clamp(float(ax[0]), -1.0, 1.0), clamp(float(ax[1]), -1.0, 1.0)]
                except (ValueError, KeyError, IndexError, TypeError):
                    pass
            elif self.path == "/tool":
                n = int(self.headers.get("Content-Length", 0))
                t = self.rfile.read(min(n, 20)).decode("ascii", "ignore").strip()
                if t in ("claw", "nose"):
                    shared.tool_request = t
            elif self.path == "/ring":
                try:
                    n = int(self.headers.get("Content-Length", 0))
                    d = json.loads(self.rfile.read(min(n, 100)))
                    x, y = float(d["x"]), float(d["y"])
                    if math.isfinite(x) and math.isfinite(y) and len(shared.ring_drops) < 8:
                        shared.ring_drops.append((x, y))
                except (ValueError, KeyError, TypeError):
                    pass
            elif self.path == "/cmd" and shared.keys:
                try:
                    n = int(self.headers.get("Content-Length", 0))
                    shared.commands = json.loads(self.rfile.read(min(n, 1000)))
                except ValueError:
                    pass
            self.send_response(204)
            self.end_headers()

    return Handler


def start_server(shared, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(shared))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
