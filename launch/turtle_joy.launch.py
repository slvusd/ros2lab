# =============================================================================
# turtle_joy.launch.py — drive the turtlesim turtle with a joystick
# =============================================================================
# Run (after `source scripts/env.sh`):   ros2 launch launch/turtle_joy.launch.py
#
# Three nodes:
#   turtlesim_node  the little window with the turtle
#   joy_node        reads the joystick (SDL device `device_id`), publishes /joy
#   teleop_node     turns /joy into velocity commands (geometry_msgs/Twist),
#                   sent to the turtle's /turtle1/cmd_vel topic
# Default mapping: left stick up/down = forward/back (axis 1),
#                  left stick left/right = turn (axis 0). No button needed.
# Different controller? `ros2 topic echo /joy` shows which axis number moves
# when you push each stick; change the axis numbers below.
# =============================================================================
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(package="turtlesim", executable="turtlesim_node"),
        Node(package="joy", executable="joy_node",
             parameters=[{"device_id": 0, "deadzone": 0.1}]),
        Node(package="teleop_twist_joy", executable="teleop_node",
             parameters=[{
                 "require_enable_button": False,   # stick alone drives
                 "axis_linear.x": 1,               # forward/back
                 "axis_angular.yaw": 0,            # turning
                 "scale_linear.x": 2.0,            # turtle is slow at ROS defaults
                 "scale_angular.yaw": 2.0,
             }],
             remappings=[("cmd_vel", "/turtle1/cmd_vel")]),
    ])
