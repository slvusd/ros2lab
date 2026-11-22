#!/usr/bin/env python3
# =============================================================================
# pico_bridge.py — ROS 2 node on the Mac that bridges a Pico's USB serial port
# =============================================================================
# Publishes   /pico/temp  (std_msgs/Float32)  from the Pico's "temp,<C>" lines
# Subscribes  /pico/led   (std_msgs/Bool)     and sends "led,1" / "led,0"
#
# Run (after `source scripts/env.sh`):
#     python nodes/pico_bridge/pico_bridge.py
#     python nodes/pico_bridge/pico_bridge.py --ros-args -p port:=/dev/cu.usbmodem1101
# With no `port` it uses the first /dev/cu.usbmodem* it finds.
# To add a new sensor or command: add a branch in handle_line() and a
# publisher/subscriber, and the matching print()/handle() in pico/main.py.
# =============================================================================
import glob

import rclpy
import serial
from rclpy.node import Node
from std_msgs.msg import Bool, Float32


class PicoBridge(Node):
    def __init__(self):
        super().__init__("pico_bridge")
        self.declare_parameter("port", "")
        self.declare_parameter("baud", 115200)  # ignored by USB, but pyserial wants one

        self.temp_pub = self.create_publisher(Float32, "/pico/temp", 10)
        self.create_subscription(Bool, "/pico/led", self.on_led, 10)

        self.ser = None
        self.buf = b""
        self.create_timer(0.02, self.poll)        # read serial 50x a second
        self.create_timer(1.0, self.ensure_open)  # (re)connect if unplugged

    # -- serial connection ----------------------------------------------------
    def ensure_open(self):
        if self.ser is not None:
            return
        port = self.get_parameter("port").value
        if not port:
            found = sorted(glob.glob("/dev/cu.usbmodem*"))
            if not found:
                self.get_logger().warn("No Pico found (/dev/cu.usbmodem*). Plugged in?",
                                       throttle_duration_sec=10)
                return
            port = found[0]
        try:
            self.ser = serial.Serial(port, self.get_parameter("baud").value, timeout=0)
            self.get_logger().info(f"Connected to {port}")
        except serial.SerialException as e:
            self.get_logger().warn(f"Could not open {port}: {e}", throttle_duration_sec=10)

    def poll(self):
        if self.ser is None:
            return
        try:
            self.buf += self.ser.read(256)
        except (serial.SerialException, OSError) as e:
            self.get_logger().warn(f"Serial lost ({e}); will reconnect")
            self.ser = None
            return
        while b"\n" in self.buf:
            line, self.buf = self.buf.split(b"\n", 1)
            self.handle_line(line.decode(errors="ignore").strip())

    # -- Pico -> ROS ----------------------------------------------------------
    def handle_line(self, line):
        parts = line.split(",")
        if parts[0] == "temp" and len(parts) == 2:
            try:
                self.temp_pub.publish(Float32(data=float(parts[1])))
            except ValueError:
                pass  # ignore garbled lines

    # -- ROS -> Pico ----------------------------------------------------------
    def on_led(self, msg):
        if self.ser is not None:
            self.ser.write(b"led,1\n" if msg.data else b"led,0\n")


def main():
    rclpy.init()
    rclpy.spin(PicoBridge())


if __name__ == "__main__":
    main()
