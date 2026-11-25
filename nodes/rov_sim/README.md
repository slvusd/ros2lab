# rov_sim — a classroom ROV in a 3D pool

A small simulator: your ROS 2 code publishes **thruster commands**, a PVC-cube ROV moves in a 3D pool, and you watch it in a
browser tab right next to your code in VS Code. Nothing to install beyond the ROS 2 environment.

- [Quick start](#quick-start) · [Nodes](#nodes) · [**Channels**](#channels-everything-the-sim-listens-to-and-publishes) ·
  [**Command-line cheat sheet**](#command-line-cheat-sheet) · [The page](#the-page) · [Troubleshooting](#troubleshooting)
- Then the details: [thrusters](#the-vehicle-and-its-thrusters), [physics](#what-the-physics-does), [IMU](#the-imu),
  [Water FX](#water-fx), [rings and collisions](#the-rings-and-how-things-collide-optional), [the fish](#the-fish-optional), [parameters](#parameters),
  [tests](#tests), [files](#files-in-this-folder)

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

## Browser-only version (no Python, no ROS: Chromebooks)

`web/` is a complete page. Serve that folder from any static web host (GitHub Pages), or on your own computer with
`python3 nodes/rov_sim/tools/serve_web.py` (then open http://localhost:8000; it sends no-cache headers, unlike `python3 -m http.server`,
which lets the browser keep old copies of the scripts so that after an update a new option can quietly do nothing until you hard-reload),
and open it: when no sim server answers, the page runs its own copy of the physics (`web/sim/physics.js`) and you drive with the
keyboard. `?mode=local` forces this, `?mode=server` forces the Python server. It starts with the **nose** (the usual scout tool); the claw is one key away. The claw and the nose both work (T switches, H opens/closes, `[ ]` nudge it),
the coy fish swims (`web/sim/fishbrain.js`, an optional add-on: delete it and the fish is gone), the three pool rings are there (`web/sim/rings.js`, also optional: push them, hook them on the nose and carry them), and the **IMU panel** is there (tilt, accelerometer, accelerometer minus gravity, gyro, in the HUD; the joysticks are not).
`?quality=high|low|lowest|auto` picks the graphics level from the link (lowest hides the ROV camera window).
The JS fish behaves like the Python one but uses its own random numbers, so it swims different paths; its tests check behaviour, not exact routes.

**Slow machines (Chromebooks):** the Quality button is Auto by default. It starts at High (one step down on machines with 4 or fewer
cores or 4 GB or less of memory) and steps down only if the frame rate stays under 28 fps: Medium switches Water FX off, Low slows the
ROV camera window to 4 pictures a second and renders at a lower pixel ratio, Lowest hides the camera window. Click it to pin High or Low
(remembered in the browser). Small screens (under 800 px tall) get tighter panels.
`?selftest` makes the page drive itself for 7 seconds and write `PASS ...` or `FAIL: ...` into the page title (used for headless checks).

**The switch box** (top right, where the joysticks are in the ROS version) imitates the usual scout controller: three momentary
DPDT switches that give full reverse, off, or full forward (no in-between, like an H-bridge). Top row, lying down: the **red** switch
(thruster t1, the left one; keys `1` reverse, `2` forward) and the **green** switch (t2, the right one; left / right arrow keys). Left end of a slot =
reverse, right end = forward. Below, upright: both vertical thrusters (down / up arrow keys). Hold a switch with the mouse (right half / top half =
forward / up, left half / bottom half = reverse / down) or press the keys; it springs back to off. A pushed switch overrides everything else for its own
thrusters only. **H** (or the badge under the switches) toggles **H-bridge only**: the badge turns amber and only the three switches work, like the real
controller. With it off, the extra keys (W A S D, R F, Z C, I K) work too. The setting is remembered in the browser.
To change a key, edit `SWITCHES` in `web/controls.js` (and the key help in `index.html`).

**Help page:** the **Help** button opens `web/help.html`, rendered from `web/help.md` (controls, the pool, page options, and the full micro:bit / Pico protocol with examples). It is the single
source for the browser version's protocol; `web/sim/tests/help.test.js` fails if it falls out of step with the code. Edit `help.md`, not the HTML.

**The water outlets and the current** (`rov_current.py` / `web/sim/current.js`, drawn by `web/jets.js`): two round outlets are **always** in the middle of the pool's +y wall (the side the shallow end is on), at 1/3 and 2/3 of
the depth, whether or not the water runs. The water runs when you ask: `current=on`, or the *Run the water* box in the Config dialog (the HUD then shows a *current* reading: how fast the
water moves at the ROV), or `--current` / `current:=true` on the Python sim. Water then shoots straight across the pool, as if filling it. Not realistic, but a good challenge: a round-jet-like profile (on the axis `min(U0, K / s)` at distance `s`
from the nozzle, a Gaussian across it, widening with distance; constants at the top of `rov_current.py`: gentle at the surface, about 0.5 m/s a couple of metres out at the outlets' own depth, faster than the ROV can swim within half a metre of an
outlet). **How the ROV feels it:** the core physics asks every prop that has a `flow(x, y, depth)` method how fast the water moves at the ROV and computes drag from the speed *relative to the water*, so the ROV is carried along and has to be powered or steered
against it, and the **IMU accelerometer shows the push**. It also **tilts** the ROV: the push of the water on the top, middle and bottom of the frame twists it, so a push from the side makes it **roll** (heel over; new: the ROV has a roll angle, shown on the
model, in the HUD and in the IMU, with the accelerometer's gravity leaning accordingly), and a push on the nose or tail pitches it (a ROV carried along with the water levels out again; one held against it stays tilted). With the water still, none of this
exists: the physics is bit-for-bit what it was. The ROV and the fish feel the water (the fish is carried along by `FLOW_PUSH` = 0.45 of the water's speed: it swims against it a little); rings and crabs do not. The collision shape ignores roll. Tests: `test_current.py`, `web/sim/tests/current.test.js`, and Python golden traces (IMU, roll) replayed by the JS port. It is an
optional add-on: delete the files and the outlets and the current are gone.

**The Config button / dialog** (`web/configui.js`): the toolbar has one *Config* button (it replaced the separate Tool, Current and Pool buttons to save toolbar space). Its dialog has a **Right now** box whose changes apply immediately: the front tool
(nose / claw), the main pool size (four presets, `POOL_PRESETS` in `web/config.js`: 6 x 3, 6 x 6, 12 x 6, 12 x 9 m; any size from `poollength` / `poolwidth` in the address shows as "custom"; `setPoolSize` in `backend-local.js` resizes the pool in place and resets so the ROV,
rings, fish, crabs and the outlets are put back in the new pool), the water (*Run the water*, and how it is drawn), and the thruster power; the address is kept in step (`syncAddress` in `app.js`) so a reload or a shared link keeps them. The **Needs a restart** box (controls mode,
fish, rings, crabs, camera) applies with *Restart with these*, which reloads the page. With the Python server only the tool and the water look are live. **Water looks** (`web/jets.js`): `flow=bubbles|streaks|rings|mix` or the `J` key choose how the running water is drawn;
the picture is deliberately narrower and straighter than the physical flow field.

**The green crab** (`rov_crab.py` / `web/sim/crab.js`, drawn by `web/crab.js`): the 2026 scout task is to remove the invasive European green crab, so a small crab now crawls (sideways, like a real one) on
the floor of the shallow end. It scuttles away when the ROV comes close, but it is about five times slower than the ROV, and when the ROV touches it (any part of the frame, thrusters, jaws
or nose, as long as it is low enough) it is simply **shoved out of the way**, like a ring. It never leaves the shallow end. It is an **optional add-on**: delete `rov_crab.py` (and `web/crab.js`,
`web/sim/crab.js`) and the crab is gone; nothing else knows about it (the page only draws state entries whose `type` is `crab`). Picking a crab up (the actual task) is not built yet.
The pushing is **not crab-specific**: `rov_pushable.py` / `web/sim/pushable.js` is a small generic `Pushable` base class (a body on the floor that the ROV shoves, that coasts and spins a little,
and stays inside its rectangle); the crab only adds the walking. A rock or a lobster pot would be a few lines. Tests: `test_crab.py` and `web/sim/tests/crab.test.js`. Option: `crabs=0..5` in the page address / `?config`.

**Drop a ring (`N`):** point the mouse at the water of the pool and press `N`: a new ring is dropped in at that spot and sinks to the floor (at most 10 rings in the pool,
`MAX_RINGS` in `rov_props.py` / `web/config.js`). **Reset** removes the dropped rings again. It works in the browser version and with the Python server (the page POSTs `/ring`).

**Settings (`?config`):** add `?config` to the page address (or use *Set up the pool* in the Help page) for a panel that sets the options and gives you a link to share;
each setting is also a plain address option: `controls=all|h|h-hidden` (all keys / H-circuit only, locked / H-circuit only with every other control hidden),
`fish=on|off`, `rings=0..5` (3), `speed=0.25..4` (1: the red and green thrusters' power), `thrusters=3|4|6|8` (4), `poollength=1|2` (x 6 m), `poolwidth=1|2|3` (x 3 m), `camera=on|off`. They live in `web/config.js` (parsing and limits, tested) and
`web/configui.js` (the panel); `physics.js` `setPool()` resizes the main pool. The pool size is a browser-version feature for now: Python's pool is still the fixed
6 x 3 m plus shelf (`POOL_REGIONS` in `rov_physics.py`), and with the Python server only `controls` and `camera` apply (use `--rings` / `--fish` there).

**Drive it from a micro:bit or Pico (browser version, Chrome / Edge / Chromebook):** plug the board in with USB, click
*Connect micro:bit / Pico*, choose the board. The board then just `print()`s lines like `p:t1,0.5` (the protocol is in
`docs/PROTOCOL.md`; examples: `examples/microbit_tilt.py` drives by tilting a micro:bit, `examples/pico_throttle.py` uses a dial).
The keyboard and the board can both be used: for each thruster the last new value wins. Unplug the board and the thrusters stop.
Only one program can use a USB port at a time (close MakeCode / Thonny / another tab). Needs `https://` or `http://localhost`;
a school-managed Chromebook may have Web Serial turned off by policy. The micro:bit radio gateway (`nodes/microbit/gateway.py`) also works:
it passes the same lines (32 bytes max) between student micro:bits and the page. With the Python/ROS sim, use `nodes/serial_bridge` instead.

Python is the reference: `physics.js` is a line-by-line port of `rov_physics.py`. After changing `rov_physics.py`,
run `python3 tools/export_golden.py` (rewrites `web/sim/tests/golden/physics.json`), port the change to `physics.js`,
then `node --test web/sim/tests/`. `python3 tools/export_golden.py --check` fails if the committed golden file is stale.

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
| `/sim/reset` | `std_msgs/Empty` | | put the ROV, the rings and the fish back at the start (also the **Reset** button) |

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
The model shows it as pipe insulation on the top four sticks: a long dark foam piece on each when it **floats**, a few short pieces when it is **neutral**, none when it **sinks**
(`/?buoyancy=positive|neutral|negative` in the page address sets it). The foam is only drawn: it is not part of the collision shape.

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
Under them, the two joysticks, and under those the [**ROV camera**](#the-rov-camera). The left panel shows the thruster commands, claw, depth, heading, the IMU, and the joysticks, so you can check a
channel is doing what your code thinks. Press **V** (or double-click the pool) to reset the camera; it re-fits itself if the window is resized
(until you orbit by hand yourself). Orbit all the way round: walls, floor or deck that are between you and the pool fade to see-through, and under
the water you look up at the rippling surface. `?view=follow`, `?cam=x,y,z`, `?target=x,y,z` in the URL set a view directly.

**Keyboard** (click the page once first). It's for playing by hand; it works alongside your ROS code, and per thruster **the last new value wins**
(a key you aren't touching never overwrites what your code sent; releasing a key sets that thruster to 0). `-p keys:=false` turns it off.
The **switch box** (see below) is driven by `1` `2` (red), the left and right arrow keys (green) and the up and down arrow keys. The extra keys
W or Shift forward, S or Space reverse, A/D turn, R/F all vertical thrusters up/down, I/K tilt nose up/down, Z/C left/right side only (with 6 or 8 thrusters also Q/E slide left/right, and with 8 U/O roll)
work too unless you press H (H-bridge only: just the switch box). `[` `]` close/open the claw gradually, T claw/nose, B buoyancy, V reset the view, X stop.
(These keys mix `t1`..`t4` for you.
Your ROS code only has the individual thrusters, by design.)

## The pool

The pool is **L-shaped**: the original 6 × 3 m, 2 m deep pool (the **deep end**), plus a **shallow end**, a 2.5 × 2.5 m shelf, 1 m deep,
off to the left (+y) at the far end:

```
 y
 4.0 |            +--------+       the shallow end (floor at 1.0 m)
     |            | shallow|
 1.5 +------------+--------+
     |      deep end (2 m)  |      the original pool (floor at 2.0 m); the ROV starts here, facing +x
-1.5 +----------------------+
    -3.0         0.5       3.0   x
```
- **The step.** Between the deep end and the shelf is a 1 m step. To go over it **the ROV's lowest point must be above the shelf floor**, i.e. its
  centre shallower than about **0.72 m** (`/sim/depth` < 0.72). A deeper ROV is stopped by the step like any wall; a ROV over the shelf can't dive
  below 0.72 m (it rests on the shelf). A ROV straddling the edge rests on the lip.
- **Missions this allows:** carry a ring from the deep end to the shallow end and set it down there (it stands on the shelf floor); hover over the
  shelf at a set depth; find the way into the shallow end; compare `/sim/depth` in the two ends.
- **Reshaping it.** The pool is a list of rectangles with floor depths, `POOL_REGIONS` at the top of `rov_physics.py`. The physics and the page both
  read that list, so editing it (adding a rectangle, changing a depth) reshapes everything: walls, steps, floors, deck, waves. The rectangles must
  touch along their edges to form one connected pool. A sloped shallow end (a ramp) isn't supported yet: floors are flat per rectangle.

## The ROV camera

A small camera sits on a short pipe under the **top front edge** of the frame, looking forward and tilted down about 29° so the front half of the claw is
always at the bottom of the picture (jaws open and closing; or the tip of the nose). Its picture is in the small window **under joy2**: 320 × 240, about
15 frames a second, drawn from the camera's own position, so it sees the water surface from underneath, refraction, bubbles, rings and the fish. It sees
solid walls (the see-through "x-ray" walls are only for your own camera). It tilts with the ROV, for example under a hanging ring.

The picture is drawn by the page, so it is **not a ROS topic** (no `sensor_msgs/Image`). Publishing a live image to ROS would be a further step, if you
want students to run image-processing nodes on it. To move or re-aim the camera, change `rovCam` in `web/app.js` (and the housing capsule in `rov_shape.py`).

## The vehicle and its thrusters

A cube frame (about 50 cm) of PVC pipe, nose toward +x. Four thrusters, and a tool on the front bottom bar:

| Channel | Where | Pushes | Colour |
|---|---|---|---|
| `t1` | left side, horizontal | the ROV forward (`+`) or back (`-`) | red (port) |
| `t2` | right side, horizontal | the ROV forward (`+`) or back (`-`) | green (starboard) |
| `t3` | low on the frame, near the nose | up (`+`) or down (`-`) | white shroud |
| `t4` | low on the frame, near the tail | up (`+`) or down (`-`) | white shroud |

At the normal speed a command of 1.0 on `t1` or `t2` pushes with 6 N (see the `speed` parameter); the vertical ones give up to 6 N each.

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
- The **walls** stop the ROV's real footprint (frame, side thrusters, tool tip), so it slides along a wall instead of poking a corner through. The
  **floor** stops its lowest point, and in the L-shaped pool the floor depth depends on where it is (see [The pool](#the-pool)).
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

## The rings, and how things collide (optional)

**Three weighted rings** (orange, yellow, green) stand upright on the pool floor, each a slightly buoyant hoop with a weight on its bottom edge. The
first faces the ROV's start. `rings` / `--rings N` sets how many (0 to 5). Ways to deal with a ring:
- **Nose:** drive the nose **through** a ring, then **rise**. The top of the nose meets the ring's inner rim and carries it up; it hangs from the nose,
  rides its low part, and swings round as you turn (the page says "ring hooked"). Lower it onto the floor and back out to leave it. Several rings
  can hang on the nose at once. You can carry a ring to the shallow end and set it down there.
- **Claw:** open the claw and put the jaws around the *side* of a ring's rim (a vertical piece of tube, anywhere between the hinges and the fingertips; the
  page says "ring between jaws: close!"), then **command the claw closed** (`/sim/claw` at 0.25 or less). It grips at once and the jaws stop at the
  tube's thickness. Command it open (above 0.25) to let go. Closing only partway doesn't clamp. The top and bottom of the rim won't grip. **The claw
  holds one ring at a time.**
- **Bumping:** every solid part of the ROV can now push a ring, not only the nose and claw. A ring that isn't hooked or gripped is **pushed along,
  turned by where it was hit, and drifts to a stop in the water**. Hit the edge of a ring with a corner of the frame and it swings out of the way.
  Rings also push each other, and can't be pushed through a wall. The part that is hooking or gripping a ring doesn't push it.

**How collisions work.** `rov_shape.py` describes every solid part of the ROV as about 40 *capsules* (a line segment with a radius): the 12 frame pipes
and rails, the thruster bodies, shrouds and propellers, and either the nose or the claw (the jaws move as the claw opens and closes). Each ring is a
16-sided hoop of capsules. Every step, any ring near the ROV is tested against those parts; if a pipe overlaps the hoop the ring is moved out along the
contact direction, turned in proportion to how far off-centre the hit was, and given some drift. The ROV itself isn't slowed by what it pushes. It's
game-style physics, cheap (well under a millisecond per step), and good enough to see "that pipe hit the ring".
If you change the look of the ROV in `web/app.js`, update `rov_shape.py` to match.

**It lives in two files, so it is easy to drop: delete `rov_props.py` and `web/props.js`** (everything else skips it quietly), or run with
`--rings 0` / `-p rings:=0`. **Reset** puts the rings back.

## The fish (optional)

A little koi swims around the pool. It can **never be caught**, so nothing has to happen when it and the ROV "meet". What it does:
- **Wander:** lazy swimming between spots in open water, kept away from walls and corners.
- **Thread a ring:** now and then it swims through one of the rings: in one side, through the hoop, out the other (the hole is bigger than the fish).
  It gives up if the ring is picked up or pushed.
- **Peek:** if the ROV has sat still for a couple of seconds, the fish decides it is harmless and **swims over, within a few seconds, to hover in
  view of the ROV camera** (usually 0.8 to 1.2 m from the lens, just above the claw), looking into it for 8 to 16 seconds. Then it wanders off and
  comes back for another look about every half minute, for as long as the ROV stays still. It swims *around* the ROV rather than through it. The moment
  the ROV moves, that trust is gone. (It works with the default floating ROV too: it just takes the spot in the water the fish can use.)
- **Flee:** if the ROV comes close (about 1.6 m) it bolts, faster than the ROV can swim. It plans its escape **in three dimensions**: for every
  direction, including diving and climbing, it rehearses about 1.8 seconds of swimming (including the time it takes to turn around, speed up and tilt)
  against a ROV chasing flat out, and picks the route that leaves the most distance and the most open water. The ROV is slow going up and down, so a fish
  that dives or climbs usually gets clear. Routes into walls and corners score badly; if it ends up pressed against a wall it re-plans at once.

How it stays uncatchable: it flees early, it is faster than the ROV, and a hard rule keeps it at least **30 cm** from the ROV's surface: it is pushed clear,
and if the pool geometry won't let it (cornered) it **darts** to the free spot farthest from the ROV. Against a perfect-aim autopilot chasing it
non-stop in this small pool (much harder than any person would manage) it still has to dart about once every 25 seconds; against a person it should be
rare. It respects the pool (walls, floor, surface, and the step: it only enters the shallow end when its depth allows).

`fish` / `--fish N` sets how many (0 to 3). **It lives in two files: delete `rov_fish.py` and `web/fish.js` to remove it** (or `--fish 0`).
The behaviour numbers (distances, speeds, how far ahead it rehearses) are constants at the top of the `Fish` class in `rov_fish.py`.

## Parameters

Read once at startup. `ros2 run`-style for `rov_sim.py`: `--ros-args -p name:=value`. For `keyboard_sim.py`: `--name value`.

| Parameter | Default | Meaning |
|---|---|---|
| `port` | 8000 | web page port |
| `keys` | true | the page's keyboard also drives the ROV (ROS version) |
| `joy` | true | publish the on-screen joysticks on `/sim/joy1`, `/sim/joy2` |
| `tool` | claw | starting tool: `claw` or `nose` |
| `rings` | 3 | how many pick-up rings, 0 to 5 (`--rings`; `--no-ring` = 0 on the keyboard version) |
| `fish` | 1 | how many fish, 0 to 3 (`--fish`) |
| `crabs` | 1 | how many green crabs on the shallow end's floor, 0 to 5 (`--crabs`); the 2026 scout task has two |
| `current` | false | make the water run out of the two wall outlets, a current across the pool (`--current`): see *The water outlets and the current* |
| `thrusters` | 4 | how many thrusters (`--thrusters` / ROS `thrusters:=`): **3** one up/down thruster (no nose trim); **4** the original (t1 left, t2 right, t3 front and t4 rear up/down); **6** t1-t4 horizontal on the four vertical posts, angled 45 degrees in an X (front left, front right, rear left, rear right: forward, turn **and slide sideways**, Q / E), plus t5 and t6 up/down; **8** one tilted thruster just outside each of the cube's 8 corners (t1-t4 top, t5-t8 bottom; front left, front right, rear left, rear right; the rear ones the mirror images of the front ones, fanning out like an X (front ones point forward, rear ones backward) and leaning 45 degrees up (top) or down (bottom), so each is at 45 / 135 degrees to the PVC; every movement is one +-1 pattern over the corners (see `computeCommand` in `web/controls.js`); they give all six movements, roll included with U / O; `kind: "c"` in the layout table, 3/4 of the push of a horizontal one: `CORNER_SHARE`). The layouts live in `THRUSTER_LAYOUTS` (`rov_physics.py`, `web/sim/physics.js`); the state carries the layout, so the page and the serial link follow it. In the browser the Config dialog changes it live |
| `speed` | 1 | power of the red and green (horizontal) thrusters, 0.25 to 4 (`--speed`). **1 is the normal speed, which is half of what these thrusters used to give** (`SIDE_THRUST = 0.5` in `rov_physics.py`); 2 is the old strength |
| `max_thrust` | 12 | newtons the thrusters could give at full command; the horizontal ones give `SIDE_THRUST x speed` of it (6 N at the normal speed), the two vertical thrusters share one such budget (6 N each) |
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

## Tests

`python3 nodes/rov_sim/test_physics.py` (about 20 seconds; no ROS or browser needed; add a word to run only some, e.g. `... ring`) checks the physics:
the pool walls and floors, the step to the shallow end, rings being pushed, spun and picked up, claw and nose behaviour, and the fish (an autopilot chases
it flat out for eight minutes and it must never get within reach or get stuck in corners; it must also peek at a still ROV and thread the rings). Run it after changing anything in `rov_physics.py`, `rov_shape.py`, `rov_props.py`
or `rov_fish.py`.

## Files in this folder

| File | What it is |
|---|---|
| `rov_sim.py` | the ROS node (channels, parameters) |
| `keyboard_sim.py` | the same pool without ROS |
| `rov_physics.py` | **the physics**, thruster layout, and the tiny web server (no ROS in it); tune the feel here |
| `rov_shape.py` | the ROV's solid shape (capsules) used for collisions; keep it in step with the model in `web/app.js` |
| `rov_props.py` + `web/props.js` | the optional rings and their collisions (delete both to remove them) |
| `rov_fish.py` + `web/fish.js` | the optional fish (delete both to remove it) |
| `test_physics.py` | checks of the physics in plain Python, no ROS (see [Tests](#tests)) |
| `web/` | the page: `index.html`, `app.js` (3D scene, readouts, joysticks), `vendor/` (three.js) |
| `student_*.py` | examples for students (see [Nodes](#nodes)) |
| `install.sh` | self-test (needs `source mac/env.sh`) |

A real vehicle later: keep these channel names as the interface and the same student code can drive a bridge to real thrusters (see `docs/PROTOCOL.md`).
