# =============================================================================
# student_example.py — runs on a STUDENT micro:bit (not the gateway).
# =============================================================================
# Publishes its temperature and listens for an "led" message from ROS.
#   ROS topics:  /microbit/team3_temp   (this board publishes)
#                /microbit/in/team3_led (publish "1" or "0" there to light the face)
# Use a channel name unique to your team. Set GROUP to match the gateway.
# =============================================================================
from microbit import display, Image, temperature, running_time, sleep
import radio

GROUP = 1
radio.config(group=GROUP)
radio.on()

last = -1000
while True:
    if running_time() - last >= 1000:           # once a second
        last = running_time()
        radio.send("p:team3_temp," + str(temperature()))   # publish
        radio.send("s:team3_led")                           # subscribe (repeat is fine)

    msg = radio.receive()
    if msg and msg.startswith("m:team3_led,"):  # a message for our channel
        if msg.split(",")[1] == "1":
            display.show(Image.HAPPY)
        else:
            display.clear()
    sleep(20)
