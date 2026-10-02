#!/usr/bin/env python3

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--log", required=True, type=Path)
    arguments = parser.parse_args()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            nonce = parse_qs(parsed.query).get("nonce", [""])[0]
            user_agent = self.headers.get("User-Agent", "")
            if parsed.path == "/ready":
                body = b"ready\n"
                status = HTTPStatus.OK
            elif (
                parsed.path == "/probe"
                and nonce == arguments.nonce
                and user_agent == "Multiplex-PS2-Network-Probe/1"
            ):
                body = f"MPS2-NET-VERIFIED {nonce}\n".encode()
                status = HTTPStatus.OK
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"verified nonce={nonce} source={self.client_address[0]} "
                        f"user_agent={user_agent}\n"
                    )
            else:
                body = b"invalid probe\n"
                status = HTTPStatus.BAD_REQUEST

            self.send_response(status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *values: object) -> None:
            return

    arguments.log.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((arguments.bind, arguments.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
