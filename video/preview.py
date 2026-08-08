"""Preview server for the Headroom site.

Serves the repo over HTTP on one port, binding 0.0.0.0 so a phone on the LAN or
the Cloudflare tunnel can reach it.

It exists instead of `python3 -m http.server` for one header: Cache-Control:
no-store. Without it the browser heuristically caches player.js, and you edit a
file, reload, and quietly keep testing the old one -- which costs an hour before
you think to suspect it.

Video is *not* served from here. It comes from https://video.avand.fm (R2), in
preview exactly as in production, so what you are looking at is the real
cross-origin path against the real files. See player.js.
"""

import functools
import http.server
import os
import sys
import threading

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100

    handler = functools.partial(Handler, directory=SITE_DIR)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    print(f"site  -> http://localhost:{port}/headroom/")
    print("video -> https://video.avand.fm/ (R2, same as production)")
    print("\nCtrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
