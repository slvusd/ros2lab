# What each step changes on your Mac
(Updated as each step is completed.)

## Step 2 — micromamba + ROS 2 Jazzy environment  (mac/00, 01)
- `brew install micromamba` (one Homebrew package; no shell files edited).
- Created `~/micromamba/envs/ros_jazzy` with ros-jazzy-desktop, joy,
  rmw-fastrtps-cpp, colcon and compilers. Undo: `micromamba env remove -n ros_jazzy`.
- Verified: `nodes/demo_talker_listener/install.sh` PASS (talker -> listener).
- Use it: `source mac/env.sh` in each new terminal.

## Step 3 — build slvrov_interfaces  (nodes/slvrov_interfaces/install.sh)
- Cloned `slvrov_ros` into `ws/src/` (git-ignored), checked out `d8f8746`
  (2026-04-23), built only `slvrov_interfaces` into `ws/install/`.
- Verified: `ros2 interface show slvrov_interfaces/msg/PCA9685Command` prints
  `string[] id` / `float32[] pwm`. Pure messages; no Pi hardware needed.
- Note: the Mac env has Python 3.14; the Pi has 3.12. Fine for messages, but
  watch for it when running Python nodes from slvrov_nodes_python.
- Use it: `source ws/install/setup.bash` after `source mac/env.sh`.

## Step 4 — Pico 2 and micro:bit via one generic bridge  (nodes/serial_bridge, pico, microbit)
- Text protocol `p:` publish / `s:` subscribe / `m:` message (docs/PROTOCOL.md);
  numbers and strings only; no libraries on the devices.
- `nodes/serial_bridge/install.sh` adds `pyserial` to ros_jazzy if missing.
  `nodes/pico/install.sh` additionally makes sure `mpremote` exists (yours is at
  /opt/homebrew/bin/mpremote; otherwise it adds pip + mpremote to the env).
- Verified on the Mac with a fake device (5 PASS checks: Float32 and String
  publish, name cleaning, subscribe -> topic, ROS -> device). The Pico and
  micro:bit programs are untested on hardware.

## Step 5 — Joystick on the Mac + turtle  (mac/env.sh, launch/turtle_joy.launch.py)
- Logitech F310 must be set to **D** (back switch). In X mode macOS sees only a
  vendor-specific USB device and SDL/joy_node cannot read it.
- `mac/env.sh` now exports `SDL_JOYSTICK_MFI=0`; without it SDL lists no
  joysticks from a terminal on macOS. Verified: `joy_enumerate_devices` lists
  "Logitech Dual Action"; `joy_node` published 264 `/joy` messages.
- `launch/turtle_joy.launch.py` starts turtlesim + joy_node + teleop_twist_joy
  (left stick drives). All three nodes start and the joystick opens; driving the
  turtle by hand was not yet confirmed at commit time.
- Fixed `nodes/demo_talker_listener/install.sh`: `ros2 run` wrappers were killed
  but the real nodes kept running. Now stops the children too (verified: 0 left).
- Tip: if `ros2 node list` shows a node name twice, a stray process is running
  (`ps -axo pid,command | grep -E "joy_node|turtlesim"`).

## Step 6 — ROV pool simulator  (nodes/rov_sim)
- New `nodes/rov_sim/`: a ROS 2 node (`rov_sim.py`) that subscribes to
  `/rov/thruster/{left,right,vertical}` (Float32), `/rov/hook` (Bool) and serves a
  three.js 3D pool at http://localhost:8000 (view it in VS Code "Simple Browser").
  three.js is vendored in `web/vendor/`; nothing is installed. `.vscode/tasks.json` adds a "ROV pool" task.
- Verified: `nodes/rov_sim/install.sh` PASS (page served, thrusters move it, dive, /rov/depth).
  Rendered in headless Chrome (orbit + follow views looked right).
- Note: `ros2 topic list` hung on this Mac (stale CLI daemon); `--no-daemon` works.
- Added `keyboard_sim.py` (no ROS; drive the ROV from the browser keyboard). Physics moved to
  `rov_physics.py`, shared by both. Verified keyboard commands over HTTP and `install.sh` still PASS.
- Water FX: refraction shader + wave simulation (toggle button), see-through walls/floor/deck
  when orbiting, underwater view. Physics: soft surface (pops out of the water and settles) and
  bouncy floor with silt puff; `--hard-limits` restores the old stops. Checked in headless Chrome.
- Rev: hook replaced by a switchable **claw** (jaws pinch left/right) or fixed upturned **nose**
  (`/rov/claw`, `/rov/hook` kept as alias); center tube removed; no more random big ripples;
  surface rest height = top 1/8 of the cube; `V` resets the camera (fits narrow windows).
- Claw is now a servo (`/rov/claw` Float32 0..1; keys `[` `]`), mounted on the front bottom PVC bar.
  Optional pick-up ring: `rov_props.py` + `web/props.js` (delete both to remove; `--no-ring` skips it).
  Page re-fits on resize (VS Code Simple Browser sometimes laid out late). Verified: grab/carry/release in
  Python, screenshots of open and holding states, runs cleanly with the ring files deleted, install.sh PASS.
- Walls now stop the real footprint (frame + thrusters + tool tip) and slide the ROV along them. The ring is
  a weighted hoop standing on the floor: lift it by threading the NOSE through it and rising, or pinch its side
  rim with the claw. The active tool is now simulator state (`/rov/tool`, Tool button, `--tool`). Tested the
  nose lift/turn/carry/set-down/back-out sequence through the real server, and a copy with rov_props.py and
  props.js deleted.
- Vertical thruster moved to the bottom crossbars; its propeller only works under water (`THRUSTER_UP`), so
  the ROV rises ~10 cm out at 80% thrust (`EMERGE_K` 150 -> 96). A hanging/held ring tilts the ROV nose-down
  (~6 deg / ~4 deg, `pitch` in state; nose/claw geometry follows it). Note: a `keyboard_sim.py` started before this
  change must be restarted to pick it up.
- IMU (`/rov/imu` sensor_msgs/Imu at 50 Hz + page readout; `student_imu_example.py`): orientation, angular velocity,
  accelerometer incl. gravity. Vertical thruster split into front/rear (`/rov/thruster/front|rear`, `vertical` sets both);
  tilt is now a real torque (ring weight) that the pair can cancel. Default buoyancy is +1.5 N so the ROV FLOATS with the
  top ~4 cm out (it used to be neutral, so it could only be out of the water while thrusting). Verified numerically
  (float, 80% rest height, tilt cancel, IMU at rest/accel/turn), install.sh PASS incl. IMU, screenshot of the HUD.
- Fixed the double image of a part of the ROV sticking out of the water: the refraction picture is now clipped to the
  far side of the surface. Floating rest height 6 cm out (80% thrust: ~14 cm). Added a Buoyancy button/B key (floats /
  neutral / sinks; a pool setting, not a ROS topic) and a "minus g" IMU row. IMU checked: steady rise reads 9.81.
- Thrusters are now visibly attached: mid-height rails on both sides of the frame carry the side thrusters (two pipes
  and two clamp collars each); the vertical thrusters sit on saddle blocks clamped to the bottom bar (propeller end up).
  Looks only; no physics change. Checked in close-up screenshots.
- Refraction now uses the scene's depth (depth texture of the underwater picture): the apparent shift grows with how deep
  something is, so pipes crossing the surface stay joined (before, everything shifted as if 1 m deep, which broke them at the
  waterline). Costs the multisampling of that picture, so it renders at full resolution with a small blur. IMU readout shows
  3 decimals; `imu_resolution` mimics a real IMU's step.
- Floor contact now uses the real lowest point of the model (`ROV_BOTTOM` = 0.28 m below centre) instead of the pipe
  centre line, so the bottom pipes and clamps rest ON the pool floor instead of half-sinking into it (centre depth at
  rest on the floor: 1.72 m, was 1.75 m).
- Claw grab fixed: it now tests whether a piece of the hoop is between the jaws (anywhere from hinge to fingertip, gap
  narrowing as they close) and grips the moment the claw is commanded closed (<= 0.25); open (> 0.25) releases. Before, only a
  single point 52 cm ahead counted, so a tube anywhere else was "grabbed" without holding. HUD shows "ring between jaws".
- `rov_sim.py` (ROS) now also takes the page's keyboard (`-p keys:=false` to disable): per channel the last new value wins
  (keyboard is edge-triggered via `apply_keyboard`). `keyboard_sim.py` is unchanged for users: same pool without ROS. Tested both
  writing to the same ROV (left from ROS, front/rear/right from keys, claw from both).
- Added `student_minimal.py` (~15 lines of code, plain script: publish thruster on, sleep, off). Tested against `rov_sim.py`:
  ROV moves +2.4 m; the 1 s wait is not needed on one machine (8/8 without it) but is kept for network discovery.
- On-screen joystick (top right, drag with the mouse) publishing sensor_msgs/Joy on /joy (F310-shaped: 8 axes, 11 buttons; LEFT and UP
  positive), also shown in the page readout. Does not drive the ROV itself: `student_joystick.py` shows how to connect it. Tested:
  stick -> /joy message -> student node -> thrusters -> ROV moves (+2.09 m in 2 s); install.sh checks /joy.
- Two on-screen joysticks (joy1 left, joy2 right) publishing sensor_msgs/Joy on /sim/joy1 and /sim/joy2 (replaces the single /joy stick).
- All channels renamed to a short /sim/ prefix: thrusters /sim/t1../t4 (t1 left, t2 right, t3 front vertical, t4 rear vertical;
  no "turn"/"vertical-both" shortcuts: students mix them), /sim/claw, /sim/tool, /sim/reset, /sim/imu, /sim/depth, /sim/heading.
  Old /rov/... names are gone. nodes/rov_sim/README.md rewritten as a reference (nodes, channels, command-line cheat sheet,
  troubleshooting), with the commands checked against a live sim. install.sh updated and passing (incl. both joysticks).
- L-shaped pool: the pool is now a list of rectangles with floor depths (`POOL_REGIONS` in rov_physics.py): the original 6x3x2 m deep end plus
  a 2.5x2.5 m shallow end (1 m deep) off the left side at the far end. Physics: footprint kept inside the union of regions that are open at
  the ROV's depth (so the step is a wall to a deep ROV), floor depth varies by position (diving over the shelf stops on it, no teleporting),
  ring floor/clamp follow the region (a hanging ring can be carried over the step and set on the shelf). Page: floors, walls (outer + step),
  deck, masked water grid and wave simulation, shadows/silt, x-ray walls and camera all generated from the region list.
  Tested: 20 random 20 s runs (all buoyancies/depths) never left the pool or passed a floor; full ring mission carry-to-shelf; screenshots.
- Collisions and company: `rov_shape.py` models the ROV as ~40 capsules (frame, thrusters, nose or moving claw jaws). Rings are 16-segment hoops that
  are now pushed, spun by where they were hit, and left coasting by any part of the ROV (the hooking/gripping part excepted); rings push each other;
  3 rings by default (`rings`/`--rings`), the claw holds one at a time. A coy fish (`rov_fish.py` + `web/fish.js`, `fish`/`--fish`) wanders, looks, bolts,
  and cannot be caught (early flee + rehearsed escapes + faster than the ROV + hard 55 cm exclusion with a dart fallback). `test_physics.py` has
  19 plain-Python checks and runs from install.sh. Floor limit now only counts regions open to the ROV (hardening against a shelf-depth "bounce").
- ROV camera: a small camera on a short pipe under the top-front edge (housing + lens in the model, a capsule in rov_shape.py), looking forward and down
  ~29 deg so the front of the claw is in view; its picture (320x240, ~15 fps) goes through the same water pipeline from its own position, with solid
  walls, and is shown in a window under joy2. Page-only (not a ROS image topic). renderScene was generalised to renderView(camera, targets).
- Fish brain rewritten: escape routes are rehearsed in 3D (diving/climbing) including turn-around time (the old one assumed it could face any way
  instantly, so it pressed into walls at full speed while the ROV caught up); corners/walls score badly; it peeks into the ROV camera when the ROV has
  been still for 2 s, threads rings, and the hard exclusion is now 30 cm. Corner time while chased 19% -> ~8-11%. Tried reacting earlier to fast
  approaches and looking further ahead: both were worse (kept as a 0-valued knob). 22 plain-Python tests.
