#!/usr/bin/env bash
# =============================================================================
# 01_create_ros_env.sh — create the isolated "ros_jazzy" environment
# =============================================================================
# WHAT THIS DOES
#   Creates a micromamba environment named `ros_jazzy` containing ROS 2 Jazzy
#   (matching the ROV's Ubuntu 24.04 / Jazzy) plus the tools to build packages.
#
# PACKAGES (all from the conda-forge and robostack-jazzy channels)
#   ros-jazzy-desktop           ROS 2 core + rviz2, demos, turtlesim, tools
#   ros-jazzy-joy               joy_node: reads a joystick, publishes /joy
#   ros-jazzy-rmw-fastrtps-cpp  Fast DDS middleware (what the ROV uses)
#   colcon-common-extensions    `colcon build`, builds ROS packages
#   compilers cmake ninja pkg-config make   build tools for colcon
#
# SIZE / TIME: roughly 2-4 GB download, 5-15 minutes.
#
# WHAT IT CHANGES
#   - Creates ~/micromamba/envs/ros_jazzy. Nothing else on your Mac is touched.
#
# UNDO
#   micromamba env remove -n ros_jazzy
#
# SAFE TO RE-RUN: yes (exits if the environment already exists).
# =============================================================================
set -euo pipefail

ENV_NAME="ros_jazzy"
# Keep all environments in ~/micromamba (same value used by env.sh).
export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$HOME/micromamba}"

command -v micromamba >/dev/null 2>&1 || { echo "Run mac/00_install_micromamba.sh first." >&2; exit 1; }

if micromamba env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
  echo "Environment '$ENV_NAME' already exists. Nothing to do."
  echo "(To rebuild it: micromamba env remove -n $ENV_NAME, then re-run.)"
  exit 0
fi

# Strict channel priority is RoboStack's documented recommendation: it stops
# conda-forge and robostack packages being mixed in incompatible ways.
micromamba create -y -n "$ENV_NAME" \
  -c conda-forge -c robostack-jazzy \
  --channel-priority strict \
  ros-jazzy-desktop \
  ros-jazzy-joy \
  ros-jazzy-rmw-fastrtps-cpp \
  colcon-common-extensions \
  compilers cmake ninja pkg-config make

echo
echo "Environment created. Activate it in a terminal with:"
echo "    source mac/env.sh"
