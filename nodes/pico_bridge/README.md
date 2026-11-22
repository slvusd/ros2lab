# pico_bridge — Raspberry Pi Pico 2 <-> ROS 2 on the Mac

The Pico (MicroPython) and a small ROS 2 node on the Mac exchange plain text
lines over the USB cable. Students can read every line with a serial monitor.

```
Pico 2  --USB serial-->  pico_bridge.py  -->  /pico/temp  (Float32, deg C)
Pico 2  <--USB serial--  pico_bridge.py  <--  /pico/led   (Bool)
```
Protocol: `temp,23.4` (Pico -> Mac, 5/s) and `led,1` / `led,0` (Mac -> Pico).

## Status
- Mac side **verified** with `install.sh`: a fake Pico on a virtual serial port
  (PASS both directions).
- Pico side (`pico/main.py`) is **not yet run on real hardware**. Expect to
  tweak it (LED pin, temperature sensor) on first use.

## 1. Mac setup and self-test (no Pico needed)
```bash
source scripts/env.sh
./nodes/pico_bridge/install.sh
```

## 2. Put MicroPython on the Pico 2 (once per Pico)
1. Download the Pico 2 UF2 from <https://micropython.org/download/RPI_PICO2/>
   (use `RPI_PICO2_W` for the Wi-Fi model).
2. Hold the **BOOTSEL** button, plug in USB, release. A drive named `RP2350` appears.
3. Drag the `.uf2` onto it. The Pico reboots and the drive disappears.

## 3. Copy the program to the Pico
```bash
source scripts/env.sh
mpremote cp nodes/pico_bridge/pico/main.py :main.py
mpremote reset
```
`main.py` runs automatically at every power-up. (Thonny also works for editing.)
Note: while `mpremote` or Thonny is connected, the bridge cannot open the port.
Close them before running the bridge.

## 4. Run the bridge
```bash
python nodes/pico_bridge/pico_bridge.py          # finds /dev/cu.usbmodem*
ros2 topic echo /pico/temp                       # another terminal
ros2 topic pub --once /pico/led std_msgs/msg/Bool "{data: true}"   # LED on
```
Specify a port if several are plugged in:
`... pico_bridge.py --ros-args -p port:=/dev/cu.usbmodem1101`

## Extending it
Add a line type in `pico/main.py` (`print("dist,12.3")`) and a branch in
`handle_line()` in `pico_bridge.py` with a publisher. Commands go the other way
via `handle()` in `main.py` and a subscriber in the bridge.
