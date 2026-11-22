# microbit — micro:bit radio <-> ROS 2 on the Mac

A Mac cannot hear the micro:bit radio (proprietary Nordic 2.4 GHz, not Bluetooth
or Wi-Fi). So one micro:bit — the **gateway** — stays plugged into the Mac, passes
radio packets to USB and USB lines to the radio, untouched. The generic
`nodes/serial_bridge/` node turns the lines into ROS topics (format: `docs/PROTOCOL.md`).

```
student micro:bit ~~radio~~> gateway --USB--> serial_bridge.py
 radio.send("p:team3_temp,23")                  -> /microbit/team3_temp  (Float32)
 radio.send("s:team3_led")                      -> creates /microbit/in/team3_led
 hears "m:team3_led,1"  <~~ gateway <--USB--    <- /microbit/in/team3_led "1"
```

## Status
- Bridge **verified** with a fake device (`nodes/serial_bridge/install.sh`).
- `microbit/gateway.py` and `microbit/student_example.py` are **not yet run on
  real hardware**. To check on first use: USB serial works as written on your
  micro:bit model (V1/V2), and student packets are received with default radio settings.

## 1. Mac setup and self-test (no micro:bit needed)
```bash
source scripts/env.sh
./nodes/microbit/install.sh
```

## 2. Flash the gateway micro:bit
1. Open <https://python.microbit.org> (or Mu). Paste `microbit/gateway.py`.
2. Set `GROUP` (0-255, your team's number). Click **Send to micro:bit**.
   A tick shows on the display when it is running.

## 3. Flash a student micro:bit
Paste `microbit/student_example.py` (same `GROUP`). Pick your own channel name
in place of `team3_`.

## 4. Run the bridge
```bash
python nodes/serial_bridge/serial_bridge.py --ros-args -p ns:=microbit -p max_len:=32
ros2 topic echo /microbit/team3_temp
ros2 topic pub --once /microbit/in/team3_led std_msgs/msg/String "{data: '1'}"
```
`max_len:=32` drops (with a warning) any outgoing line the radio cannot carry.
If a Pico is also plugged in, name the port: `-p port:=/dev/cu.usbmodemXXXX`.

## Limits
- Radio is a **shared, unencrypted broadcast**: everyone in range on the same
  group hears everything. Give each team a different group and unique channel names.
- 32 bytes per packet, best effort (occasional loss). Range: metres to tens of metres.
- Not for the ROV control link.
