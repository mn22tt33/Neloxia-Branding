# -*- coding: utf-8 -*-
"""سيرفر تطوير محلي: يقدم الفرونت اند ويوجه /api/* إلى Railway."""
import http.server
import json
import os
import sys
import threading
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlsplit

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
API_TARGET = "https://quizora55.up.railway.app"
PORT = 8080


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    # ---------- proxy helpers ----------
    def _proxy(self, method):
        url = API_TARGET + self.path
        body = None
        headers = {}
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else None
            ct = self.headers.get("Content-Type")
            if ct:
                headers["Content-Type"] = ct

        req = Request(url, data=body, headers=headers, method=method)
        try:
            resp = urlopen(req, timeout=30)
            data = resp.read()
            self.send_response(resp.status)
            for key in ("Content-Type",):
                val = resp.headers.get(key)
                if val:
                    self.send_header(key, val)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            ct = e.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = json.dumps({"ok": False, "error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET")
            return
        # Serve config.js with empty apiBaseUrl (same-origin)
        if self.path == "/config.js":
            body = b'window.APP_CONFIG = window.APP_CONFIG || {};\nwindow.APP_CONFIG.apiBaseUrl = "";'
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
            return
        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/api/" in msg:
            sys.stdout.write(f"  [proxy] {msg}\n")
        elif not any(x in msg for x in (".png", ".js", ".json", ".ico")):
            sys.stdout.write(f"  [file]  {msg}\n")


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), DevHandler)
    print(f"\n  ✅ سيرفر التطوير يعمل!")
    print(f"  🌐 افتح: http://localhost:{PORT}")
    print(f"  🔗 API → {API_TARGET}")
    print(f"  ⛔ للإيقاف: Ctrl+C\n")
    try:
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
