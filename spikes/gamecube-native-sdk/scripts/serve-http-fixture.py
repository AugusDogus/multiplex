#!/usr/bin/env python3

import argparse
import http.server
import pathlib


class MediaFixtureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    media_path: pathlib.Path

    def do_GET(self) -> None:
        if self.path != "/multiplex-dvd-demo.mpg":
            self.send_error(404)
            return

        media = self.media_path.read_bytes()
        start = 0
        end = len(media) - 1
        range_header = self.headers.get("Range")
        if range_header is not None:
            unit, separator, requested = range_header.partition("=")
            first, dash, last = requested.partition("-")
            if (
                unit != "bytes"
                or separator != "="
                or dash != "-"
                or not first.isdigit()
                or not last.isdigit()
            ):
                self.send_error(400)
                return
            start = int(first)
            end = min(int(last), end)
            if start > end:
                self.send_error(416)
                return

        body = media[start : end + 1]
        self.send_response(206 if range_header is not None else 200)
        self.send_header("Content-Type", "video/mpeg")
        self.send_header("Accept-Ranges", "bytes")
        if range_header is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(media)}")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        self.close_connection = False

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    parser.add_argument("media", type=pathlib.Path)
    arguments = parser.parse_args()
    MediaFixtureHandler.media_path = arguments.media
    server = http.server.ThreadingHTTPServer(("0.0.0.0", arguments.port), MediaFixtureHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
