#!/usr/bin/env python3
# fake_pico.py — pretends to be the Pico so the bridge can be tested with no
# hardware. Creates a virtual serial port, prints its path on line 1, sends
# "temp,23.5" five times a second, and appends any received command to the
# file given as argv[1].
import os, pty, select, sys, time

master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
log = open(sys.argv[1], "a", buffering=1)
buf = b""
end = time.time() + 30
while time.time() < end:
    os.write(master, b"temp,23.5\n")
    if select.select([master], [], [], 0.2)[0]:
        buf += os.read(master, 256)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            log.write(line.decode() + "\n")
