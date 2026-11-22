# What each step changes on your Mac
(Updated as each step is completed.)

## Step 2 — micromamba + ROS 2 Jazzy environment  (scripts/00, 01)
- `brew install micromamba` (one Homebrew package; no shell files edited).
- Created `~/micromamba/envs/ros_jazzy` with ros-jazzy-desktop, joy,
  rmw-fastrtps-cpp, colcon and compilers. Undo: `micromamba env remove -n ros_jazzy`.
- Verified: `nodes/demo_talker_listener/install.sh` PASS (talker -> listener).
- Use it: `source scripts/env.sh` in each new terminal.

## Step 3 — build slvrov_interfaces  (nodes/slvrov_interfaces/install.sh)
- Cloned `slvrov_ros` into `ws/src/` (git-ignored), checked out `d8f8746`
  (2026-04-23), built only `slvrov_interfaces` into `ws/install/`.
- Verified: `ros2 interface show slvrov_interfaces/msg/PCA9685Command` prints
  `string[] id` / `float32[] pwm`. Pure messages; no Pi hardware needed.
- Note: the Mac env has Python 3.14; the Pi has 3.12. Fine for messages, but
  watch for it when running Python nodes from slvrov_nodes_python.
- Use it: `source ws/install/setup.bash` after `source scripts/env.sh`.
