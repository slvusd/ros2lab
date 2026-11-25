#!/usr/bin/env python3
# Your first ROV program: thrusters 1 and 2 ON for 2 seconds, then OFF.
#
#   1. Start the pool:   python nodes/rov_sim/rov_sim.py        (open http://localhost:8000)
#   2. Run this:         python nodes/rov_sim/student_minimal.py
import time

import rclpy
from std_msgs.msg import Float32

rclpy.init()
node = rclpy.create_node("student")
t1 = node.create_publisher(Float32, "/sim/t1", 10)      # thruster 1 (left)
t2 = node.create_publisher(Float32, "/sim/t2", 10)      # thruster 2 (right)
time.sleep(1)                       # give the pool a moment to notice us

t1.publish(Float32(data=0.8))       # thrusters ON (-1.0 .. 1.0)
t2.publish(Float32(data=0.8))
time.sleep(2)

t1.publish(Float32(data=0.0))       # thrusters OFF
t2.publish(Float32(data=0.0))
time.sleep(0.5)                     # let the messages go out before we quit
rclpy.shutdown()
