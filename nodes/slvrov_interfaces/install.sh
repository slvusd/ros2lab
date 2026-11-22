#!/usr/bin/env bash
# =============================================================================
# nodes/slvrov_interfaces/install.sh — build the ROV's custom message package
# =============================================================================
# WHAT THIS DOES
#   1. Fetches the ROV code (slvusd/slvrov_ros) pinned to the late-April-2026
#      commit d8f8746 — the known-good baseline — into ./ws/src/slvrov_ros.
#   2. Builds ONLY the `slvrov_interfaces` package with colcon.
#
# WHAT IS slvrov_interfaces?
#   The custom ROS message/service definitions (PCA9685Command, pin-config
#   services). Both the ROV and the ground station must have identical copies
#   to understand each other's messages. It's pure message definitions — it
#   needs no Pi hardware, so it builds fine on a Mac.
#
# WHAT IT CHANGES
#   - Creates ./ws/ inside this repo (git-ignored): source, build/, install/.
#   - Nothing outside this repo folder.
#
# OPTIONS (environment variables)
#   SLVROV_ROS_REPO   where to clone from. Default: git@github.com:slvusd/slvrov_ros.git
#                     (needs GitHub access). Offline/local example:
#                     SLVROV_ROS_REPO=~/src/slvrov_ros ./nodes/slvrov_interfaces/install.sh
#   SLVROV_ROS_REF    commit/branch to use. Default: d8f8746
#
# PREREQUISITE:  source scripts/env.sh
# AFTER IT RUNS: source ws/install/setup.bash   (makes the messages visible)
# SAFE TO RE-RUN: yes.
# =============================================================================
set -euo pipefail

[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source scripts/env.sh' first." >&2; exit 1; }

REPO="${SLVROV_ROS_REPO:-git@github.com:slvusd/slvrov_ros.git}"
REF="${SLVROV_ROS_REF:-d8f8746}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/ws/src/slvrov_ros"

mkdir -p "$ROOT/ws/src"
if [ ! -d "$SRC/.git" ]; then
  echo "Cloning $REPO ..."
  # No --recurse-submodules: the slvrov-tools submodule is Pi-hardware code
  # we don't need for messages.
  git clone "$REPO" "$SRC"
fi
git -C "$SRC" checkout --quiet "$REF"
echo "Using slvrov_ros at $(git -C "$SRC" log -1 --format='%h %ad %s' --date=short)"

cd "$ROOT/ws"
# (The long "install_name_tool ... code signature" warnings are normal on macOS.)
colcon build --packages-select slvrov_interfaces --base-paths src/slvrov_ros/src 2>&1 | grep -v -e install_name_tool -e cctools-port

# Verify: ask ROS to describe one of the messages.
# shellcheck disable=SC1091
# colcon's setup.bash uses unset variables, so relax `set -u` just for it.
set +u; source install/setup.bash; set -u
ros2 interface show slvrov_interfaces/msg/PCA9685Command
echo
echo "PASS: slvrov_interfaces built. In each new terminal also run: source ws/install/setup.bash"
