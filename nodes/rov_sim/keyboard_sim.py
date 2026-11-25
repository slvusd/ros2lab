#!/usr/bin/env python3
# =============================================================================
# keyboard_sim.py — the ROV pool with NO ROS: drive it with the keyboard
# =============================================================================
# Run (plain Python 3, nothing to install):
#   python3 nodes/rov_sim/keyboard_sim.py            then open http://localhost:8000
# Options:  --port 8000  --speed 1  --max-thrust 12  --mass 8  --buoyancy 1.5  --imu-noise 0  --hard-limits  --rings 3  --fish 1  --crabs 1  --current  --tool claw|nose
#
# Click the page once so it has keyboard focus, then:
#   Switch box (top right of the page, like a scout controller, full power):
#     1 / 2  red switch (left thruster) reverse / forward      Left / Right arrows  green switch (right thruster) reverse / forward
#     Down / Up arrows  both vertical thrusters down / up
#   Extra keys (80% power; turn them all off with H = "H-bridge only", just the switch box):
#     W or Shift  both horizontal thrusters forward / S or Space reverse    A / D   turn left / right
#     R / F       both vertical thrusters up / down (the Up / Down arrows do too)
#     I / K       tilt nose up / down (front thruster up + rear down, or the reverse)
#     Z / C       left / right thruster ONLY (hold)
#   [ / ]       close / open the claw gradually (a servo)
#   N           drop a new pool ring into the water where the mouse is (it sinks; Reset removes it)
#   T           claw <-> nose tool         V  reset the camera view          X           stop everything
#   B           buoyancy: floats -> neutral (hovers) -> sinks   (a setting of the pool, not a ROS topic)
# Same physics as the ROS version (rov_physics.py), so tuning carries over.
# =============================================================================
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rov_physics import BUOYANCY, BUOYANCY_MODES, Rov, Shared, apply_keyboard, apply_ring_drops, clamp, start_server


def main():
    ap = argparse.ArgumentParser(description="ROV pool, keyboard-driven, no ROS")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--max-thrust", type=float, default=12.0)
    ap.add_argument("--speed", type=float, default=1.0, help="power of the red and green thrusters, 0.25 .. 4 (1 = normal)")
    ap.add_argument("--mass", type=float, default=8.0)
    ap.add_argument("--buoyancy", type=float, default=BUOYANCY, help="spare buoyancy in N (+ floats up; 0 hovers)")
    ap.add_argument("--imu-resolution", type=float, default=0.0, help="accelerometer step in m/s^2 (0 = exact, 0.01 = BNO055-like)")
    ap.add_argument("--imu-noise", type=float, default=0.0, help="IMU noise std-dev (m/s^2), 0 = clean")
    ap.add_argument("--tool", choices=["claw", "nose"], default="claw", help="front tool to start with")
    ap.add_argument("--rings", type=int, default=3, help="number of pick-up rings, 0-5 (rov_props.py)")
    ap.add_argument("--no-ring", action="store_true", help="no rings at all (same as --rings 0)")
    ap.add_argument("--fish", type=int, default=1, help="number of fish, 0-3 (rov_fish.py)")
    ap.add_argument("--current", action="store_true", help="two water outlets in the shallow end's side wall make a current across the pool (rov_current.py)")
    ap.add_argument("--crabs", type=int, default=1, help="number of green crabs on the shallow end's floor, 0-5 (rov_crab.py)")
    ap.add_argument("--hard-limits", action="store_true",
                    help="stop dead at the surface/floor (no overshoot or bounce)")
    a = ap.parse_args()

    rov = Rov(a.max_thrust, a.mass, a.buoyancy, a.hard_limits, a.tool, a.imu_noise, a.imu_resolution, a.speed)
    try:                           # optional extras; each works without its file (see the file's header)
        import rov_props
        rov_props.add_to(rov, 0 if a.no_ring else a.rings)
    except ImportError:
        pass
    try:
        import rov_fish
        rov_fish.add_to(rov, a.fish)
    except ImportError:
        pass
    try:
        import rov_crab
        rov_crab.add_to(rov, a.crabs)
    except ImportError:
        pass
    try:                           # the two outlets in the shallow end's side wall are always there; --current makes the water run
        import rov_current
        rov_current.add_to(rov, a.current)
    except ImportError:
        if a.current:
            print("(--current needs rov_current.py, which is missing)")
    shared = Shared(keys=True)
    server = start_server(shared, a.port)
    print(f"ROV pool (keyboard mode) is at http://localhost:{a.port}   (Ctrl+C to quit)")
    last = time.monotonic()
    try:
        while True:
            now = time.monotonic()
            dt = clamp(now - last, 0.0, 0.05)
            last = now
            if shared.reset_requested:
                shared.reset_requested = False
                rov.reset()
            if shared.buoyancy_request:        # the page's Buoyancy button
                rov.buoyancy, shared.buoyancy_request = BUOYANCY_MODES[shared.buoyancy_request], None
            if shared.tool_request:            # the page's Tool button
                rov.tool, shared.tool_request = shared.tool_request, None
            apply_ring_drops(shared, rov)   # the page's "drop a ring" key
            apply_keyboard(shared, rov)    # the browser sends a command whenever a key changes
            rov.step(dt)
            with shared.lock:
                shared.state = rov.state(keys=True)
                shared.state["joys"] = [list(j) for j in shared.joys]   # shown on the page; with no ROS they are not published
            time.sleep(1 / 60)
    except KeyboardInterrupt:
        pass
    server.shutdown()


if __name__ == "__main__":
    main()
