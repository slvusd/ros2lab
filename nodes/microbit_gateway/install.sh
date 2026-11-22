#!/usr/bin/env bash
# =============================================================================
# nodes/microbit_gateway/install.sh — set up and self-test the micro:bit bridge
# =============================================================================
# WHAT THIS DOES
#   1. Makes sure `pyserial` is in the ros_jazzy environment (same as pico_bridge).
#   2. Self-test WITHOUT a micro:bit: fake_gateway.py (virtual serial port)
#      "receives" radio packets; microbit_gateway.py bridges them. Checks:
#        a) /microbit/rx gets the raw packet text
#        b) /microbit/temp gets a Float32           (packet "temp,23.5")
#        c) a name like "Bad Name!" becomes /microbit/bad_name_
#        d) text published on /microbit/tx reaches the gateway as "tx,<text>"
#
# WHAT IT CHANGES
#   Possibly adds pyserial to the ros_jazzy env. Nothing else.
#
# PREREQUISITE:  source scripts/env.sh
# SAFE TO RE-RUN: yes.
# FLASHING A REAL MICRO:BIT — see README.md in this folder.
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source scripts/env.sh' first." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

python -c "import serial" 2>/dev/null || \
  micromamba install -y -n ros_jazzy -c conda-forge --channel-priority strict pyserial

echo "== Self-test with a fake gateway =="
TMP="$(mktemp -d)"; CMDLOG="$TMP/received.txt"; : > "$CMDLOG"
cleanup() { kill ${FPID:-} ${BPID:-} 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

python "$HERE/fake_gateway.py" "$CMDLOG" > "$TMP/port.txt" & FPID=$!
sleep 1; PORT="$(head -1 "$TMP/port.txt")"
python "$HERE/microbit_gateway.py" --ros-args -p port:="$PORT" >/dev/null 2>&1 & BPID=$!
sleep 4

fail() { echo "FAIL: $1"; exit 1; }
RX="$(timeout 8 ros2 topic echo --once /microbit/rx std_msgs/msg/String | grep '^data' || true)"
[ -n "$RX" ] && echo "PASS: /microbit/rx ($RX)" || fail "no /microbit/rx"
TEMP="$(timeout 8 ros2 topic echo --once /microbit/temp std_msgs/msg/Float32 | grep '^data' || true)"
[ -n "$TEMP" ] && echo "PASS: /microbit/temp ($TEMP)" || fail "no /microbit/temp"
ros2 topic list | grep -qx "/microbit/bad_name_" && echo "PASS: 'Bad Name!' sanitized to /microbit/bad_name_" || fail "name not sanitized"
ros2 topic pub --times 3 --rate 5 /microbit/tx std_msgs/msg/String "{data: go}" >/dev/null
sleep 1
grep -q "^tx,go$" "$CMDLOG" && echo "PASS: /microbit/tx -> gateway received 'tx,go'" || fail "tx not received"
