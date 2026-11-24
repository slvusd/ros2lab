#!/usr/bin/env bash
# =============================================================================
# nodes/pico/install.sh — get the Mac ready to work with a Pico 2
# =============================================================================
# WHAT THIS DOES
#   1. Runs ../serial_bridge/install.sh (installs pyserial if needed and
#      self-tests the bridge against a fake device — no Pico required).
#   2. Makes sure `mpremote` (copies files to the Pico) is available. It is not
#      on conda-forge, so we use one already on your PATH (e.g. Homebrew's),
#      otherwise add pip to the env and install it from PyPI.
#
# WHAT IT CHANGES
#   Possibly: pyserial in the ros_jazzy env, and pip + mpremote if you have no mpremote.
#
# PREREQUISITE:  source mac/env.sh
# SAFE TO RE-RUN: yes.  Flashing the Pico itself: see README.md in this folder.
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source mac/env.sh' first." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

"$HERE/../serial_bridge/install.sh"

if ! command -v mpremote >/dev/null 2>&1; then
  micromamba install -y -n ros_jazzy -c conda-forge --channel-priority strict pip
  python -m pip install --quiet mpremote
fi
echo "mpremote: $(command -v mpremote)"
echo "Next: flash MicroPython and copy pico/main.py — see nodes/pico/README.md"
