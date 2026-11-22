#!/usr/bin/env bash
# =============================================================================
# nodes/microbit/install.sh — get the Mac ready to work with micro:bit radio
# =============================================================================
# WHAT THIS DOES
#   Runs ../serial_bridge/install.sh (installs pyserial if needed and
#   self-tests the bridge against a fake device — no micro:bit required).
#   Nothing micro:bit-specific is installed on the Mac: the gateway micro:bit
#   just looks like a USB serial port.
#
# WHAT IT CHANGES
#   Possibly pyserial in the ros_jazzy env. Nothing else.
#
# PREREQUISITE:  source scripts/env.sh
# SAFE TO RE-RUN: yes.  Flashing the micro:bits: see README.md in this folder.
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source scripts/env.sh' first." >&2; exit 1; }
"$(cd "$(dirname "$0")" && pwd)/../serial_bridge/install.sh"
echo "Next: flash the gateway — see nodes/microbit/README.md"
