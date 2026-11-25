# =============================================================================
# pico_throttle.py — a dial drives the ROV, the Pico's LED shows when it is deep. Runs ON the Pico (MicroPython).
# =============================================================================
# Wiring: a potentiometer (dial) middle pin to GP26 (ADC0), outer pins to 3V3 and GND.
#         A push button between GP15 and GND: hold it to dive.
# Copy to the Pico as main.py (Thonny or mpremote), leave it plugged in, then in the browser ROV pool
# (Chrome / Edge / Chromebook) click "Connect micro:bit / Pico". Close Thonny first: one program per USB port.
# Lines follow docs/PROTOCOL.md:  p:t1,0.5 = publish thruster 1 at half power;  s:depth = "send me the depth";
# m:depth,1.2 arrives from the pool.
# Not yet run on real hardware (as of writing).
# =============================================================================
import sys
import time
import select
from machine import Pin, ADC

dial = ADC(26)
button = Pin(15, Pin.IN, Pin.PULL_UP)
try:
    led = Pin("LED", Pin.OUT)          # Pico W / 2 W
except Exception:
    led = Pin(25, Pin.OUT)             # plain Pico

poller = select.poll()
poller.register(sys.stdin, select.POLLIN)

last_sub = -5000
while True:
    now = time.ticks_ms()
    if time.ticks_diff(now, last_sub) >= 5000:       # ask for depth readings (repeat every few seconds)
        print("s:depth")
        last_sub = now

    power = dial.read_u16() / 65535                  # 0.0 .. 1.0
    print("p:t1,%.2f" % power)
    print("p:t2,%.2f" % power)
    dive = -1 if button.value() == 0 else 0          # the button pulls the pin to 0 when pressed
    print("p:t3,%d" % dive)
    print("p:t4,%d" % dive)

    while poller.poll(0):                            # lines from the pool, e.g. "m:depth,1.23"
        line = sys.stdin.readline().strip()
        if line.startswith("m:depth,"):
            led.value(1 if float(line.split(",")[1]) > 1.5 else 0)
    time.sleep_ms(100)
