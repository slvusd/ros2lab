#!/usr/bin/env python3
# =============================================================================
# rov_sim.py — a tiny classroom ROV simulator: ROS 2 topics in, 3D pool in a browser
# =============================================================================
# Run (after `source mac/env.sh`):
#   python nodes/rov_sim/rov_sim.py
# Then open http://localhost:8000  (in VS Code: Cmd+Shift+P -> "Simple Browser: Show").
# No ROS handy, or just want to play? Use keyboard_sim.py instead.
# The full channel list, with examples of command-line queries, is in README.md.
#
# NODE   /rov_sim
#
# CHANNELS (all under /sim; thruster and claw commands are latched: they keep their last value)
#   subscribes  /sim/t1 .. /sim/t4   std_msgs/Float32   thrusters, -1.0 .. 1.0:
#                                      t1 left (horizontal), t2 right (horizontal),
#                                      t3 front (vertical, + = up), t4 rear (vertical, + = up)
#               /sim/claw            std_msgs/Float32   claw servo: 0.0 closed .. 1.0 fully open
#               /sim/tool            std_msgs/String    "claw" or "nose" (also the page's Tool button)
#               /sim/reset           std_msgs/Empty     back to the start position
#   publishes   /sim/imu             sensor_msgs/Imu    50 Hz: orientation, angular velocity, acceleration
#                                      (x forward, y left, z up; pitch + = nose down; accel includes gravity: +9.8 z at rest)
#               /sim/depth           std_msgs/Float32   metres below the surface
#               /sim/heading         std_msgs/Float32   degrees, 0 = +x end of pool, counter-clockwise +
#               /sim/joy1, /sim/joy2 sensor_msgs/Joy    the page's two on-screen joysticks, only while one is in use:
#                                      axes[0] left/right (LEFT +), axes[1] up/down (UP +)
#
# PARAMETERS  (ros2 run style:  --ros-args -p max_thrust:=15.0)   read once at startup
#   port (8000), keys (true: the page's keyboard also works, last new value per thruster wins),
#   joy (true: publish the on-screen joysticks), tool (claw | nose), ring (true: the pick-up ring),
#   max_thrust (N, 12), mass (kg incl. added mass, 8),
#   buoyancy (N of spare buoyancy, default 1.5: floats; 0 = hovers; negative sinks),
#   hard_limits (false; true = stop dead at surface/floor, no overshoot/bounce),
#   imu_noise (0; try 0.05, m/s^2 std-dev), imu_resolution (0 = exact; 0.01 = BNO055-like, m/s^2)
#
# The physics lives in rov_physics.py. Needs nothing beyond ROS 2 itself.
# =============================================================================
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu, Joy
from std_msgs.msg import Empty, Float32, String

from rov_physics import BUOYANCY, BUOYANCY_MODES, Rov, Shared, apply_keyboard, clamp, start_server

P = "/sim"          # every channel lives under this short prefix


class RovSim(Node):
    def __init__(self, shared):
        super().__init__("rov_sim")
        self.shared = shared
        self.declare_parameter("port", 8000)
        self.declare_parameter("keys", True)          # also accept the page's keyboard (last writer wins, per thruster)
        self.declare_parameter("joy", True)           # publish the page's on-screen joysticks
        self.declare_parameter("max_thrust", 12.0)
        self.declare_parameter("mass", 8.0)
        self.declare_parameter("buoyancy", BUOYANCY)
        self.declare_parameter("imu_noise", 0.0)
        self.declare_parameter("imu_resolution", 0.0)
        self.declare_parameter("hard_limits", False)
        self.declare_parameter("tool", "claw")        # front tool: claw or nose (or publish /sim/tool)
        self.declare_parameter("ring", True)          # the optional pick-up ring (rov_props.py)
        self.rov = Rov(self.get_parameter("max_thrust").value,
                       self.get_parameter("mass").value,
                       self.get_parameter("buoyancy").value,
                       self.get_parameter("hard_limits").value,
                       self.get_parameter("tool").value,
                       self.get_parameter("imu_noise").value,
                       self.get_parameter("imu_resolution").value)

        if self.get_parameter("ring").value:
            try:                   # optional extras; works without rov_props.py (see its header)
                import rov_props
                rov_props.add_to(self.rov)
            except ImportError:
                pass

        # ---- subscriptions: commands ----
        for name in self.rov.cmd:                                        # t1 .. t4
            self.create_subscription(
                Float32, f"{P}/{name}", lambda msg, n=name: self.rov.set_cmd(n, msg.data), 10)
        self.create_subscription(
            Float32, f"{P}/claw", lambda m: setattr(self.rov, "claw_target", clamp(float(m.data), 0.0, 1.0)), 10)
        self.create_subscription(
            String, f"{P}/tool", lambda m: setattr(self.rov, "tool", m.data if m.data in ("claw", "nose") else self.rov.tool), 10)
        self.create_subscription(Empty, f"{P}/reset", lambda m: self.rov.reset(), 10)

        # ---- publishers: readings ----
        self.imu_pub = self.create_publisher(Imu, f"{P}/imu", 10)
        self.depth_pub = self.create_publisher(Float32, f"{P}/depth", 10)
        self.heading_pub = self.create_publisher(Float32, f"{P}/heading", 10)
        self._joy_until = [0.0, 0.0]                   # keep publishing each stick until this time (monotonic)
        self.joy_pubs = []
        if self.get_parameter("joy").value:
            self.joy_pubs = [self.create_publisher(Joy, f"{P}/joy{i}", 10) for i in (1, 2)]
            self.create_timer(0.05, self.publish_joys)
        self.create_timer(0.02, self.publish_imu)
        self.create_timer(0.1, self.publish_sensors)

        self.last = time.monotonic()
        self.create_timer(1 / 60, self.step)

    def step(self):
        now = time.monotonic()
        dt = clamp(now - self.last, 0.0, 0.05)
        self.last = now
        if self.shared.buoyancy_request:              # the page's Buoyancy button (not a channel: a real ROV has no buoyancy control)
            self.rov.buoyancy, self.shared.buoyancy_request = BUOYANCY_MODES[self.shared.buoyancy_request], None
        if self.shared.tool_request:                  # the page's Tool button
            self.rov.tool, self.shared.tool_request = self.shared.tool_request, None
        if self.shared.reset_requested:
            self.shared.reset_requested = False
            self.rov.reset()
        if self.shared.keys:
            apply_keyboard(self.shared, self.rov)
        self.rov.step(dt)
        with self.shared.lock:
            self.shared.state = self.rov.state(keys=self.shared.keys)
            self.shared.state["ros"] = True
            self.shared.state["joys"] = [list(j) for j in self.shared.joys]
            self.shared.state["joy_topics"] = [f"{P}/joy1", f"{P}/joy2"] if self.joy_pubs else []

    def publish_joys(self):
        """The two on-screen sticks as standard Joy messages: axes[0] left/right (LEFT is +), axes[1] up/down (UP is +).
        Each is published at 20 Hz while its stick is held, and for a second after, so subscribers see it return to
        zero; silent otherwise, so it never fights a real joy_node."""
        now = time.monotonic()
        for i, pub in enumerate(self.joy_pubs):
            ax = self.shared.joys[i]
            if any(abs(v) > 1e-3 for v in ax):
                self._joy_until[i] = now + 1.0
            if now > self._joy_until[i]:
                continue
            m = Joy()
            m.header.stamp = self.get_clock().now().to_msg()
            m.header.frame_id = f"joy{i + 1}"
            m.axes = [float(ax[0]), float(ax[1])]
            pub.publish(m)

    def publish_imu(self):
        d = self.rov.imu()
        m = Imu()
        m.header.stamp = self.get_clock().now().to_msg()
        m.header.frame_id = "rov_imu"
        cr, sr = math.cos(d["roll"] / 2), math.sin(d["roll"] / 2)
        cp, sp = math.cos(d["pitch"] / 2), math.sin(d["pitch"] / 2)
        cy, sy = math.cos(d["yaw"] / 2), math.sin(d["yaw"] / 2)
        m.orientation.w = cr * cp * cy + sr * sp * sy        # roll, pitch, yaw -> quaternion
        m.orientation.x = sr * cp * cy - cr * sp * sy
        m.orientation.y = cr * sp * cy + sr * cp * sy
        m.orientation.z = cr * cp * sy - sr * sp * cy
        m.angular_velocity.x, m.angular_velocity.y, m.angular_velocity.z = d["gx"], d["gy"], d["gz"]
        m.linear_acceleration.x, m.linear_acceleration.y, m.linear_acceleration.z = d["ax"], d["ay"], d["az"]
        self.imu_pub.publish(m)

    def publish_sensors(self):
        self.depth_pub.publish(Float32(data=float(self.rov.depth)))
        self.heading_pub.publish(Float32(data=float(math.degrees(self.rov.yaw) % 360.0)))


def main():
    rclpy.init()
    shared = Shared(keys=False)
    node = RovSim(shared)
    shared.keys = node.get_parameter("keys").value
    shared.ros = True
    port = node.get_parameter("port").value
    server = start_server(shared, port)
    node.get_logger().info(f"ROV pool is at http://localhost:{port}")
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
