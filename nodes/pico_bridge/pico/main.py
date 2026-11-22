# =============================================================================
# main.py — runs ON the Pico 2 (MicroPython). Copy it to the Pico as main.py.
# =============================================================================
# Talks to the Mac over the USB cable using plain text lines (see README).
#   Pico -> Mac:  "temp,23.4"   chip temperature in C, 5 times a second
#   Mac -> Pico:  "led,1" or "led,0"   turn the LED on/off
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
    """Act on one command line from the Mac."""
    parts = line.strip().split(",")
    if parts[0] == "led" and len(parts) == 2:
        led.value(1 if parts[1] == "1" else 0)


# Lets us check for incoming text without waiting for it.
poller = select.poll()
poller.register(sys.stdin, select.POLLIN)

last_sent = time.ticks_ms()
while True:
    if poller.poll(0):                 # a command has arrived
        handle(sys.stdin.readline())
    if time.ticks_diff(time.ticks_ms(), last_sent) >= 200:
        print("temp,%.1f" % read_temp_c())   # print() goes out over USB
        last_sent = time.ticks_ms()
