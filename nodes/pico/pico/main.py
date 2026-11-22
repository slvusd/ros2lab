# =============================================================================
# main.py — runs ON the Pico 2 (MicroPython). Copy it to the Pico as main.py.
# Example of the topic protocol in docs/PROTOCOL.md — no libraries, just print().
# =============================================================================
#   print("p:temp,23.4")   publish 23.4 on channel "temp"  -> ROS /pico/temp
#   print("s:led")         subscribe to channel "led"       -> ROS /pico/in/led
#   input line "m:led,1"   a message arrived for channel "led"
# NOTE: written for MicroPython on the Pico 2 / Pico 2 W; not yet run on real
# hardware (as of writing). If something fails, open a serial monitor (Thonny).
# =============================================================================
import sys
import time
import select
from machine import Pin, ADC

# Pico 2 W's LED is called "LED"; the plain Pico 2's LED is GPIO 25.
try:
    led = Pin("LED", Pin.OUT)
except Exception:
    led = Pin(25, Pin.OUT)

# Built-in chip temperature sensor.
sensor = ADC(ADC.CORE_TEMP) if hasattr(ADC, "CORE_TEMP") else ADC(4)


def read_temp_c():
    volts = sensor.read_u16() * 3.3 / 65535
    return 27 - (volts - 0.706) / 0.001721  # formula from the RP2 datasheet


def handle(line):
    """A line from the Mac, e.g. 'm:led,1'. Add your own channels here."""
    if line.startswith("m:"):
        name, _, value = line[2:].partition(",")
        if name == "led":
            led.value(1 if value.strip() == "1" else 0)


poller = select.poll()                 # lets us check for input without waiting
poller.register(sys.stdin, select.POLLIN)

now = time.ticks_ms()
last_sub = time.ticks_add(now, -5000)  # so we subscribe immediately
last_pub = now
while True:
    if poller.poll(0):                 # a line has arrived from the Mac
        handle(sys.stdin.readline().strip())

    now = time.ticks_ms()
    if time.ticks_diff(now, last_sub) >= 5000:   # repeat so a late-started bridge learns it
        print("s:led")
        last_sub = now
    if time.ticks_diff(now, last_pub) >= 200:    # publish 5 times a second
        print("p:temp,%.1f" % read_temp_c())
        last_pub = now
