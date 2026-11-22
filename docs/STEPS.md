# What each step changes on your Mac
(Updated as each step is completed.)

## Step 2 — micromamba + ROS 2 Jazzy environment  (scripts/00, 01)
- `brew install micromamba` (one Homebrew package; no shell files edited).
- Created `~/micromamba/envs/ros_jazzy` with ros-jazzy-desktop, joy,
  rmw-fastrtps-cpp, colcon and compilers. Undo: `micromamba env remove -n ros_jazzy`.
- Verified: `nodes/demo_talker_listener/install.sh` PASS (talker -> listener).
- Use it: `source scripts/env.sh` in each new terminal.
