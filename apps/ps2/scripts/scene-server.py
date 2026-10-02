#!/usr/bin/env python3

import argparse
import struct
import subprocess
import tempfile
import threading
import urllib.request
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--scene", required=True, type=Path)
    parser.add_argument("--exporter", type=Path)
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--catalog-url")
    parser.add_argument("--details-url-template")
    parser.add_argument("--playback-url-template")
    parser.add_argument("--gateway-base-url")
    parser.add_argument("--media-cache", type=Path)
    parser.add_argument("--log", required=True, type=Path)
    arguments = parser.parse_args()
    scene = arguments.scene.read_bytes()
    actions: list[int] = []
    catalog_rendered = False
    scene_lock = threading.Lock()
    prepared_media: set[int] = set()

    if arguments.catalog is not None and arguments.catalog_url is not None:
        parser.error("--catalog and --catalog-url are mutually exclusive")

    def catalog_bytes() -> bytes | None:
        try:
            if arguments.catalog is not None:
                return arguments.catalog.read_bytes()
            if arguments.catalog_url is not None:
                with urllib.request.urlopen(
                    arguments.catalog_url, timeout=10
                ) as response:
                    return response.read()
            return None
        except OSError as error:
            raise RuntimeError(f"could not load catalog: {error}") from error

    def prepare_media(rating_key: int) -> None:
        if rating_key in prepared_media:
            return
        if (
            arguments.playback_url_template is None
            or arguments.gateway_base_url is None
            or arguments.media_cache is None
        ):
            raise RuntimeError("playback media configuration is incomplete")
        manifest_url = arguments.playback_url_template.format(
            rating_key=rating_key
        )
        try:
            with urllib.request.urlopen(manifest_url, timeout=180) as response:
                manifest = response.read()
        except OSError as error:
            raise RuntimeError(f"could not load playback manifest: {error}") from error
        if len(manifest) < 62 or manifest[:4] != b"MPXP":
            raise RuntimeError("gateway returned an invalid playback manifest")
        manifest_rating = struct.unpack_from(">I", manifest, 8)[0]
        path_length = struct.unpack_from(">H", manifest, 60)[0]
        if manifest_rating != rating_key or 62 + path_length != len(manifest):
            raise RuntimeError("playback manifest does not match the request")
        media_path = manifest[62:].decode("ascii")
        media_url = urllib.parse.urljoin(arguments.gateway_base_url, media_path)
        arguments.media_cache.mkdir(parents=True, exist_ok=True)
        program_path = arguments.media_cache / f"{rating_key}.mpg"
        video_path = arguments.media_cache / f"{rating_key}.m2v"
        audio_path = arguments.media_cache / f"{rating_key}.pcm"
        try:
            with urllib.request.urlopen(media_url, timeout=180) as response:
                program_path.write_bytes(response.read())
        except OSError as error:
            raise RuntimeError(f"could not load playback media: {error}") from error
        commands = [
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(program_path), "-map", "0:v:0", "-an", "-vf",
                "scale=640:480", "-c:v", "mpeg2video", "-profile:v", "main",
                "-level:v", "main", "-pix_fmt", "yuv420p", "-bf", "0",
                "-g", "15", "-flags", "+cgop", "-sc_threshold", "1000000000",
                "-f", "mpeg2video", str(video_path),
            ],
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(program_path), "-map", "0:a:0", "-vn", "-f",
                "s16le", "-ar", "48000", "-ac", "2", str(audio_path),
            ],
        ]
        for command in commands:
            result = subprocess.run(command, check=False, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip())
        with video_path.open("ab") as output:
            output.write(b"\x00\x00\x01\xb7")
        prepared_media.add(rating_key)
        with arguments.log.open("a", encoding="utf-8") as output:
            output.write(
                f"media rating_key={rating_key} video_bytes={video_path.stat().st_size} "
                f"audio_bytes={audio_path.stat().st_size}\n"
            )

    def current_scene(action: int | None) -> bytes:
        nonlocal catalog_rendered, scene
        with scene_lock:
            catalog_requested = (
                arguments.catalog is not None or arguments.catalog_url is not None
            )
            if arguments.exporter is None or (
                action is None and (not catalog_requested or catalog_rendered)
            ):
                return scene
            if action is not None:
                actions.append(action)
            catalog = catalog_bytes()
            with tempfile.NamedTemporaryFile(suffix=".scene") as output, tempfile.NamedTemporaryFile(
                suffix=".bin"
            ) as catalog_output, tempfile.NamedTemporaryFile(suffix=".bin") as details_output:
                command = [str(arguments.exporter), output.name, ",".join(map(str, actions))]
                if catalog is not None:
                    catalog_output.write(catalog)
                    catalog_output.flush()
                    command.append(catalog_output.name)
                result = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if result.returncode != 0:
                    if action is not None:
                        actions.pop()
                    raise RuntimeError(result.stderr.strip())
                scene = Path(output.name).read_bytes()
                request_kind = struct.unpack_from("<I", scene, 12)[0]
                request_rating_key = struct.unpack_from("<I", scene, 60)[0]
                if request_kind == 1 and arguments.details_url_template is not None:
                    details_url = arguments.details_url_template.format(
                        rating_key=request_rating_key
                    )
                    try:
                        with urllib.request.urlopen(details_url, timeout=10) as response:
                            details = response.read()
                    except OSError as error:
                        raise RuntimeError(f"could not load details: {error}") from error
                    details_output.write(details)
                    details_output.flush()
                    result = subprocess.run(
                        [*command, details_output.name],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    if result.returncode != 0:
                        if action is not None:
                            actions.pop()
                        raise RuntimeError(result.stderr.strip())
                    scene = Path(output.name).read_bytes()
                    request_kind = struct.unpack_from("<I", scene, 12)[0]
                    request_rating_key = struct.unpack_from("<I", scene, 60)[0]
                    if request_kind == 2:
                        prepare_media(request_rating_key)
                        result = subprocess.run(
                            [*command, details_output.name, str(request_rating_key)],
                            check=False,
                            capture_output=True,
                            text=True,
                        )
                        if result.returncode != 0:
                            if action is not None:
                                actions.pop()
                            raise RuntimeError(result.stderr.strip())
                        scene = Path(output.name).read_bytes()
                catalog_rendered = catalog is not None
            return scene

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            user_agent = self.headers.get("User-Agent", "")
            if self.path == "/ready":
                body = b"ready\n"
                status = HTTPStatus.OK
            elif self.path == "/scene" and user_agent == "Multiplex-PS2-Scene-Client/1":
                body = current_scene(None)
                status = HTTPStatus.OK
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"scene bytes={len(body)} source={self.client_address[0]} "
                        f"user_agent={user_agent}\n"
                    )
            elif self.path == "/verified" and user_agent == "Multiplex-PS2-Scene-Client/1":
                body = b"verified\n"
                status = HTTPStatus.OK
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"verified source={self.client_address[0]} "
                        f"user_agent={user_agent}\n"
                    )
            elif self.path.startswith("/failed/") and user_agent == "Multiplex-PS2-Scene-Client/1":
                body = b"recorded\n"
                status = HTTPStatus.OK
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"validation_failed reason={self.path.removeprefix('/failed/')} "
                        f"source={self.client_address[0]}\n"
                    )
            elif self.path.startswith("/video/") and self.path.endswith(".m2v"):
                rating_text = self.path.removeprefix("/video/").removesuffix(".m2v")
                media_path = (
                    arguments.media_cache / f"{rating_text}.m2v"
                    if arguments.media_cache is not None and rating_text.isdigit()
                    else None
                )
                if media_path is None or not media_path.is_file():
                    body = b"not found\n"
                    status = HTTPStatus.NOT_FOUND
                else:
                    body = media_path.read_bytes()
                    status = HTTPStatus.OK
                    with arguments.log.open("a", encoding="utf-8") as output:
                        output.write(
                            f"video rating_key={rating_text} bytes={len(body)} "
                            f"source={self.client_address[0]}\n"
                        )
            elif self.path.startswith("/played/"):
                rating_text = self.path.removeprefix("/played/")
                body = b"played\n"
                status = HTTPStatus.OK
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"played rating_key={rating_text} "
                        f"source={self.client_address[0]}\n"
                    )
            elif self.path.startswith("/audio/") and self.path.endswith(".pcm"):
                rating_text = self.path.removeprefix("/audio/").removesuffix(".pcm")
                media_path = (
                    arguments.media_cache / f"{rating_text}.pcm"
                    if arguments.media_cache is not None and rating_text.isdigit()
                    else None
                )
                if media_path is None or not media_path.is_file():
                    body = b"not found\n"
                    status = HTTPStatus.NOT_FOUND
                else:
                    body = media_path.read_bytes()
                    status = HTTPStatus.OK
                    with arguments.log.open("a", encoding="utf-8") as output:
                        output.write(
                            f"audio rating_key={rating_text} bytes={len(body)} "
                            f"source={self.client_address[0]}\n"
                        )
            elif self.path.startswith("/action/") and user_agent == "Multiplex-PS2-Scene-Client/1":
                try:
                    action = int(self.path.removeprefix("/action/"))
                    body = current_scene(action)
                    status = HTTPStatus.OK
                except (ValueError, RuntimeError):
                    body = b"invalid action\n"
                    status = HTTPStatus.BAD_REQUEST
                with arguments.log.open("a", encoding="utf-8") as output:
                    output.write(
                        f"action value={self.path.removeprefix('/action/')} "
                        f"bytes={len(body)} source={self.client_address[0]}\n"
                    )
            else:
                body = b"not found\n"
                status = HTTPStatus.NOT_FOUND

            self.send_response(status)
            self.send_header("Content-Type", "application/vnd.multiplex.scene")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *values: object) -> None:
            return

    arguments.log.parent.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer((arguments.bind, arguments.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
