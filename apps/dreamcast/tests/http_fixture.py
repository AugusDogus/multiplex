#!/usr/bin/env python3

import argparse
import http.server


BODY = b"multiplex-dreamcast-http"
RANGE_BODY = bytes(index % 251 for index in range(32768))


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    attempts: dict[int, int] = {}

    def do_GET(self) -> None:
        if self.path == "/body.bin":
            self.send_response(200)
            self.send_header("Content-Length", str(len(BODY)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(BODY)
            self.close_connection = True
            return
        if self.path != "/ranges.bin":
            self.send_error(404)
            return
        range_header = self.headers.get("Range", "")
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
        end = int(last)
        if start < 0 or end < start or end >= len(RANGE_BODY):
            self.send_error(416)
            return
        payload = RANGE_BODY[start : end + 1]
        self.send_response(206)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Content-Range", f"bytes {start}-{end}/{len(RANGE_BODY)}")
        should_truncate = start == 8192 and self.attempts.get(start, 0) == 0
        self.send_header("Connection", "close")
        self.end_headers()
        self.attempts[start] = self.attempts.get(start, 0) + 1
        if should_truncate:
            self.wfile.write(payload[: len(payload) // 2])
        else:
            self.wfile.write(payload)
        self.wfile.flush()
        self.close_connection = True

    def log_message(self, format: str, *args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    arguments = parser.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", arguments.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
