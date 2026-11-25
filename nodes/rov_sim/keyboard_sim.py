#!/usr/bin/env python3
# =============================================================================
# keyboard_sim.py — the ROV pool with NO ROS: drive it with the keyboard
# =============================================================================
# Run (plain Python 3, nothing to install):
#   python3 nodes/rov_sim/keyboard_sim.py            then open http://localhost:8000
# Options:  --port 8000  --max-thrust 12  --mass 8  --buoyancy 1.5  --imu-noise 0  --hard-limits  --no-ring  --tool claw|nose
#
# Click the page once so it has keyboard focus, then:
#   W / Up      both thrusters forward         S / Down    both reverse
#   A / Left    turn left                      D / Right   turn right
#   R / Space   both vertical thrusters up     F / Shift   both down
#   I / K       tilt nose up / down (front thruster up + rear down, or the reverse)
#   Z / C       left / right thruster ONLY (hold)
#   H           open / close the claw      [ / ]  close / open it gradually (a servo)
#   T           claw <-> nose tool         V  reset the camera view          X           stop everything
#   B           buoyancy: floats -> neutral (hovers) -> sinks   (a setting of the pool, not a ROS topic)
# Same physics as the ROS version (rov_physics.py), so tuning carries over.
# =============================================================================
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rov_physics import BUOYANCY, BUOYANCY_MODES, Rov, Shared, apply_keyboard, clamp, start_server


def main():
    ap = argparse.ArgumentParser(description="ROV pool, keyboard-driven, no ROS")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--max-thrust", type=float, default=12.0)
    ap.add_argument("--mass", type=float, default=8.0)
    ap.add_argument("--buoyancy", type=float, default=BUOYANCY, help="spare buoyancy in N (+ floats up; 0 hovers)")
    ap.add_argument("--imu-resolution", type=float, default=0.0, help="accelerometer step in m/s^2 (0 = exact, 0.01 = BNO055-like)")
    ap.add_argument("--imu-noise", type=float, default=0.0, help="IMU noise std-dev (m/s^2), 0 = clean")
    ap.add_argument("--tool", choices=["claw", "nose"], default="claw", help="front tool to start with")
    ap.add_argument("--no-ring", action="store_true", help="leave out the pick-up ring (rov_props.py)")
    ap.add_argument("--hard-limits", action="store_true",
                    help="stop dead at the surface/floor (no overshoot or bounce)")
    a = ap.parse_args()

    rov = Rov(a.max_thrust, a.mass, a.buoyancy, a.hard_limits, a.tool, a.imu_noise, a.imu_resolution)
    if not a.no_ring:
        try:                       # optional extras; works without rov_props.py (see its header)
            import rov_props
            rov_props.add_to(rov)
        except ImportError:
            pass
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
