# =============================================================================
# rov_physics.py — the ROV's physics + the tiny web server. NO ROS in here.
# =============================================================================
# Shared by rov_sim.py (ROS 2 topics drive it) and keyboard_sim.py (the browser's
# keyboard drives it). Tune the feel of the vehicle here, in one place.
#
# PHYSICS  (approximate on purpose — "feels like water", not a research model)
#   Left + right thrusters both push forward; if they differ the ROV turns
#   (differential thrust). Two vertical thrusters (front and rear) push straight up/down;
#   together they heave the ROV, and if they differ they tilt it (pitch).
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

# Pool, metres. x: -L/2..L/2, y: -W/2..W/2, depth: 0 (surface) .. D (floor).
POOL_L, POOL_W, POOL_D = 6.0, 3.0, 2.0
ROV_HALF = 0.25                       # ROV is ~0.5 m on a side (to the middle of the frame pipes)
ROV_BOTTOM = 0.28                     # lowest point below the centre: the bottom pipes (radius 1.4 cm) and the tool/thruster
                                      # clamps hang below the pipe centre line, so the floor stops THIS, not ROV_HALF
START = dict(x=-1.5, y=0.0, depth=0.8, yaw=0.0)

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
VERT_ARM = 0.2          # m: front/rear vertical thrusters sit this far ahead of / behind the centre
PITCH_I = 0.6           # kg m^2, incl. added mass
PITCH_KS = 16.8         # N m per rad: buoyancy keeps it level (a 1.7 N m load tilts it ~6 degrees)
PITCH_DS = 3.0          # N m per (rad/s): water damps the swing
MAX_PITCH = 0.6         # rad (~35 degrees)
G = 9.81

# Footprint seen from above, metres from the centre (x forward, y left): the frame plus the side
# thrusters, and the tip of the front tool. The walls stop THIS shape, so turning near a wall works.
BODY_HX, BODY_HY, TOOL_TIP = 0.26, 0.33, 0.60


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


class Rov:
    """The vehicle. Set .cmd / .claw_target, call step(dt) ~60 times a second."""

    def __init__(self, max_thrust=12.0, mass=8.0, buoyancy=BUOYANCY, hard_limits=False, tool="claw", imu_noise=0.0, imu_resolution=0.0):
        self.max_thrust, self.mass, self.buoyancy = max_thrust, mass, buoyancy
        self.hard_limits = hard_limits
        self.tool = tool            # front tool: "claw" (servo jaws) or "nose" (fixed upturned bar)
        self.props = []             # optional extras in the pool (see rov_props.py); each has reset/step/state
        self.claw_floor = 0.0       # an extra can hold the jaws open a little (a ring between them)
        self.thruster_up = THRUSTER_UP
        self.pitch = self.pitch_rate = 0.0   # radians, positive = nose DOWN
        self.pitch_torque = 0.0              # extras (a hanging ring) add to this each step, N m nose-down
        self.imu_noise = imu_noise           # std-dev of Gaussian noise on the IMU readings (0 = clean)
        self.imu_resolution = imu_resolution # accelerometer step in m/s^2 (0 = exact; 0.01 like a BNO055, 0.0006 like an MPU-6050)
        self.imu_acc = (0.0, 0.0, G)         # what the accelerometer reads (body frame, m/s^2)
        # event counters (never reset): the page splashes / puffs silt when they change
        self.splash_n = self.floor_n = 0
        self.splash_v = self.floor_v = 0.0
        self.cmd = {"left": 0.0, "right": 0.0, "front": 0.0, "rear": 0.0}   # each -1..1 (front/rear = vertical thrusters)
        self.claw_target = 0.0          # servo command: 0 closed .. 1 fully open
        self.reset()

    def reset(self):
        self.x, self.y, self.depth, self.yaw = (START[k] for k in ("x", "y", "depth", "yaw"))
        self.u = self.v = self.w = self.r = 0.0   # speeds: forward, sideways, down, yaw rate
        self.claw = 0.0
        self.cmd.update(left=0.0, right=0.0, front=0.0, rear=0.0)
        self.pitch = self.pitch_rate = 0.0
        self._prev = (0.0, 0.0, 0.0, 0.0)                 # last step's u, v, w, r (for the accelerometer)
        self.imu_acc = (0.0, 0.0, G)
        for p in self.props:
            p.reset()

    def set_cmd(self, name, value):
        self.cmd[name] = clamp(float(value), -1.0, 1.0)

    def step(self, dt):
        mt, m = self.max_thrust, self.mass
        fl, fr = self.cmd["left"] * mt, self.cmd["right"] * mt
        # the two vertical thrusters share the vertical thrust budget: each is half of max_thrust
        ff, fb = self.cmd["front"] * mt / 2, self.cmd["rear"] * mt / 2
        # a propeller only pushes water while it is under the surface (heights allow for pitch)
        h0 = -self.depth + self.thruster_up * math.cos(self.pitch)
        ff *= clamp(0.5 - (h0 - VERT_ARM * math.sin(self.pitch)) / 0.08, 0.0, 1.0)   # nose down: front is lower
        fb *= clamp(0.5 - (h0 + VERT_ARM * math.sin(self.pitch)) / 0.08, 0.0, 1.0)
        fv = ff + fb
        # forces in the vehicle's own frame
        surge = fl + fr - LIN_DRAG * self.u - QUAD_DRAG * self.u * abs(self.u)
        torque = (fr - fl) * TURN_ARM - YAW_LIN * self.r - YAW_QUAD * self.r * abs(self.r)
        # thrust up (+) reduces depth. w = d(depth)/dt, so drag pushes against w
        heave_up = fv + self.buoyancy + LIN_DRAG * self.w + QUAD_DRAG * self.w * abs(self.w)
        if not self.hard_limits:      # cube poking out of the water: less buoyancy, so it sinks back
            out = max(0.0, SURF_DEPTH - self.depth)
            heave_up -= EMERGE_K1 * min(out, EMERGE_SOFT) + EMERGE_K2 * max(0.0, out - EMERGE_SOFT)
            if out > 0:
                heave_up += EMERGE_DAMP * self.w
        sway = -LIN_DRAG * 2 * self.v            # side-slip dies quickly (keel-like frame)

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

        self._walls(c, s)
        floor = POOL_D - ROV_BOTTOM
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
        for p in self.props:
            p.step(self, dt)
        tilt = (fb - ff) * VERT_ARM + self.pitch_torque             # rear pushing up = nose down
        self.pitch_rate += (tilt - PITCH_KS * self.pitch - PITCH_DS * self.pitch_rate) / PITCH_I * dt
        self.pitch = clamp(self.pitch + self.pitch_rate * dt, -MAX_PITCH, MAX_PITCH)
        self._accelerometer(dt)

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
        n = self.imu_noise
        acc = (ax + random.gauss(0, n), a_left + random.gauss(0, n), az + random.gauss(0, n)) if n else (ax, a_left, az)
        q = self.imu_resolution
        self.imu_acc = tuple(round(v / q) * q for v in acc) if q else acc

    def imu(self):
        """Simulated IMU reading, ROS REP-103 axes: orientation (roll, pitch, yaw, radians; pitch + = nose down),
        angular velocity (rad/s) and linear acceleration (m/s^2, includes gravity like a real accelerometer)."""
        n = self.imu_noise
        g = (lambda: random.gauss(0, n * 0.1)) if n else (lambda: 0.0)
        return {"roll": 0.0, "pitch": self.pitch, "yaw": self.yaw,
                "gx": g(), "gy": self.pitch_rate + g(), "gz": self.r + g(),
                "ax": self.imu_acc[0], "ay": self.imu_acc[1], "az": self.imu_acc[2]}

    def _walls(self, c, s):
        """Keep the whole footprint (corners, thrusters, tool tip) inside the pool: push the ROV back
        and cancel the part of its motion that goes into the wall, so it slides along it."""
        pts = [(BODY_HX, BODY_HY), (BODY_HX, -BODY_HY), (-BODY_HX, BODY_HY), (-BODY_HX, -BODY_HY), (TOOL_TIP, 0.0)]
        xs = [self.x + c * px - s * py for px, py in pts]
        ys = [self.y + s * px + c * py for px, py in pts]
        vx, vy = self.u * c - self.v * s, self.u * s + self.v * c       # velocity in pool coordinates
        hx, hy = POOL_L / 2, POOL_W / 2
        if max(xs) > hx:
            self.x -= max(xs) - hx; vx = min(vx, 0.0)
        elif min(xs) < -hx:
            self.x += -hx - min(xs); vx = max(vx, 0.0)
        if max(ys) > hy:
            self.y -= max(ys) - hy; vy = min(vy, 0.0)
        elif min(ys) < -hy:
            self.y += -hy - min(ys); vy = max(vy, 0.0)
        self.u, self.v = vx * c + vy * s, -vx * s + vy * c

    def state(self, keys=False):
        return {"x": self.x, "y": self.y, "depth": self.depth, "yaw": self.yaw,
                "left": self.cmd["left"], "right": self.cmd["right"],
                "front": self.cmd["front"], "rear": self.cmd["rear"], "claw": self.claw,
                "speed": math.sqrt(self.u ** 2 + self.v ** 2 + self.w ** 2),
                "splash_n": self.splash_n, "splash_v": self.splash_v,
                "floor_n": self.floor_n, "floor_v": self.floor_v,
                "props": [p.state() for p in self.props], "tool": self.tool, "pitch": self.pitch, "imu": self.imu(), "buoyancy": self.buoyancy,
                "pool": [POOL_L, POOL_W, POOL_D], "keys": keys}


class Shared:
    """Glue between the simulation loop and the web threads."""
    def __init__(self, keys=False):
        self.lock = threading.Lock()
        self.state = {}
        self.reset_requested = False
        self.keys = keys            # True: the browser may send keyboard commands
        self.commands = {}          # latest keyboard command from the browser
        self.ros = False            # True when a ROS 2 node is also driving this sim (the page shows the topic list)
        self._kb_prev = {}          # the keyboard command we last acted on
        self.tool_request = None    # "claw" / "nose", set when the page's Tool button is pressed
        self.buoyancy_request = None   # "positive" / "neutral" / "negative", from the page's Buoyancy button


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
            elif self.path == "/tool":
                n = int(self.headers.get("Content-Length", 0))
                t = self.rfile.read(min(n, 20)).decode("ascii", "ignore").strip()
                if t in ("claw", "nose"):
                    shared.tool_request = t
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
