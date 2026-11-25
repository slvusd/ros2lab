#!/usr/bin/env bash
# =============================================================================
# nodes/rov_sim/install.sh — self-test the classroom ROV pool simulator
# =============================================================================
# WHAT THIS DOES
#   Installs nothing (the sim uses only ROS 2 + Python's standard library; the
#   3D library three.js is already in web/vendor/). It starts the sim, then checks:
#     a) the web page is served on http://localhost:8000 (a test port is used)
#     b) publishing 1.0 to /sim/t1 + /sim/t2 moves the ROV forward
#     c) publishing -1.0 to /sim/t3 + /sim/t4 makes it dive (depth grows)
#     d) /sim/claw moves the claw servo
#     e) /sim/imu, /sim/depth and both on-screen joysticks (/sim/joy1, /sim/joy2) are published
#     f) test_physics.py passes (pool, rings and collisions, fish) and test_crab.py (the green crab and the pushable base class)
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
pub /sim/t1 1.0; pub /sim/t2 1.0; pub /sim/t3 -1.0; pub /sim/t4 -1.0
sleep 2
X1="$(state x)"; D1="$(state depth)"
python -c "import sys; sys.exit(0 if $X1 > $X0 + 0.2 else 1)" \
  && echo "PASS: thrusters moved it forward ($X0 -> $X1)" || fail "x did not increase ($X0 -> $X1)"
python -c "import sys; sys.exit(0 if $D1 > $D0 + 0.1 else 1)" \
  && echo "PASS: vertical thrusters (t3, t4) dived ($D0 -> $D1 m)" || fail "depth did not increase ($D0 -> $D1)"
pubb() { timeout 15 ros2 topic pub -1 "$1" std_msgs/msg/Float32 "{data: $2}" >/dev/null 2>&1; }
pubb /sim/claw 0.5; sleep 2
C="$(state claw)"
python -c "import sys; sys.exit(0 if abs($C - 0.5) < 0.05 else 1)" \
  && echo "PASS: /sim/claw 0.5 -> claw half open ($C)" || fail "claw did not reach 0.5 ($C)"
timeout 12 ros2 topic echo --no-daemon --once /sim/imu sensor_msgs/msg/Imu > "$TMP_IMU" 2>&1 || true
grep -q "linear_acceleration" "$TMP_IMU" && echo "PASS: /sim/imu published (sensor_msgs/Imu)" || fail "/sim/imu silent"
( for _ in $(seq 1 30); do
    curl -s -X POST -d '{"n":1,"axes":[0.5,1.0]}' "http://localhost:$PORT/joy" >/dev/null
    curl -s -X POST -d '{"n":2,"axes":[-0.5,0.25]}' "http://localhost:$PORT/joy" >/dev/null
    sleep 0.3; done ) & JOYPID=$!
for N in 1 2; do
  timeout 12 ros2 topic echo --no-daemon --once /sim/joy$N sensor_msgs/msg/Joy > "$TMP_IMU" 2>&1 || true
  grep -q "frame_id: joy$N" "$TMP_IMU" && echo "PASS: on-screen joystick $N -> /sim/joy$N (sensor_msgs/Joy)" || fail "/sim/joy$N silent"
done
kill $JOYPID 2>/dev/null; wait $JOYPID 2>/dev/null || true
timeout 10 ros2 topic echo --no-daemon --once /sim/depth std_msgs/msg/Float32 | grep -q '^data' \
  && echo "PASS: /sim/depth published" || fail "/sim/depth silent"
python3 "$HERE/test_physics.py" > "$TMP_IMU" 2>&1 && echo "PASS: physics tests ($(tail -1 "$TMP_IMU"))" || { cat "$TMP_IMU"; fail "physics tests"; }
if [ -f "$HERE/test_crab.py" ]; then      # the crab is an optional add-on with its own tests
  python3 "$HERE/test_crab.py" > "$TMP_IMU" 2>&1 && echo "PASS: crab tests ($(tail -1 "$TMP_IMU"))" || { cat "$TMP_IMU"; fail "crab tests"; }
fi
echo "All good. Start it for real: python nodes/rov_sim/rov_sim.py   then open http://localhost:8000"
