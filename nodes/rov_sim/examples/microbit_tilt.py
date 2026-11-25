# =============================================================================
# microbit_tilt.py — drive the ROV pool by TILTING a micro:bit. Runs ON the micro:bit (MicroPython).
# =============================================================================
# 1. Flash this with https://python.microbit.org (or Mu), then leave the micro:bit plugged in with USB.
# 2. Open the browser ROV pool (Chrome / Edge / Chromebook), click "Connect micro:bit / Pico", pick the micro:bit.
#    (Close the micro:bit editor's serial window first: only one program can use the USB port.)
# Tilt away from you = forward, tilt right = turn right. Button B = up, button A = down.
# Every print() is one line of the topic protocol (docs/PROTOCOL.md): p:t1,0.5 means "thruster 1 at half power".
# Not yet run on real hardware (as of writing).
# =============================================================================
from microbit import accelerometer, button_a, button_b, display, sleep, Image

display.show(Image.ARROW_N)


def clamp(v):
    return max(-1, min(1, v))


def tilt(raw):
    v = clamp(raw / 600)              # about 35 degrees of tilt = full power
    return 0 if abs(v) < 0.15 else v  # ignore small wobbles when it is held level


while True:
    forward = tilt(-accelerometer.get_y())
    turn = tilt(accelerometer.get_x())
    up = (1 if button_b.is_pressed() else 0) - (1 if button_a.is_pressed() else 0)
    print("p:t1,%.2f" % clamp(forward + turn))    # left thruster
    print("p:t2,%.2f" % clamp(forward - turn))    # right thruster
    print("p:t3,%d" % up)                         # front up/down thruster
    print("p:t4,%d" % up)                         # rear up/down thruster
    sleep(100)
