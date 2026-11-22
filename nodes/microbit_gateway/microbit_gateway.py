#!/usr/bin/env python3
# =============================================================================
# microbit_gateway.py — ROS 2 node on the Mac that bridges the gateway micro:bit
# =============================================================================
# Topics
#   /microbit/rx        (std_msgs/String)   every radio packet, as received
#   /microbit/<name>    (std_msgs/Float32)  for packets shaped "name,number"
#                                           e.g. "temp,23.5" -> /microbit/temp
#   /microbit/tx        (std_msgs/String)   publish text here to radio it out
#
# Run (after `source scripts/env.sh`):
#     python nodes/microbit_gateway/microbit_gateway.py
#     python nodes/microbit_gateway/microbit_gateway.py --ros-args -p port:=/dev/cu.usbmodem1102
# With no `port` it uses the first /dev/cu.usbmodem* — if a Pico is also
# plugged in, name the port explicitly (`ls /dev/cu.usbmodem*`).
# =============================================================================
import glob
import re

import rclpy
import serial
from rclpy.node import Node
from std_msgs.msg import Float32, String

MAX_NAMED_TOPICS = 32   # other groups' stray packets must not create endless topics


class MicrobitGateway(Node):
    def __init__(self):
        super().__init__("microbit_gateway")
        self.declare_parameter("port", "")
        self.declare_parameter("baud", 115200)

        self.rx_pub = self.create_publisher(String, "/microbit/rx", 10)
        self.named_pubs = {}                       # "temp" -> publisher
        self.create_subscription(String, "/microbit/tx", self.on_tx, 10)

        self.ser = None
        self.buf = b""
        self.create_timer(0.02, self.poll)         # read serial 50x a second
        self.create_timer(1.0, self.ensure_open)   # (re)connect if unplugged

    # -- serial connection ----------------------------------------------------
    def ensure_open(self):
        if self.ser is not None:
            return
        port = self.get_parameter("port").value
        if not port:
            found = sorted(glob.glob("/dev/cu.usbmodem*"))
            if not found:
                self.get_logger().warn("No micro:bit found (/dev/cu.usbmodem*). Plugged in?",
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

    # -- radio -> ROS ---------------------------------------------------------
    def handle_line(self, line):
        if not line.startswith("rx,"):
            return                                   # ignore anything else
        packet = line[3:]
        self.rx_pub.publish(String(data=packet))

        name, sep, value = packet.partition(",")
        name = re.sub(r"[^a-z0-9_]", "_", name.strip().lower())
        if not (sep and name and not name[0].isdigit()):
            return
        try:
            number = float(value)
        except ValueError:
            return                                   # not "name,number"
        pub = self.named_pubs.get(name)
        if pub is None:
            if len(self.named_pubs) >= MAX_NAMED_TOPICS:
                return
            pub = self.create_publisher(Float32, f"/microbit/{name}", 10)
            self.named_pubs[name] = pub
        pub.publish(Float32(data=number))

    # -- ROS -> radio ---------------------------------------------------------
    def on_tx(self, msg):
        if self.ser is not None:
            text = msg.data.replace("\n", " ")[:32]   # radio packets default to 32 bytes
            self.ser.write(f"tx,{text}\n".encode())


def main():
    rclpy.init()
    rclpy.spin(MicrobitGateway())


if __name__ == "__main__":
    main()
