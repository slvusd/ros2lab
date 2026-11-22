#!/usr/bin/env python3
# fake_gateway.py — pretends to be the gateway micro:bit for hardware-free tests.
# Creates a virtual serial port (path printed on line 1), "receives radio
# packets" (sends rx,temp,23.5 and rx,hello), and appends every line the Mac
# sends to the file given as argv[1].
import os, pty, select, sys, time

master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
log = open(sys.argv[1], "a", buffering=1)
buf = b""
end = time.time() + 30
while time.time() < end:
    os.write(master, b"rx,temp,23.5\nrx,hello\nrx,Bad Name!,7\n")
    if select.select([master], [], [], 0.2)[0]:
        buf += os.read(master, 256)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            log.write(line.decode() + "\n")
