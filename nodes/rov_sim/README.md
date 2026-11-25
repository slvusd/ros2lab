# rov_sim — a classroom ROV in a 3D pool

A small simulator: your ROS 2 code publishes **thruster commands**, a PVC-cube ROV moves in a 3D pool, and you watch it in a
browser tab right next to your code in VS Code. Nothing to install beyond the ROS 2 environment.

- [Quick start](#quick-start) · [Nodes](#nodes) · [**Channels**](#channels-everything-the-sim-listens-to-and-publishes) ·
  [**Command-line cheat sheet**](#command-line-cheat-sheet) · [The page](#the-page) · [Troubleshooting](#troubleshooting)
- Then the details: [thrusters](#the-vehicle-and-its-thrusters), [physics](#what-the-physics-does), [IMU](#the-imu),
  [Water FX](#water-fx), [pick-up ring](#the-pick-up-ring-optional), [parameters](#parameters), [files](#files-in-this-folder)

## Quick start

```
source mac/env.sh                          # once per terminal: activates ROS 2 (leave it with: micromamba deactivate)
python nodes/rov_sim/rov_sim.py            # terminal 1: starts the pool        (Ctrl+C to stop)
python nodes/rov_sim/student_minimal.py    # terminal 2: your program: thrusters on, then off
```
Then in VS Code: **Cmd+Shift+P → "Simple Browser: Show" → `http://localhost:8000`**, and drag that tab beside your code.
(The "ROV pool" task does the first step: Cmd+Shift+P → "Tasks: Run Task".)

No ROS set up, or just want to play? `python3 nodes/rov_sim/keyboard_sim.py` is the same pool without ROS (see [Nodes](#nodes)).
Check an install: `source mac/env.sh && ./nodes/rov_sim/install.sh` (prints a PASS line per check).

## Nodes

| Program | ROS node | What it is |
|---|---|---|
| `rov_sim.py` | `/rov_sim` | **The simulator.** Subscribes to your commands, publishes the sensors, serves the page. The keyboard and the two on-screen joysticks work in the page too. |
| `keyboard_sim.py` | *(none)* | The same pool and physics **without ROS**: drive it with the keyboard, nothing is published. For a quick play, or no ROS environment. |
| `student_minimal.py` | `/student` | About 15 lines, no classes: thrusters 1 and 2 on for 2 s, then off. **Start here.** |
| `student_example.py` | `/first_dive` | The same job as a proper ROS node with a timer. |
| `student_imu_example.py` | `/imu_reader` | Subscribes to `/sim/imu` and prints tilt and acceleration. |
| `student_joystick.py` | `/joy_drive` | Subscribes to the two joysticks and turns them into thruster commands. |

Only one simulator can use port 8000 (`--port` / `-p port:=` to change it). The student programs are ordinary examples to copy.

## Channels: everything the sim listens to and publishes

All channels are under the short prefix **`/sim`**. Thruster numbers follow the real ROV's habit (`t1`, `t2`, ... `t6`/`t8` on a bigger vehicle).
**Thruster and claw commands are latched**: the sim keeps the last value you sent until you send another (send `0.0` to stop a thruster).

### Commands: you publish, the sim subscribes

| Channel | Type | Range | Meaning |
|---|---|---|---|
| `/sim/t1` | `std_msgs/Float32` | -1.0 .. 1.0 | thruster 1: **left**, horizontal, `+` pushes the ROV forward (red) |
| `/sim/t2` | `std_msgs/Float32` | -1.0 .. 1.0 | thruster 2: **right**, horizontal, `+` pushes forward (green) |
| `/sim/t3` | `std_msgs/Float32` | -1.0 .. 1.0 | thruster 3: **front vertical**, near the nose, `+` pushes **up** |
| `/sim/t4` | `std_msgs/Float32` | -1.0 .. 1.0 | thruster 4: **rear vertical**, near the tail, `+` pushes **up** |
| `/sim/claw` | `std_msgs/Float32` | 0.0 .. 1.0 | claw servo: `0.0` closed, `1.0` fully open, in between = partly open |
| `/sim/tool` | `std_msgs/String` | `claw` / `nose` | which tool is on the front bottom bar (also the page's **Tool** button) |
| `/sim/reset` | `std_msgs/Empty` | | put the ROV (and the ring) back at the start (also the **Reset** button) |

There is deliberately **no "forward" or "turn" command**: that is thruster control. If `t1` and `t2` are equal the ROV drives straight;
if they differ it turns. `t3` and `t4` together lift or sink it; if they differ it tilts (front up + rear down = nose up).

### Readings: the sim publishes, you subscribe

| Channel | Type | Rate | Meaning |
|---|---|---|---|
| `/sim/imu` | `sensor_msgs/Imu` | 50 Hz | tilt (orientation quaternion), turn rate, acceleration; see [The IMU](#the-imu) |
| `/sim/depth` | `std_msgs/Float32` | 10 Hz | metres below the surface (the ROV's centre) |
| `/sim/heading` | `std_msgs/Float32` | 10 Hz | degrees, 0 = toward the far end of the pool, counter-clockwise positive |
| `/sim/joy1` | `sensor_msgs/Joy` | 20 Hz while held | the **left on-screen joystick** (see below) |
| `/sim/joy2` | `sensor_msgs/Joy` | 20 Hz while held | the **right on-screen joystick** |

**The joysticks.** Two small pads under the toolbar (top right): click and drag with the mouse; they spring back to centre.
Each publishes a standard `sensor_msgs/Joy` with two axes: `axes[0]` left/right with **LEFT = +1** (backwards from what you'd guess, as on a real
gamepad) and `axes[1]` up/down with **UP = +1**. They publish at 20 Hz while held and for a second after (so you see the return to zero), then stay
silent. They do **not** move the ROV by themselves: connect them in your own code (see `student_joystick.py`). Their values also appear in the
page's readout (`joy1`, `joy2`).

**Conventions.** Axes follow ROS: **x forward, y left, z up**. Angles are radians in messages. **Pitch is positive nose-down.** Distances are metres.

### Not channels (page-only settings)
**Buoyancy** (the **Buoyancy** button / `B`) is a setting of the pool, not a channel: a real ROV has no buoyancy control. See [What the physics does](#what-the-physics-does).

## Command-line cheat sheet

Run these in a terminal after `source mac/env.sh`, with the sim running. **Add `--no-daemon`** to `ros2 node/topic/param` commands if they hang or
show stale results (`ros2 topic hz` doesn't take it).

| I want to... | Command |
|---|---|
| see the running nodes | `ros2 node list --no-daemon` |
| see a node's channels | `ros2 node info /rov_sim --no-daemon` |
| list every topic, with types | `ros2 topic list -t --no-daemon` |
| see who is on a topic | `ros2 topic info /sim/t1 --no-daemon` |
| **turn a thruster on** (once) | `ros2 topic pub -1 /sim/t1 std_msgs/msg/Float32 "{data: 0.8}"` |
| **turn it off** | `ros2 topic pub -1 /sim/t1 std_msgs/msg/Float32 "{data: 0.0}"` |
| keep sending a value (5 times a second) | `ros2 topic pub -r 5 /sim/t1 std_msgs/msg/Float32 "{data: 0.5}"` (Ctrl+C stops *sending*; the sim keeps the last value, so send `0.0` too) |
| open the claw halfway | `ros2 topic pub -1 /sim/claw std_msgs/msg/Float32 "{data: 0.5}"` |
| switch tool | `ros2 topic pub -1 /sim/tool std_msgs/msg/String "{data: nose}"` |
| start over | `ros2 topic pub -1 /sim/reset std_msgs/msg/Empty "{}"` |
| read one value | `ros2 topic echo --once /sim/depth --no-daemon` |
| watch a stream | `ros2 topic echo /sim/imu` (Ctrl+C to stop) |
| read just one field | `ros2 topic echo --once /sim/imu --field linear_acceleration --no-daemon` |
| check the rate | `ros2 topic hz /sim/imu` (about 50 Hz) |
| see a message's fields | `ros2 interface show sensor_msgs/msg/Imu` (also `.../Joy`) |
| see the sim's parameters | `ros2 param list /rov_sim --no-daemon` and `ros2 param get /rov_sim max_thrust --no-daemon` |

Expected output of the first few (yours may differ slightly):
```
$ ros2 node info /rov_sim --no-daemon
/rov_sim
  Subscribers:
    /sim/claw: std_msgs/msg/Float32
    /sim/reset: std_msgs/msg/Empty
    /sim/t1: std_msgs/msg/Float32      (t2, t3, t4 the same)
    /sim/tool: std_msgs/msg/String
  Publishers:
    /sim/depth: std_msgs/msg/Float32
    /sim/heading: std_msgs/msg/Float32
    /sim/imu: sensor_msgs/msg/Imu
    /sim/joy1: sensor_msgs/msg/Joy     (and joy2)
    ...
$ ros2 topic info /sim/t1 --no-daemon
Type: std_msgs/msg/Float32
Publisher count: 0
Subscription count: 1
$ ros2 topic echo --once /sim/depth --no-daemon
data: 0.191
```
**Parameters are read once, at startup.** `ros2 param list` shows them, but to change one restart the sim with `-p`, for example
`python nodes/rov_sim/rov_sim.py --ros-args -p max_thrust:=20.0 -p buoyancy:=0.0`.

## The page

Buttons (top right): **Orbit** (drag to rotate, scroll to zoom), **Follow** (chase camera), **Top**, **Buoyancy**, **Tool**, **Water FX**, **Reset**.
Under them, the two joysticks. The left panel shows the thruster commands, claw, depth, heading, the IMU, and the joysticks, so you can check a
channel is doing what your code thinks. Press **V** (or double-click the pool) to reset the camera; it re-fits itself if the window is resized
(until you orbit by hand yourself). Orbit all the way round: walls, floor or deck that are between you and the pool fade to see-through, and under
the water you look up at the rippling surface. `?view=follow`, `?cam=x,y,z`, `?target=x,y,z` in the URL set a view directly.

**Keyboard** (click the page once first). It's for playing by hand; it works alongside your ROS code, and per thruster **the last new value wins**
(a key you aren't touching never overwrites what your code sent; releasing a key sets that thruster to 0). `-p keys:=false` turns it off.
W/S forward/reverse, A/D turn, R/Space both vertical thrusters up, F/Shift down, I/K tilt nose up/down, Z/C left/right thruster only,
H claw open/close, `[` `]` close/open the claw gradually, T claw/nose, B buoyancy, V reset the view, X stop. (These keys mix `t1`..`t4` for you.
Your ROS code only has the individual thrusters, by design.)

## The vehicle and its thrusters

A cube frame (about 50 cm) of PVC pipe, nose toward +x. Four thrusters, and a tool on the front bottom bar:

| Channel | Where | Pushes | Colour |
|---|---|---|---|
| `t1` | left side, horizontal | the ROV forward (`+`) or back (`-`) | red (port) |
| `t2` | right side, horizontal | the ROV forward (`+`) or back (`-`) | green (starboard) |
| `t3` | low on the frame, near the nose | up (`+`) or down (`-`) | white shroud |
| `t4` | low on the frame, near the tail | up (`+`) or down (`-`) | white shroud |

A real ROV has 6–8 thrusters; adding `t5`... later means extending the thruster list in `rov_physics.py` and the model in `web/app.js`.

Every thruster is clamped to a real frame member: the side thrusters hang from rails on each side of the frame, the vertical thrusters sit on the
bottom bar. The vertical thrusters are mounted **low** because a propeller only works under water: a high mount would lose thrust as soon as it
breaches. Together they provide all the lift (each is half of `max_thrust`).

## What the physics does

(approximate on purpose: it should *feel* like water, not be a research model)
- Thrust accelerates the ROV; water drag slows it, so it speeds up gradually and **coasts to a stop**. "Added mass" makes it feel heavy.
- Like a real ROV it is **slightly positively buoyant** (1.5 N spare): thrusters off, it drifts up and **floats with the top of the frame ~6 cm out
  of the water**. Pushing it down takes a little thrust (about 12% down on `t3`/`t4` holds a depth). The **Buoyancy** button cycles
  **floats → neutral** (hovers wherever you leave it) **→ sinks** (settles on the floor).
- It loses buoyancy as its top comes out of the water, so it can **pop up out of the water and sink back**: held up at 80% lift it rests ~14 cm out.
  On the floor it **bumps** (small bounce, a puff of silt, a little rocking). `--hard-limits` / `-p hard_limits:=true` gives plain stop-dead walls.
- The **walls** stop the ROV's real footprint (frame, side thrusters, tool tip), so it slides along a wall instead of poking a corner through.
- **Tilt:** `t3` and `t4` differ → the ROV pitches. A ring hanging on the nose (or held in the claw) adds a nose-down torque that tilts it about 6°
  (4° held). Nothing levels it for you except a little buoyancy restoring force, so **students can read the tilt on the IMU and cancel it with
  `t3`/`t4`**.
- Tool: the **claw** is a servo (`/sim/claw`), its two jaws pinch from the left and right; the **nose** is a fixed, gently upturned bar. Both mount
  on the front bottom bar. Switch with the **Tool** button, `T`, `/sim/tool`, or `--tool` / `-p tool:=`.

All the numbers are constants at the top of `rov_physics.py`.

## The IMU

`/sim/imu` is simulated from the ROV's motion, in standard ROS axes, and shown in the page as **tilt / accel / minus g / gyro**.
- `orientation`: quaternion (roll is always 0; pitch + = nose down; yaw).  `angular_velocity`: rad/s (y = pitch rate, z = yaw rate).
- `linear_acceleration`: m/s² **as a real accelerometer reads it, including gravity**: level and still it reads `z = +9.8`; nose down moves some of that into
  `x` (about `-g·sin(pitch)`); speeding up forward shows in `x`, turning in `y`, bumping the floor or surface as a spike in `z`.
- **An IMU senses acceleration, not speed or depth.** Rising at a steady speed reads exactly the same as sitting still. You only see the start (about
  `+0.12` m/s² fading over ~3 s with the default buoyancy) and the slowdown at the surface (about `-0.6`). The page's **minus g** row removes gravity
  (using the tilt) so these show up. That is why ROVs also carry a depth sensor.
- Real IMUs aren't exact. The smallest step they report (resolution) is roughly 0.01 m/s² for a BNO055 and about 0.0006 for an MPU-6050 or ICM-20948
  (check your datasheet), and noise is usually bigger, a few hundredths. `imu_resolution` and `imu_noise` (see [Parameters](#parameters)) mimic both.

## Water FX

The **Water FX** button (your choice is remembered). **On:** real refraction at the surface (Snell's law, n = 1.33): submerged things bend and wobble by an
amount that grows with their depth, so a pipe through the surface stays joined at the waterline; from underneath you see the sky only through a circular
"window", and the rest of the surface is a dark mirror. A small wave simulation adds ripples from the ROV breaking the surface (or dropping in), moving near
it, and from popping bubbles, on top of a gentle ambient ripple. **Off:** a simple translucent surface (cheaper on slow laptops).

## The pick-up ring (optional)

A slightly buoyant orange hoop with a weight on its bottom edge: it **stands upright on the pool floor**, facing the ROV's start. Which tool you have
selected decides how you lift it:
- **Nose:** drive the nose **through** the ring, then **rise**. The top of the nose meets the ring's inner rim and carries it up; it hangs from the nose,
  rides its low part, and swings round as you turn (the page says "ring hooked"). Lower it onto the floor and back out to leave it.
- **Claw:** open the claw and put the jaws around the *side* of the rim (a vertical piece of tube, anywhere between the hinges and the fingertips; the page
  says "ring between jaws: close!"), then **command the claw closed** (`/sim/claw` at 0.25 or less). It grips at once and the jaws stop at the tube's
  thickness. Command it open (above 0.25) to let go. Closing only partway doesn't clamp. The top and bottom of the rim won't grip.

It's game-style physics, not a contact solver. **It lives in two files, so it is easy to drop: delete `rov_props.py` and `web/props.js`**
(everything else skips it quietly), or run with `--no-ring` / `-p ring:=false`. **Reset** puts it back.

## Parameters

Read once at startup. `ros2 run`-style for `rov_sim.py`: `--ros-args -p name:=value`. For `keyboard_sim.py`: `--name value`.

| Parameter | Default | Meaning |
|---|---|---|
| `port` | 8000 | web page port |
| `keys` | true | the page's keyboard also drives the ROV (ROS version) |
| `joy` | true | publish the on-screen joysticks on `/sim/joy1`, `/sim/joy2` |
| `tool` | claw | starting tool: `claw` or `nose` |
| `ring` | true | the pick-up ring (`--no-ring` for the keyboard version) |
| `max_thrust` | 12 | newtons at full command for **each** horizontal thruster; the two vertical thrusters share one such budget (6 N each) |
| `mass` | 8 | kg including added mass |
| `buoyancy` | 1.5 | N of spare buoyancy: positive floats, `0` hovers, negative sinks |
| `hard_limits` | false | stop dead at surface and floor (no overshoot, no bounce) |
| `imu_noise` | 0 | accelerometer noise, m/s² standard deviation (try 0.05) |
| `imu_resolution` | 0 | accelerometer step, m/s² (0 = exact, 0.01 = BNO055-like) |

## Troubleshooting

- **Page says "waiting for sim..."** The sim isn't running (or is on another port). Start `rov_sim.py` or `keyboard_sim.py`, then reload.
- **"Address already in use" / the old pool still shows.** Something is already on port 8000, often last time's sim. Stop it (Ctrl+C in its terminal), or
  use another port.
- **`ros2 node list` shows `/rov_sim` twice, or channels you don't expect** (for example old `/rov/...` names): two simulators are running in the same ROS
  domain. Stop the older one. To keep separate groups apart, give each its own `export ROS_DOMAIN_ID=<number>` before starting anything.
- **`ros2 topic list` hangs or looks stale:** add `--no-daemon`, or `ros2 daemon stop`. The sim itself is unaffected.
- **My thruster command did nothing:** is `/sim/t1` the right name (`ros2 topic list`)? Does `ros2 topic info /sim/t1` say *Subscription count: 1*? Are you
  holding a key that sends a newer value for that thruster? (Last new value wins.)
- **Keys do nothing:** click the page once so it has keyboard focus.
- **The pool looks wrongly zoomed in VS Code:** press `V`, or close and reopen the Simple Browser tab.
- The page only listens on this computer (127.0.0.1); each student runs their own pool. three.js is bundled in `web/vendor/` so it works offline.

## Files in this folder

| File | What it is |
|---|---|
| `rov_sim.py` | the ROS node (channels, parameters) |
| `keyboard_sim.py` | the same pool without ROS |
| `rov_physics.py` | **the physics**, thruster layout, and the tiny web server (no ROS in it); tune the feel here |
| `rov_props.py` + `web/props.js` | the optional pick-up ring (delete both to remove it) |
| `web/` | the page: `index.html`, `app.js` (3D scene, readouts, joysticks), `vendor/` (three.js) |
| `student_*.py` | examples for students (see [Nodes](#nodes)) |
| `install.sh` | self-test (needs `source mac/env.sh`) |

A real vehicle later: keep these channel names as the interface and the same student code can drive a bridge to real thrusters (see `docs/PROTOCOL.md`).
