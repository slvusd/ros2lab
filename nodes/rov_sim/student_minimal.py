#!/usr/bin/env python3
# Your first ROV program: both thrusters ON for 2 seconds, then OFF.
#
#   1. Start the pool:   python nodes/rov_sim/rov_sim.py        (open http://localhost:8000)
#   2. Run this:         python nodes/rov_sim/student_minimal.py
import time

import rclpy
from std_msgs.msg import Float32

rclpy.init()
node = rclpy.create_node("student")
left = node.create_publisher(Float32, "/rov/thruster/left", 10)
right = node.create_publisher(Float32, "/rov/thruster/right", 10)
time.sleep(1)                       # give the pool a moment to notice us

left.publish(Float32(data=0.8))     # thrusters ON (-1.0 .. 1.0)
right.publish(Float32(data=0.8))
time.sleep(2)

left.publish(Float32(data=0.0))     # thrusters OFF
right.publish(Float32(data=0.0))
time.sleep(0.5)                     # let the messages go out before we quit
rclpy.shutdown()
