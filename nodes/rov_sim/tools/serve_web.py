#!/usr/bin/env python3
# =============================================================================
# serve_web.py — serve the browser version (web/) on your own computer, with NO caching
# =============================================================================
#   python3 nodes/rov_sim/tools/serve_web.py            then open http://localhost:8000
#   python3 nodes/rov_sim/tools/serve_web.py 8080       another port
# Why not `python3 -m http.server`? It lets the browser keep old copies of the page's scripts, so after an update the page can end up part old, part
# new, and a new option quietly does nothing until you hard-reload. This tells the browser to always ask again (like the Python sim's own server does).
# Plain standard library; for classroom use or testing, not for the internet.
# =============================================================================
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


class NoCache(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), NoCache)
    print(f"ROV pool (browser version) is at http://localhost:{server.server_address[1]}   (Ctrl+C to quit)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()
