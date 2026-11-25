#!/usr/bin/env python3
# =============================================================================
# rov_sim.py — a tiny classroom ROV simulator: ROS 2 topics in, 3D pool in a browser
# =============================================================================
# Run (after `source mac/env.sh`):
#   python nodes/rov_sim/rov_sim.py
# Then open http://localhost:8000  (in VS Code: Cmd+Shift+P -> "Simple Browser: Show").
# No ROS handy, or just want to play? Use keyboard_sim.py instead.
#
# TOPICS (all latched: a thruster keeps its last command until you change it)
#   subscribes  /rov/thruster/left      std_msgs/Float32   -1.0 .. 1.0
#               /rov/thruster/right     std_msgs/Float32   -1.0 .. 1.0
#               /rov/thruster/front     std_msgs/Float32   -1.0 .. 1.0  vertical thruster near the nose (+ = up)
#               /rov/thruster/rear      std_msgs/Float32   -1.0 .. 1.0  vertical thruster near the tail (+ = up)
#               /rov/thruster/vertical  std_msgs/Float32   sets BOTH vertical thrusters (front and rear) at once
#               /rov/claw               std_msgs/Float32   claw servo: 0.0 closed .. 1.0 fully open
#               /rov/tool               std_msgs/String    "claw" or "nose" (also the page's Tool button)
#               /rov/reset              std_msgs/Empty     back to the start position
#   publishes   /rov/imu                sensor_msgs/Imu    50 Hz: orientation, angular velocity, acceleration
#                                       (x forward, y left, z up; pitch + = nose down; accel includes gravity: +9.8 z at rest)
#               /rov/depth              std_msgs/Float32   metres below the surface
#               /rov/heading            std_msgs/Float32   degrees, 0 = +x end of pool, CCW +
#
# PARAMETERS  (--ros-args -p max_thrust:=15.0)
#   imu_resolution (0 = exact; 0.01 = like a BNO055, 0.0006 = like an MPU-6050, m/s^2)
#   imu_noise (0; try 0.05 for a noisy accelerometer, m/s^2 std-dev)
#   keys (true; the page's keyboard also works, alongside ROS: for each thruster, the last new value wins)
#   tool (claw; or nose)
#   ring (true; false = no pick-up ring)
#   hard_limits (false; true = stop dead at surface/floor, no overshoot/bounce)
#   port (8000), max_thrust (N, 12), mass (kg incl. added mass, 8), buoyancy (N, 0;
#   spare buoyancy: positive floats up; default 1.5 N, so it drifts up and floats; 0 = hovers)
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
from sensor_msgs.msg import Imu
from std_msgs.msg import Empty, Float32, String

from rov_physics import BUOYANCY, BUOYANCY_MODES, Rov, Shared, apply_keyboard, clamp, start_server


class RovSim(Node):
    def __init__(self, shared):
        super().__init__("rov_sim")
        self.shared = shared
        self.declare_parameter("port", 8000)
        self.declare_parameter("keys", True)          # also accept the page's keyboard (last writer wins, per thruster)
        self.declare_parameter("max_thrust", 12.0)
        self.declare_parameter("mass", 8.0)
        self.declare_parameter("buoyancy", BUOYANCY)
        self.declare_parameter("imu_noise", 0.0)
        self.declare_parameter("imu_resolution", 0.0)
        self.declare_parameter("hard_limits", False)
        self.declare_parameter("tool", "claw")       # front tool: claw or nose (or publish /rov/tool)
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
        for name in self.rov.cmd:
            self.create_subscription(
                Float32, f"/rov/thruster/{name}",
                lambda msg, n=name: self.rov.set_cmd(n, msg.data), 10)
        def both(msg):                                # /rov/thruster/vertical drives front and rear together
            self.rov.set_cmd("front", msg.data); self.rov.set_cmd("rear", msg.data)
        self.create_subscription(Float32, "/rov/thruster/vertical", both, 10)
        self.create_subscription(
            Float32, "/rov/claw", lambda m: setattr(self.rov, "claw_target", clamp(float(m.data), 0.0, 1.0)), 10)
        self.create_subscription(
            String, "/rov/tool", lambda m: setattr(self.rov, "tool", m.data if m.data in ("claw", "nose") else self.rov.tool), 10)
        self.create_subscription(Empty, "/rov/reset", lambda m: self.rov.reset(), 10)
        self.depth_pub = self.create_publisher(Float32, "/rov/depth", 10)
        self.heading_pub = self.create_publisher(Float32, "/rov/heading", 10)
        self.imu_pub = self.create_publisher(Imu, "/rov/imu", 10)
        self.create_timer(0.02, self.publish_imu)

        self.last = time.monotonic()
        self.create_timer(1 / 60, self.step)
        self.create_timer(0.1, self.publish_sensors)

    def step(self):
        now = time.monotonic()
        dt = clamp(now - self.last, 0.0, 0.05)
        self.last = now
        if self.shared.buoyancy_request:              # the page's Buoyancy button (not a topic: a real ROV has no buoyancy control)
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
