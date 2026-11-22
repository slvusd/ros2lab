# =============================================================================
# gateway.py — runs ON the "gateway" micro:bit that stays plugged into the Mac.
# =============================================================================
# A transparent pipe between the radio and USB — it does not interpret anything.
#   Radio  -> Mac : every radio packet is printed as one line
#   Mac -> Radio  : every line from the Mac is sent out as a radio packet
# The lines follow docs/PROTOCOL.md (p:name,value / s:name / m:name,value).
#
# Flash it with the micro:bit Python editor (https://python.microbit.org) or Mu.
# Not yet run on real hardware (as of writing).
# =============================================================================
from microbit import uart, display, Image, sleep
import radio

GROUP = 1          # <-- your team's group (0-255); student micro:bits must match

radio.config(group=GROUP)   # default length (32 bytes) keeps both sides compatible
radio.on()
uart.init(115200)           # USB serial to the Mac
display.show(Image.YES)     # a tick means "gateway is running"

buf = b""
while True:
    # 1) radio -> USB
    packet = radio.receive()
    if packet:
        print(packet.replace("\n", " ").replace("\r", " "))

    # 2) USB -> radio
    data = uart.read()
    if data:
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.decode().strip()
            if line and len(line) <= 32:     # radio packets are 32 bytes by default
                radio.send(line)
    sleep(5)
