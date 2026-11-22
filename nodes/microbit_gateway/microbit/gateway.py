# =============================================================================
# gateway.py — runs ON the "gateway" micro:bit that stays plugged into the Mac.
# =============================================================================
# Flash it with the micro:bit Python editor (https://python.microbit.org) or
# Mu: paste this file, click Send to micro:bit.
#
#   Radio  -> Mac : every radio packet is printed as   rx,<packet text>
#   Mac -> Radio  : a line   tx,<text>   is sent out over the radio
#
# Student micro:bits just use normal radio code, set to the SAME group number:
#     import radio; radio.config(group=GROUP); radio.on()
#     radio.send("temp,23.5")
# Packets shaped "name,number" also become ROS topics (see the README).
# Not yet run on real hardware (as of writing).
# =============================================================================
from microbit import uart, display, Image
import radio

GROUP = 1          # <-- change to your team's group (0-255); students must match

radio.config(group=GROUP)   # default length (32 bytes) keeps both sides compatible
radio.on()
uart.init(115200)           # USB serial to the Mac
display.show(Image.YES)     # a tick means "gateway is running"

buf = b""
while True:
    # 1) radio -> USB
    packet = radio.receive()
    if packet:
        print("rx," + packet.replace("\n", " ").replace("\r", " "))

    # 2) USB -> radio
    data = uart.read()
    if data:
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.decode().strip()
            if line.startswith("tx,"):
                radio.send(line[3:])
