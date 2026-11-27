# =============================================================================
# makecode_tilt_3thrusters.py — steer a 3-thruster ROV by TILTING a micro:bit.
# Written for MakeCode (https://makecode.microbit.org, switch the editor to Python). Not on the website.
# =============================================================================
# Pool page address:  ...?thrusters=3      (t1 red/left, t2 green/right, t3 the ONE up/down thruster)
# Tilt away from you = forward, tilt right = turn right. Button B = up, button A = down.
# Same serial line as the program that worked:  serial.write_line("p:t1,1")
# Close the MakeCode serial window before clicking "Connect micro:bit / Pico" on the pool page.
# =============================================================================


def clamp(v: number):
    return max(-1, min(1, v))


def tilt(raw: number):
    v = clamp(raw / 600)                      # about 35 degrees of tilt = full power
    if abs(v) < 0.15:                         # ignore small wobbles when held level
        return 0
    return Math.round(v * 100) / 100          # 2 decimals keeps every line short


def send(channel: str, value: number):
    serial.write_line("p:" + channel + "," + str(value))


def on_forever():
    forward = tilt(-input.acceleration(Dimension.Y))   # tipping the top edge away = forward
    turn = tilt(input.acceleration(Dimension.X))       # tipping right = turn right
    up = 0
    if input.button_is_pressed(Button.B):
        up = 1
    if input.button_is_pressed(Button.A):
        up = -1
    send("t1", clamp(forward + turn))         # left thruster works harder to turn right
    send("t2", clamp(forward - turn))         # right thruster
    send("t3", up)                            # the single up/down thruster (+ is up)
    basic.pause(100)
basic.forever(on_forever)
