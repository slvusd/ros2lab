#!/usr/bin/env bash
# =============================================================================
# nodes/pico_bridge/install.sh — set up and self-test the Pico <-> ROS bridge
# =============================================================================
# WHAT THIS DOES
#   1. Installs `pyserial` (talk to USB serial ports) into the ros_jazzy env, and
#      makes sure `mpremote` (copies files to the Pico) is available.
#   2. Self-test WITHOUT a Pico: starts fake_pico.py (a virtual serial port),
#      runs pico_bridge.py against it, and checks (a) /pico/temp messages
#      arrive and (b) a /pico/led command reaches the "Pico".
#
# WHAT IT CHANGES
#   Adds pyserial to the ros_jazzy env (plus pip + mpremote only if you have no
#   mpremote already). Nothing outside the env.
#   Undo: micromamba remove -n ros_jazzy pyserial
#
# PREREQUISITE:  source scripts/env.sh
# SAFE TO RE-RUN: yes.
#
# PUTTING THE PROGRAM ON A REAL PICO 2 — see README.md in this folder.
# =============================================================================
set -euo pipefail
[ "${ROS_DISTRO:-}" = "jazzy" ] || { echo "Run 'source scripts/env.sh' first." >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== Installing pyserial and mpremote =="
micromamba install -y -n ros_jazzy -c conda-forge --channel-priority strict pyserial
# mpremote is not on conda-forge. Use one already on your PATH (e.g. Homebrew's),
# otherwise add pip to the env and install it from PyPI.
if ! command -v mpremote >/dev/null 2>&1; then
  micromamba install -y -n ros_jazzy -c conda-forge --channel-priority strict pip
  python -m pip install --quiet mpremote
fi
echo "mpremote: $(command -v mpremote)"

echo "== Self-test with a fake Pico =="
TMP="$(mktemp -d)"; CMDLOG="$TMP/received.txt"; : > "$CMDLOG"
cleanup() { kill ${FPID:-} ${BPID:-} 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

python "$HERE/fake_pico.py" "$CMDLOG" > "$TMP/port.txt" &  FPID=$!
sleep 1; PORT="$(head -1 "$TMP/port.txt")"
python "$HERE/pico_bridge.py" --ros-args -p port:="$PORT" >/dev/null 2>&1 &  BPID=$!
sleep 4

TEMP="$(timeout 8 ros2 topic echo --once /pico/temp std_msgs/msg/Float32 | grep '^data' || true)"
ros2 topic pub --times 3 --rate 5 /pico/led std_msgs/msg/Bool "{data: true}" >/dev/null
sleep 1

[ -n "$TEMP" ] && echo "PASS: received from Pico -> /pico/temp ($TEMP)" || { echo "FAIL: no /pico/temp"; exit 1; }
grep -q "led,1" "$CMDLOG" && echo "PASS: /pico/led -> Pico received 'led,1'" || { echo "FAIL: led command not received"; exit 1; }
