#!/usr/bin/env python3
# =============================================================================
# student_example.py — your first ROV program: turn a thruster ON, then OFF.
# =============================================================================
# 1. Start the pool (one terminal):      python nodes/rov_sim/rov_sim.py
# 2. Open it next to your code:          Cmd+Shift+P -> "Simple Browser: Show" -> http://localhost:8000
# 3. Run this (another terminal):        python nodes/rov_sim/student_example.py
#
# A thruster takes a number from -1.0 (full reverse) to 1.0 (full forward). 0.0 = off.
# Topics:  /rov/thruster/left   /rov/thruster/right   /rov/thruster/vertical
#          /rov/claw (True = open, False = closed; /rov/hook also works)
# =============================================================================
import rclpy
from rclpy.node import Node
from std_msgs.msg import Float32


class FirstDive(Node):
    def __init__(self):
        super().__init__("first_dive")
        self.left = self.create_publisher(Float32, "/rov/thruster/left", 10)
        self.right = self.create_publisher(Float32, "/rov/thruster/right", 10)
        self.t = 0
        self.create_timer(1.0, self.tick)          # call tick() once a second

    def send(self, left, right):
        self.left.publish(Float32(data=left))
        self.right.publish(Float32(data=right))

    def tick(self):
        self.t += 1
        if self.t == 1:
            self.get_logger().info("both thrusters ON")
            self.send(0.8, 0.8)                    # drive forward
        elif self.t == 3:
            self.get_logger().info("thrusters OFF")
            self.send(0.0, 0.0)                    # coast to a stop


def main():
    rclpy.init()
    node = FirstDive()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
