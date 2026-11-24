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
