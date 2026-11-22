#!/usr/bin/env python3
# fake_device.py — pretends to be a Pico or gateway micro:bit for hardware-free
# tests. Creates a virtual serial port (path printed on line 1), sends
# protocol lines repeatedly, and appends every line the Mac sends to argv[1].
import os, pty, select, sys, time

master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
log = open(sys.argv[1], "a", buffering=1)
buf = b""
end = time.time() + 40
while time.time() < end:
    os.write(master, b"s:led\np:temp,23.5\np:msg,hello,world\np:Bad Name!,7\nboot noise\n")
    if select.select([master], [], [], 0.2)[0]:
        buf += os.read(master, 256)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            log.write(line.decode() + "\n")
