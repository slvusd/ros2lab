# rov_sim — a classroom ROV in a 3D pool

A tiny simulator: your ROS 2 code publishes thruster commands, and a PVC-cube
ROV moves in a 3D pool you watch in a browser tab — right next to your code in
VS Code. No Gazebo, no GPU setup, nothing to install beyond the ROS 2 env.

**No ROS? Just want to drive it?** Plain Python, nothing to install:
```
python3 nodes/rov_sim/keyboard_sim.py    # then open http://localhost:8000 and click the page
```
Keys: W/S forward/reverse, A/D turn, R/Space both vertical thrusters up, F/Shift down, I/K tilt nose up/down, Z/C left/right
thruster only, H claw open/close, `[` `]` close/open it gradually, T claw/nose, V reset the view, X stop. Same physics as the ROS version, so tuning
`rov_physics.py` carries over. (Options: `--max-thrust`, `--mass`, `--buoyancy`, `--imu-noise`, `--port`.)

With ROS 2 (after `source mac/env.sh`; the keyboard works here too, see below):
```
python nodes/rov_sim/rov_sim.py          # terminal 1: starts the pool
python nodes/rov_sim/student_example.py  # terminal 2: thrusters ON, then OFF
```
Then in VS Code: **Cmd+Shift+P → "Simple Browser: Show" → `http://localhost:8000`**
and drag that tab to the right side of the window. (Or run the "ROV pool" task:
Cmd+Shift+P → "Tasks: Run Task" → *ROV pool*.)

**Keyboard and ROS together.** `rov_sim.py` (the ROS version) also accepts the page's keyboard, so students can nudge the
ROV by hand while their code runs (turn it off with `-p keys:=false`). Per channel, the **last new value wins**: if your
node publishes `left = 0.5` and you then press an arrow key, the keyboard drives the thrusters you're touching and
releasing a key sets that thruster to 0, while thrusters you aren't touching keep whatever ROS last sent. `keyboard_sim.py`
is the same pool without ROS, for a quick play when no ROS environment is set up.

Check it works: `source mac/env.sh && ./nodes/rov_sim/install.sh` (4 PASS lines).

## A student's first program
Three steps up in difficulty, all against the same running pool (`python nodes/rov_sim/rov_sim.py`):
1. **No code:** `ros2 topic pub -1 /rov/thruster/left std_msgs/msg/Float32 "{data: 0.8}"` (and `0.0` to stop it).
2. **`student_minimal.py`**: about 15 lines of code, both thrusters on for 2 seconds, then off. No classes, no callbacks.
3. **`student_example.py`**: the same job done the usual ROS way, as a node with a timer.
(The 1-second wait in `student_minimal.py` lets the pool notice the new publisher; on one computer a message sent
straight away still arrived in 8 of 8 test runs, but over Wi-Fi to the Pi discovery is slower, so keep it.)

## The vehicle
A cube frame with a **left (red)** and **right (green)** thruster pushing forward,
two **vertical** thrusters (one near the nose, one near the tail), and a front tool you can switch with the
**Tool** button (or `T`), clamped to the front **bottom PVC bar** where tools usually mount: a **claw** (a
servo: the two jaws open and close to pinch from the left and right) or a fixed, gently upturned **nose**. Both side thrusters forward = drive forward; different
speeds = turn (differential thrust). Vertical: `+` up, `-` down; the two vertical thrusters together
lift the ROV, and if they differ they **tilt** it (front up + rear down = nose up).

| Topic | Type | Meaning |
|---|---|---|
| `/rov/thruster/left` | `std_msgs/Float32` | -1.0 (full reverse) .. 1.0 (full forward) |
| `/rov/thruster/right` | `std_msgs/Float32` | same |
| `/rov/thruster/front` | `std_msgs/Float32` | vertical thruster near the nose: +1.0 up .. -1.0 down |
| `/rov/thruster/rear` | `std_msgs/Float32` | vertical thruster near the tail: same |
| `/rov/thruster/vertical` | `std_msgs/Float32` | sets **both** vertical thrusters at once (easy first lesson) |
| `/rov/claw` | `std_msgs/Float32` | claw servo: `0.0` closed .. `1.0` fully open, anything between is partly open |
| `/rov/reset` | `std_msgs/Empty` | back to the start position (also the Reset button) |
| `/rov/imu` | `sensor_msgs/Imu` | published at 50 Hz: tilt (orientation), turn rate and acceleration; see below |
| `/rov/depth` | `std_msgs/Float32` | published: metres below the surface |
| `/rov/heading` | `std_msgs/Float32` | published: degrees, counter-clockwise |

A thruster keeps its last command until you change it (set `0.0` to turn it off).
Quick tries without writing code:
`ros2 topic pub -1 /rov/thruster/left std_msgs/msg/Float32 "{data: 0.8}"`

## What the physics does (approximate on purpose)
Thrust accelerates the ROV; water drag (linear + quadratic) slows it, so it
speeds up gradually and **coasts to a stop** after you turn thrusters off. Extra
"added mass" makes it feel heavy in water. Like a real ROV it is **slightly positively buoyant**
(1.5 N spare): with the thrusters off it drifts up and **floats with the top of the frame ~6 cm out of
the water**, so pushing it down takes a little thrust (about 12% down on the vertical thrusters holds a
depth). The pool walls, floor and surface stop it.
The physics is in `rov_physics.py` (constants at the top). Tweak with parameters, e.g. `python nodes/rov_sim/rov_sim.py --ros-args -p max_thrust:=20.0`
(`max_thrust` N, `mass` kg, `buoyancy` N — `0` = neutral, it hovers wherever you leave it; `imu_noise`, `port`).

## Water FX (experimental, toggle with the **Water FX** button)
On: real refraction at the surface (Snell's law, n = 1.33: submerged things bend and
wobble by an amount that grows with their depth, so a pipe through the surface stays joined at the waterline; from underneath you see the sky only through a circular "window", and the
rest of the surface turns into a dark mirror), plus a small wave simulation. Ripples
spread from the ROV breaking the surface (or dropping back in), from it moving near the
surface, and from bubbles popping, on top of a gentle ambient ripple. Off:
the simple translucent surface (cheaper on slow laptops). Your choice is remembered.

## Surface and floor behaviour
The ROV loses buoyancy as its top comes out of the water (slowly for the first 5 cm, which is just the top bars,
then quickly), so it can **pop up out of the water and sink back**. Floating it rests ~6 cm out; held up at 80% lift
it rests ~14 cm out (more than a quarter of the cube). On the floor it **bumps** (small
bounce, a puff of silt, a little rocking). Constants are at the top of `rov_physics.py`
(`BUOYANCY`, `EMERGE_K1`/`EMERGE_K2`, `EMERGE_MAX`, `FLOOR_BOUNCE`). Want the old stop-dead walls? Start with
`--hard-limits` (keyboard) or `--ros-args -p hard_limits:=true`.

## The pick-up ring (optional add-on)
A slightly buoyant orange hoop with a weight on its bottom edge: it **stands upright on the pool
floor**, facing the ROV's start. Which tool you have selected decides how you lift it:

- **Nose:** drive the nose **through** the ring, then **rise**. The top of the nose meets the ring's
  inner rim and carries it up; the ring hangs from the nose, rides its low part, and swings round as
  you turn (the HUD says "ring hooked"). Lower it onto the floor and back out to leave it. A ring
  hanging in the air only comes off if you set it down first.
- **Claw:** open the claw and put the jaws around the *side* of the rim (a vertical piece of tube, anywhere
  between the jaw hinges and the fingertips; the HUD says "ring between jaws: close!"), then **command the
  claw closed** (a claw command of about 0.25 or less). It grips straight away and the jaws stop at the tube's
  thickness. Command it open again (above about 0.25) to let go. Closing it only partway doesn't clamp. (The top
  and bottom of the rim won't grip: the tube would just slide along the jaws.)

Reset puts the ring back. It's game-style physics, not a contact solver: the nose test is "the nose
crosses the ring's plane inside the hole", then the ring is kept within reach of the nose.

It lives in two files so it's easy to drop: `rov_props.py` and `web/props.js`. **To remove it,
delete those two files** (everything else skips it quietly), or just run with `--no-ring`
(keyboard) / `-p ring:=false` (ROS). The core code only has a small generic "props" hook, plus the
claw/nose choice described next.

## Buoyancy button
The **Buoyancy** button (or `B`) cycles the pool's setting: **floats** (slightly positive, the default) ->
**neutral** (hovers wherever you leave it) -> **sinks** (slightly negative, settles on the floor) -> floats.
It is a setting of the pool, **not a ROS topic**: a real ROV has no buoyancy control. (The `buoyancy`
parameter / `--buoyancy` only sets the value it starts with, in newtons.)

## IMU (`/rov/imu`, `sensor_msgs/Imu`)
Simulated from the ROV's motion, in the standard ROS axes (x forward, y left, z up), also shown in the page's
**tilt / accel / gyro** readout:
- `orientation`: a quaternion (roll 0, pitch, yaw). **Pitch is positive nose-down.**
- `angular_velocity`: rad/s (y = pitch rate, z = yaw rate).
- `linear_acceleration`: m/s^2 as a real accelerometer reads it, **including gravity**: level and still it reads
  `z = +9.8`; tilt the nose down and some of that moves into `x` (about `-g*sin(pitch)`); speeding up forward
  shows in `x`, turning in `y`, bumping the floor or surface in a spike on `z`.
**An IMU senses acceleration, not speed or depth.** Rising at a steady speed reads exactly the same as sitting still
(`z = 9.81`); you only see the start and stop. With gentle buoyancy the start is small (about `+0.12` m/s^2 fading
over ~3 s) and the slowdown at the surface is bigger (about `-0.6`). The page's **minus g** row removes gravity
(using the tilt) so these are easy to see. That's why ROVs also carry a depth sensor.

The page shows three decimals. By default the simulated accelerometer is exact. Real ones are not: the smallest
step an IMU reports (its resolution) varies, roughly `0.01` m/s^2 for a BNO055 and about `0.0006` for an MPU-6050 or
ICM-20948 (check the datasheet for yours), and noise is usually bigger than the resolution, around a few hundredths
of m/s^2. `imu_resolution` mimics the step (`0.01` = BNO055-like); `imu_noise` adds the noise.

`-p imu_noise:=0.05` (ROS) / `--imu-noise 0.05` (keyboard) adds noise, so students need to filter; `imu_resolution` / `--imu-resolution` sets the step. See
`student_imu_example.py` (prints tilt and acceleration).

## Vertical thrusters, tilt and levelling
Both vertical thrusters are mounted **low on the frame**, and a propeller only works while it is under water
(a high mount, `THRUSTER_UP = 0.15` in `rov_physics.py`, loses thrust as soon as it breaches, so the ROV couldn't
rise as far). Together they lift (each is half of `max_thrust`); **a ring hanging on the nose (or held in the claw)
adds a nose-down torque** that tilts the ROV about 6 degrees (4 held). Nothing levels it for free beyond a little
buoyancy restoring force, so **students can read the tilt from the IMU and counter it with the front/rear
thrusters** (front up + rear down = nose up; keys `I` / `K`). Tuning: `TORQUE_HANGING` / `TORQUE_HELD` in
`rov_props.py`; `VERT_ARM`, `PITCH_I`, `PITCH_KS`, `PITCH_DS` in `rov_physics.py`. The nose and claw positions follow the tilt.

## Choosing the tool
The **Tool** button (or `T`) switches claw/nose, and the choice lives in the simulator, so the nose
test knows which one is active. Start with `--tool nose` (keyboard) / `-p tool:=nose` (ROS), or publish
`claw` / `nose` as a `std_msgs/String` to `/rov/tool`.

## Walls
The pool walls stop the ROV's real footprint (frame, side thrusters and the tool tip), not a fixed
square, so turning next to a wall no longer pokes a corner through it. It slides along the wall.

## Views
Buttons top-right: **Orbit** (drag to rotate, scroll to zoom), **Follow**
(chase camera), **Top**, **Tool**, **Water FX**, **Reset**. Press **V** (or double-click the
pool) to reset the camera. The page re-measures itself when its window changes size and backs the
camera off to fit a narrow one such as VS Code's side panel (until you orbit by hand yourself). `http://localhost:8000/?view=follow` opens a view directly.
Orbit all the way around: a wall, the floor or the deck that is between you and the
pool fades to see-through (x-ray). Orbit under the water and you look up at the
rippling surface; the pool floor has drifting light patches. `?cam=x,y,z` places the camera.

## Notes
- The page only listens on this computer (127.0.0.1); each student runs their own pool.
- If `ros2 topic list/echo` hangs, the ROS CLI helper daemon is stuck: add `--no-daemon`
  (or `ros2 daemon stop`). The sim itself is unaffected.
- three.js is vendored in `web/vendor/` so it works offline.
- Real vehicle later: keep these topic names as the interface, and the same student
  code can drive a bridge to real thrusters (see `docs/PROTOCOL.md`).
