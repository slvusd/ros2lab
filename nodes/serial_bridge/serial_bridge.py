#!/usr/bin/env python3
# =============================================================================
# serial_bridge.py — generic bridge: a serial device speaking docs/PROTOCOL.md
# <-> ROS 2 topics. Used for the Pico (USB) and the gateway micro:bit (radio).
# =============================================================================
#   device line      ->  ROS
#   p:temp,23.5      ->  publishes /<ns>/temp   (Float32 if numeric, else String)
#   s:led            ->  creates subscriber /<ns>/in/led (String); anything
#                        published there is sent back as  m:led,<text>
#
# Run (after `source mac/env.sh`):
#   python nodes/serial_bridge/serial_bridge.py --ros-args -p ns:=pico
#   python nodes/serial_bridge/serial_bridge.py --ros-args -p ns:=microbit -p max_len:=32
# Parameters: ns (topic prefix, default "pico"), port (default: first
# /dev/cu.usbmodem*; name it if both a Pico and micro:bit are plugged in),
# max_len (drop outgoing lines longer than this; use 32 for the micro:bit radio).
# =============================================================================
import glob
import re

import rclpy
import serial
from rclpy.node import Node
from std_msgs.msg import Float32, String

MAX_TOPICS = 32   # per direction; stray packets must not create endless topics


def clean(name):
    """Lower-case; anything but a-z 0-9 _ becomes _. Returns None if unusable."""
    name = re.sub(r"[^a-z0-9_]", "_", name.strip().lower())
    return name if name and not name[0].isdigit() else None


class SerialBridge(Node):
    def __init__(self):
        super().__init__("serial_bridge")
        self.declare_parameter("port", "")
        self.declare_parameter("baud", 115200)   # ignored by USB, pyserial wants one
        self.declare_parameter("ns", "pico")
        self.declare_parameter("max_len", 0)
        self.ns = clean(self.get_parameter("ns").value) or "pico"
        self.max_len = self.get_parameter("max_len").value

        self.pubs = {}   # channel -> (msg type, publisher)
        self.subs = {}   # channel -> subscription
        self.ser = None
        self.buf = b""
        self.create_timer(0.02, self.poll)          # read serial 50x a second
        self.create_timer(1.0, self.ensure_open)    # (re)connect if unplugged

    # -- serial connection ----------------------------------------------------
    def ensure_open(self):
        if self.ser is not None:
            return
        port = self.get_parameter("port").value
        if not port:
            found = sorted(glob.glob("/dev/cu.usbmodem*"))
            if not found:
                self.get_logger().warn("No device found (/dev/cu.usbmodem*). Plugged in?",
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

    # -- device -> ROS --------------------------------------------------------
    def handle_line(self, line):
        if line.startswith("p:"):
            name, sep, value = line[2:].partition(",")
            name = clean(name)
            if sep and name:
                self.publish_value(name, value)
        elif line.startswith("s:"):
            name = clean(line[2:])
            if name:
                self.ensure_sub(name)
        # anything else (boot messages, debug prints) is ignored

    def publish_value(self, name, value):
        try:
            msg, mtype = Float32(data=float(value)), Float32
        except ValueError:
            msg, mtype = String(data=value), String
        entry = self.pubs.get(name)
        if entry is None:
            if len(self.pubs) >= MAX_TOPICS:
                return
            entry = (mtype, self.create_publisher(mtype, f"/{self.ns}/{name}", 10))
            self.pubs[name] = entry
        if entry[0] is not mtype:
            self.get_logger().warn(f"/{self.ns}/{name}: type changed; message dropped",
                                   throttle_duration_sec=10)
            return
        entry[1].publish(msg)

    # -- ROS -> device --------------------------------------------------------
    def ensure_sub(self, name):
        if name in self.subs or len(self.subs) >= MAX_TOPICS:
            return
        self.subs[name] = self.create_subscription(
            String, f"/{self.ns}/in/{name}", lambda msg, n=name: self.send(n, msg.data), 10)

    def send(self, name, text):
        line = f"m:{name},{text.replace(chr(10), ' ')}"
        if self.max_len and len(line) > self.max_len:
            self.get_logger().warn(f"Dropped '{line}': longer than max_len={self.max_len}")
            return
        if self.ser is not None:
            self.ser.write((line + "\n").encode())


def main():
    rclpy.init()
    rclpy.spin(SerialBridge())


if __name__ == "__main__":
    main()
