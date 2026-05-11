#!/usr/bin/env python3
"""Local dev server for fortweb.

Serves the directory one level above this file so the app's absolute
`/fortweb/...` URLs (see pyscript-ci.toml and the wheel paths in
app/runtime/wallet-worker.py) resolve correctly. Also implements the
`/_fortweb_proxy/<scheme>/<host:port>/<path>` proxy that the in-browser
wallet worker uses to reach local services (kf-boot, witnesses, watcher)
from a single origin — without this, cross-origin fetches from the app
are blocked by the browser.

Usage: python serve.py
Then open http://127.0.0.1:8040/fortweb/app/index.html
"""

from __future__ import annotations

import http.server
import os
import socketserver
from functools import partial
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


PORT = int(os.environ.get("PORT", "8040"))
SERVE_ROOT = Path(__file__).resolve().parent.parent

PROXY_PREFIX = "/_fortweb_proxy/"
ALLOWED_PROXY_HOSTS = {"127.0.0.1", "localhost", "::1"}
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path.startswith(PROXY_PREFIX.rstrip("/")):
            self._proxy_request()
            return
        super().do_GET()

    def do_POST(self):
        self._proxy_or_405()

    def do_PUT(self):
        self._proxy_or_405()

    def do_PATCH(self):
        self._proxy_or_405()

    def do_DELETE(self):
        self._proxy_or_405()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def _proxy_or_405(self):
        if urlsplit(self.path).path.startswith(PROXY_PREFIX.rstrip("/")):
            self._proxy_request()
            return
        self.send_error(405, f"{self.command} is only supported for the local proxy path.")

    def _proxy_request(self):
        try:
            target_url = self._proxy_target_url()
        except ValueError as exc:
            message = f"{exc}\n".encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            return

        body = b""
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length > 0:
            body = self.rfile.read(content_length)

        headers = {}
        for key, value in self.headers.items():
            lowered = key.lower()
            if lowered in {"host", "origin", "referer", "connection", "content-length"}:
                continue
            headers[key] = value

        request = Request(
            target_url,
            data=body if self.command in {"POST", "PUT", "PATCH", "DELETE"} else None,
            headers=headers,
            method=self.command,
        )

        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() in HOP_BY_HOP_HEADERS:
                        continue
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            for key, value in exc.headers.items():
                if key.lower() in HOP_BY_HOP_HEADERS:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if payload:
                self.wfile.write(payload)
        except URLError as exc:
            message = f"Local proxy request failed for {target_url}: {exc.reason}\n".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)

    def _proxy_target_url(self) -> str:
        parts = urlsplit(self.path)
        path = parts.path
        if not path.startswith(PROXY_PREFIX):
            raise ValueError("Proxy path was malformed.")

        remainder = path[len(PROXY_PREFIX):]
        try:
            scheme, rest = remainder.split("/", 1)
            netloc, tail = rest.split("/", 1)
        except ValueError as exc:
            raise ValueError("Proxy path must be /_fortweb_proxy/<scheme>/<host:port>/<path>.") from exc

        if scheme not in {"http", "https"}:
            raise ValueError("Proxy scheme must be http or https.")

        hostname = netloc.split(":", 1)[0]
        if hostname not in ALLOWED_PROXY_HOSTS:
            raise ValueError(f"Proxy host '{hostname}' is not allowed.")

        target = f"{scheme}://{netloc}/{tail}"
        if parts.query:
            target = f"{target}?{parts.query}"
        return target


if __name__ == "__main__":
    handler = partial(DevHandler, directory=str(SERVE_ROOT))
    with ReusableTCPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving fortweb at http://127.0.0.1:{PORT}/fortweb/app/index.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped")
