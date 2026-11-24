#!/usr/bin/env bash
# =============================================================================
# nodes/serial_bridge/install.sh — set up and self-test the generic bridge
# =============================================================================
# WHAT THIS DOES
#   1. Makes sure `pyserial` is in the ros_jazzy environment.
#   2. Self-test WITHOUT hardware: fake_device.py (virtual serial port) speaks
#      docs/PROTOCOL.md; serial_bridge.py bridges it. Checks:
#        a) "p:temp,23.5"      -> /pico/temp is a Float32 23.5
#        b) "p:msg,hello,world"-> /pico/msg is a String "hello,world" (first comma only)
#        c) "p:Bad Name!,7"    -> topic /pico/bad_name_
#        d) "s:led" creates /pico/in/led; text published there reaches the
#           device as "m:led,1"
#
# WHAT IT CHANGES
#   Possibly adds pyserial to the ros_jazzy env (undo: micromamba remove -n ros_jazzy pyserial).
#
# PREREQUISITE:  source mac/env.sh
# SAFE TO RE-RUN: yes.
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source mac/env.sh' first." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

python -c "import serial" 2>/dev/null || \
  micromamba install -y -n ros_jazzy -c conda-forge --channel-priority strict pyserial

echo "== Self-test with a fake device =="
TMP="$(mktemp -d)"; CMDLOG="$TMP/received.txt"; : > "$CMDLOG"
cleanup() { kill ${FPID:-} ${BPID:-} 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

python "$HERE/fake_device.py" "$CMDLOG" > "$TMP/port.txt" & FPID=$!
sleep 1; PORT="$(head -1 "$TMP/port.txt")"
python "$HERE/serial_bridge.py" --ros-args -p port:="$PORT" -p ns:=pico >/dev/null 2>&1 & BPID=$!
sleep 4

fail() { echo "FAIL: $1"; exit 1; }
T="$(timeout 8 ros2 topic echo --once /pico/temp std_msgs/msg/Float32 | grep '^data' || true)"
[ "$T" = "data: 23.5" ] && echo "PASS: p:temp -> /pico/temp ($T)" || fail "/pico/temp got '$T'"
M="$(timeout 8 ros2 topic echo --once /pico/msg std_msgs/msg/String | grep '^data' || true)"
[ "$M" = "data: hello,world" ] && echo "PASS: p:msg -> /pico/msg String ($M)" || fail "/pico/msg got '$M'"
TOPICS="$(ros2 topic list)"   # (capture first: grep -q closing the pipe early breaks ros2)
echo "$TOPICS" | grep -qx "/pico/bad_name_" && echo "PASS: 'Bad Name!' -> /pico/bad_name_" || fail "name not cleaned"
echo "$TOPICS" | grep -qx "/pico/in/led" && echo "PASS: s:led created /pico/in/led" || fail "no /pico/in/led"
ros2 topic pub --times 3 --rate 5 /pico/in/led std_msgs/msg/String "{data: '1'}" >/dev/null
sleep 1
grep -q "^m:led,1$" "$CMDLOG" && echo "PASS: /pico/in/led -> device received 'm:led,1'" || fail "m:led,1 not received"
