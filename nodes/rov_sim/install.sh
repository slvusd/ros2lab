#!/usr/bin/env bash
# =============================================================================
# nodes/rov_sim/install.sh — self-test the classroom ROV pool simulator
# =============================================================================
# WHAT THIS DOES
#   Installs nothing (the sim uses only ROS 2 + Python's standard library; the
#   3D library three.js is already in web/vendor/). It starts the sim, then checks:
#     a) the web page is served on http://localhost:8000
#     b) publishing 1.0 to /rov/thruster/left + right moves the ROV forward
#     c) publishing -1.0 to /rov/thruster/vertical makes it dive (depth grows)
#     d) /rov/depth is published
#
# WHAT IT CHANGES
#   Nothing on disk. Starts one short-lived process, then stops it.
#
# PREREQUISITE:  source mac/env.sh
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source mac/env.sh' first." >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=8123
TMP_IMU="$(mktemp)"

python "$HERE/rov_sim.py" --ros-args -p port:=$PORT >/dev/null 2>&1 & SIM=$!
trap 'kill $SIM 2>/dev/null; wait $SIM 2>/dev/null || true; rm -f "$TMP_IMU"' EXIT
sleep 4
fail() { echo "FAIL: $1"; exit 1; }

curl -sf "http://localhost:$PORT/" | grep -q "ROV Pool" && echo "PASS: web page served" || fail "no web page"

state() {   # print one field of the latest state, e.g. state x
  # the event stream never ends, so curl is cut off (exit 28/23); that is expected
  { curl -s -m 2 "http://localhost:$PORT/events" || true; } | head -1 | python -c \
    "import sys,json; print(json.loads(sys.stdin.readline()[6:])['$1'])"
}
pub() { timeout 15 ros2 topic pub -1 "$1" std_msgs/msg/Float32 "{data: $2}" >/dev/null 2>&1; }

X0="$(state x)"; D0="$(state depth)"
pub /rov/thruster/left 1.0; pub /rov/thruster/right 1.0; pub /rov/thruster/vertical -1.0
sleep 2
X1="$(state x)"; D1="$(state depth)"
python -c "import sys; sys.exit(0 if $X1 > $X0 + 0.2 else 1)" \
  && echo "PASS: thrusters moved it forward ($X0 -> $X1)" || fail "x did not increase ($X0 -> $X1)"
python -c "import sys; sys.exit(0 if $D1 > $D0 + 0.1 else 1)" \
  && echo "PASS: vertical thruster dived ($D0 -> $D1 m)" || fail "depth did not increase ($D0 -> $D1)"
pubb() { timeout 15 ros2 topic pub -1 "$1" std_msgs/msg/Float32 "{data: $2}" >/dev/null 2>&1; }
pubb /rov/claw 0.5; sleep 2
C="$(state claw)"
python -c "import sys; sys.exit(0 if abs($C - 0.5) < 0.05 else 1)" \
  && echo "PASS: /rov/claw 0.5 -> claw half open ($C)" || fail "claw did not reach 0.5 ($C)"
timeout 12 ros2 topic echo --no-daemon --once /rov/imu sensor_msgs/msg/Imu > "$TMP_IMU" 2>&1 || true
grep -q "linear_acceleration" "$TMP_IMU" && echo "PASS: /rov/imu published (sensor_msgs/Imu)" || fail "/rov/imu silent"
timeout 10 ros2 topic echo --no-daemon --once /rov/depth std_msgs/msg/Float32 | grep -q '^data' \
  && echo "PASS: /rov/depth published" || fail "/rov/depth silent"
echo "All good. Start it for real: python nodes/rov_sim/rov_sim.py   then open http://localhost:8000"
