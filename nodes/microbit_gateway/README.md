# microbit_gateway — micro:bit radio <-> ROS 2 on the Mac

A Mac cannot hear the micro:bit radio (proprietary Nordic 2.4 GHz, not Bluetooth
or Wi-Fi). So one micro:bit — the **gateway** — stays plugged into the Mac by USB,
listens on the radio and relays over USB serial. A ROS 2 node turns that into topics.

```
student micro:bit ~~radio~~> gateway micro:bit --USB--> microbit_gateway.py
   radio.send("temp,23.5")                               |-> /microbit/rx    "temp,23.5"
                                                         |-> /microbit/temp  23.5 (Float32)
student micro:bit <~~radio~~ gateway micro:bit <--USB--  <- /microbit/tx     "go"
```
USB protocol: `rx,<packet>` (gateway -> Mac) and `tx,<text>` (Mac -> gateway).

## Status
- Mac side **verified** by `install.sh` using a fake gateway (4 PASS checks).
- `microbit/gateway.py` is **not yet run on real hardware**. Open questions to
  check on first use: that USB serial works as written on your micro:bit model
  (V1 and V2), and that student packets are received with the default radio settings.

## 1. Mac setup and self-test (no micro:bit needed)
```bash
source scripts/env.sh
./nodes/microbit_gateway/install.sh
```

## 2. Flash the gateway micro:bit
1. Open <https://python.microbit.org> (or use Mu).
2. Paste `microbit/gateway.py`. Change `GROUP = 1` to your team's number (0-255).
3. Click **Send to micro:bit** (or Download and drag the .hex onto the MICROBIT drive).
   A tick shows on the display when it is running.

## 3. Student micro:bits
Ordinary radio code, with the **same group number**:
```python
from microbit import *
import radio
radio.config(group=1)
radio.on()
while True:
    radio.send("temp," + str(temperature()))
    sleep(1000)
```

## 4. Run the bridge
```bash
python nodes/microbit_gateway/microbit_gateway.py
ros2 topic echo /microbit/rx            # every packet
ros2 topic echo /microbit/temp          # packets shaped "temp,<number>"
ros2 topic pub --once /microbit/tx std_msgs/msg/String "{data: go}"   # send to the radio
```
If a Pico is also plugged in, give the port: `... --ros-args -p port:=/dev/cu.usbmodemXXXX`
(`ls /dev/cu.usbmodem*`).

## Behaviour and limits
- Packets shaped `name,number` also become `/microbit/<name>` (Float32). The name
  is lower-cased and non-alphanumerics become `_`. At most 32 such topics are
  created, so stray packets cannot flood ROS.
- Radio is **a shared, unencrypted broadcast**: anyone in range on the same group
  hears it. Give each team a different group; do not send anything private.
- Default packet size is 32 bytes; long `/microbit/tx` text is truncated to 32.
- Range is metres to tens of metres, not through water. Not for the ROV control link.
