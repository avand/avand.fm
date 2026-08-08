"""Preview server for the Headroom site.

Serves the site and, under /video/, the transcoded renditions. Two servers are
started:

  8100  the site, with /video/ mounted alongside it
  8101  the video on its own origin

The site mounts the video at a same-origin path so a preview works from
anywhere the machine is reachable -- a phone on the LAN, or a tunnel -- where
127.0.0.1:8101 would mean nothing. 8101 stays because production really is
cross-origin, and it is the only way to exercise that path locally.

Both implement Range properly. Python's stock handler advertises Accept-Ranges
and then ignores Range, returning whole files with a 200 -- useless here, since
the HLS playlists address segments as byte ranges inside one file per rendition.
"""

import functools
import http.server
import os
import posixpath
import re
import sys
import threading
import urllib.parse

_HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(_HERE)  # this file lives in <site>/video/
VIDEO_DIR = os.path.join(_HERE, "dist")
VIDEO_MOUNT = "/video/"


class Handler(http.server.SimpleHTTPRequestHandler):
    # Python's mimetypes doesn't know these, and a browser refuses a caption
    # track that isn't text/vtt.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".vtt": "text/vtt",
        ".m3u8": "application/vnd.apple.mpegurl",
        ".m4s": "video/iso.segment",
    }

    mount = None  # (url prefix, directory) served in addition to `directory`

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Accept-Ranges", "bytes")
        # Without this the browser heuristically caches player.js, and you edit
        # a file, reload, and quietly keep testing the old one.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        if self.mount:
            prefix, root = self.mount
            clean = urllib.parse.urlparse(path).path
            if clean.startswith(prefix):
                rest = posixpath.normpath(clean[len(prefix):]).lstrip("/")
                return os.path.join(root, *rest.split("/"))
        return super().translate_path(path)

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404)
            return None

        size = os.fstat(f.fileno()).st_size
        start_s, end_s = m.group(1), m.group(2)

        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:
            # "bytes=-N" means the final N bytes.
            start = max(0, size - int(end_s))
            end = size - 1

        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            f.close()
            return None

        end = min(end, size - 1)
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()

        f.seek(start)
        return _Capped(f, length)

    def log_message(self, *args):
        pass


class _Capped:
    """Reader that stops after `remaining` bytes, so copyfile sends exactly the
    requested range and not the rest of the file."""

    def __init__(self, f, remaining):
        self.f = f
        self.remaining = remaining

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n is None or n < 0 or n > self.remaining:
            n = self.remaining
        data = self.f.read(n)
        self.remaining -= len(data)
        return data

    def close(self):
        self.f.close()


def serve(port, directory, mount=None):
    handler = functools.partial(Handler, directory=directory)
    # functools.partial can't set a class attribute, so subclass per server.
    cls = type("Mounted", (Handler,), {"mount": mount})
    handler = functools.partial(cls, directory=directory)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    site_port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100
    video_port = int(sys.argv[2]) if len(sys.argv) > 2 else 8101

    serve(site_port, SITE_DIR, mount=(VIDEO_MOUNT, VIDEO_DIR))
    serve(video_port, VIDEO_DIR)

    print(f"site   -> http://localhost:{site_port}/headroom/")
    print(f"video  -> http://localhost:{site_port}{VIDEO_MOUNT} (same origin)")
    print(f"       -> http://localhost:{video_port}/ (cross origin)")
    print("\nCtrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
