#!/usr/bin/env bash
# =============================================================================
# nodes/demo_talker_listener/install.sh — verify ROS 2 works (no hardware)
# =============================================================================
# WHAT THIS DOES
#   Installs nothing. The demo nodes ship inside ros-jazzy-desktop (script 01).
#   This runs a "talker" node and a "listener" node together for a few seconds
#   and checks the listener received the talker's messages.
#
# WHAT IT PROVES
#   ROS 2 starts, its middleware (DDS) works, and nodes discover each other.
#
# WHAT IT CHANGES
#   Nothing on disk. Starts two short-lived processes, then stops them.
#
# PREREQUISITE:  source scripts/env.sh
# =============================================================================
set -euo pipefail

[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source scripts/env.sh' first." >&2; exit 1; }

OUT="$(mktemp)"
trap 'kill $TPID $LPID 2>/dev/null; wait $TPID $LPID 2>/dev/null; rm -f "$OUT"' EXIT

ros2 run demo_nodes_cpp talker >/dev/null 2>&1 & TPID=$!
ros2 run demo_nodes_cpp listener >"$OUT" 2>&1 & LPID=$!

echo "Running talker + listener for 8 seconds..."
sleep 8

if grep -q "I heard" "$OUT"; then
  echo "PASS: listener received messages:"; grep "I heard" "$OUT" | head -3
else
  echo "FAIL: listener heard nothing. Output was:"; cat "$OUT"; exit 1
fi
