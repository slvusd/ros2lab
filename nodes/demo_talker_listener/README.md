# demo_talker_listener
A no-hardware sanity check. `install.sh` runs ROS 2's built-in talker and
listener and passes if they communicate. Run after `source mac/env.sh`.
To watch by hand, use two terminals: `ros2 run demo_nodes_cpp talker` and
`ros2 run demo_nodes_py listener`.
