#!/usr/bin/env python3
# =============================================================================
# student_imu_example.py — read the ROV's IMU (tilt, spin, acceleration)
# =============================================================================
# 1. Start the pool:    python nodes/rov_sim/rov_sim.py
# 2. Run this:          python nodes/rov_sim/student_imu_example.py
# 3. Make things happen: drive, dive, bump the floor, pick up the ring and watch it tilt.
#
# /rov/imu is a sensor_msgs/Imu:
#   orientation          a quaternion; we turn it into tilt degrees below
#   angular_velocity     how fast it is turning (rad/s): x roll, y pitch, z yaw
#   linear_acceleration  m/s^2 in the ROV's own axes: x forward, y left, z up.
#                        Like a real accelerometer it includes gravity: sitting level and still it
#                        reads z = +9.8, and tilting the nose down moves some of that into x.
# Challenge: use the front and rear thrusters (/rov/thruster/front, /rov/thruster/rear) to keep
# the ROV level while it carries the ring.
# =============================================================================
import math

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from sensor_msgs.msg import Imu


class ImuReader(Node):
    def __init__(self):
        super().__init__("imu_reader")
        self.create_subscription(Imu, "/rov/imu", self.on_imu, 10)
        self.n = 0

    def on_imu(self, m):
        self.n += 1
        if self.n % 25:                    # the IMU sends 50 times a second; print twice a second
            return
        q = m.orientation
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, 2 * (q.w * q.y - q.z * q.x)))))
        a = m.linear_acceleration
        self.get_logger().info(
            f"pitch {pitch:+5.1f} deg ({'nose down' if pitch > 0.5 else 'nose up' if pitch < -0.5 else 'level'})   "
            f"accel x {a.x:+5.2f}  y {a.y:+5.2f}  z {a.z:+5.2f} m/s^2")


def main():
    rclpy.init()
    node = ImuReader()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()


if __name__ == "__main__":
    main()
