# pico — Raspberry Pi Pico 2 <-> ROS 2 on the Mac

The Pico (MicroPython) prints and reads plain text lines over USB. The generic
bridge in `nodes/serial_bridge/` turns them into ROS topics. The line format is
in `docs/PROTOCOL.md`: `p:temp,23.4` publishes, `s:led` subscribes, `m:led,1` is a message to you.

```
Pico 2  --"p:temp,23.4"-->  serial_bridge.py  -->  /pico/temp      (Float32)
Pico 2  <--"m:led,1"------  serial_bridge.py  <--  /pico/in/led    (String)
```

## Status
- Bridge **verified** by `install.sh` with a fake device (see `nodes/serial_bridge/`).
- `pico/main.py` is **not yet run on real hardware**. Expect to tweak it (LED pin,
  temperature sensor) on first use.

## 1. Mac setup and self-test (no Pico needed)
```bash
source scripts/env.sh
./nodes/pico/install.sh
```

## 2. Put MicroPython on the Pico 2 (once per Pico)
1. Download the Pico 2 UF2 from <https://micropython.org/download/RPI_PICO2/>
   (use `RPI_PICO2_W` for the Wi-Fi model).
2. Hold **BOOTSEL**, plug in USB, release. A drive named `RP2350` appears.
3. Drag the `.uf2` onto it. The Pico reboots and the drive disappears.

## 3. Copy the program to the Pico
```bash
mpremote cp nodes/pico/pico/main.py :main.py
mpremote reset
```
`main.py` runs at every power-up. While `mpremote` or Thonny is connected the
bridge cannot open the port, so close them first.

## 4. Run the bridge
```bash
python nodes/serial_bridge/serial_bridge.py --ros-args -p ns:=pico
ros2 topic echo /pico/temp                                          # another terminal
ros2 topic pub --once /pico/in/led std_msgs/msg/String "{data: '1'}"   # LED on
```
If a micro:bit is also plugged in, name the port: `-p port:=/dev/cu.usbmodemXXXX`.

## Adding channels
In `main.py`: `print("p:dist,12.3")` to publish, `print("s:speed")` to subscribe,
and a branch in `handle()` for `m:speed,...`. ROS topics appear automatically.
