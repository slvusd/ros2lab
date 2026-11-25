#!/usr/bin/env python3
# =============================================================================
# student_joystick.py — drive the ROV with the two on-screen joysticks
# =============================================================================
# The two pads in the top right of the pool page publish sensor_msgs/Joy on /sim/joy1 and /sim/joy2.
# They do NOT move the ROV by themselves: this program listens to them and turns stick positions into
# thruster commands, so the wiring is yours. (Both thrusters of a pair must agree to go straight; if they
# differ the ROV turns. That is all "steering" is.)
#
#   1. python nodes/rov_sim/rov_sim.py            (open http://localhost:8000, drag the pads)
#   2. python nodes/rov_sim/student_joystick.py
#
# Each Joy message has  axes[0] = left/right  (LEFT is +1, RIGHT is -1: backwards!)
#                       axes[1] = up/down     (UP is +1, DOWN is -1)
# =============================================================================
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Joy
from std_msgs.msg import Float32


def clamp(v):
    return max(-1.0, min(1.0, v))


class JoyDrive(Node):
    def __init__(self):
        super().__init__("joy_drive")
        self.t = [self.create_publisher(Float32, f"/sim/t{i}", 10) for i in (1, 2, 3, 4)]
        self.create_subscription(Joy, "/sim/joy1", self.on_joy1, 10)
        self.create_subscription(Joy, "/sim/joy2", self.on_joy2, 10)

    def send(self, i, value):                     # i = thruster number 1..4
        self.t[i - 1].publish(Float32(data=clamp(value)))

    def on_joy1(self, msg):                       # joy1 (left pad): forward/back and turning
        forward = msg.axes[1]                     # stick up = forward
        turn_right = -msg.axes[0]                 # stick right = turn right (axis 0 is + to the LEFT, so flip it)
        self.send(1, forward + turn_right)        # t1 (left thruster) works harder to turn right
        self.send(2, forward - turn_right)        # t2 (right thruster)

    def on_joy2(self, msg):                       # joy2 (right pad): up/down
        self.send(3, msg.axes[1])                 # t3 and t4 are the vertical thrusters (+ = up)
        self.send(4, msg.axes[1])


def main():
    rclpy.init()
    node = JoyDrive()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()


if __name__ == "__main__":
    main()
