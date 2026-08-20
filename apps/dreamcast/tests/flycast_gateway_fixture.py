#!/usr/bin/env python3

import argparse
import http.server
import importlib.util
import pathlib
import sys
import urllib.parse


def load_gateway(repository: pathlib.Path):
    scripts = repository / "apps" / "gamecube" / "scripts"
    sys.path.insert(0, str(scripts))
    source = scripts / "plex-gateway.py"
    spec = importlib.util.spec_from_file_location("multiplex_console_gateway", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the console gateway module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    parser.add_argument("media", type=pathlib.Path)
    arguments = parser.parse_args()
    repository = pathlib.Path(__file__).resolve().parents[3]
    gateway = load_gateway(repository)

    items = [
        gateway.HomeItem(41, 2000, 0, "Network Movie", "Dreamcast", None),
        gateway.HomeItem(42, 2000, 0, "Second Feature", "Dreamcast", None),
    ]
    catalog = gateway.encode_bootstrap_catalog(
        "Flycast Plex", [gateway.HomeRow("Continue Watching", items)], []
    )
    manifest = gateway.encode_playback_manifest(
        gateway.PlaybackManifest(
            rating_key=42,
            media_duration_ms=2000,
            segment_start_ms=0,
            segment_duration_ms=2000,
            container_bytes=arguments.media.stat().st_size,
            video_bytes=1,
            audio_bytes=1,
            video_packets=1,
            audio_packets=1,
            video_pts90k=0,
            audio_pts90k=0,
            media_path="/v4/media/42/0.mpg",
        )
    )

    class FixtureHandler(gateway.GatewayHandler):
        def do_GET(self) -> None:
            if urllib.parse.urlsplit(self.path).path == "/v4/timeline":
                self._send_bytes(b"\x01", "application/octet-stream")
                return
            super().do_GET()

    FixtureHandler.media_path = arguments.media
    FixtureHandler.bootstrap_catalog_bytes = catalog
    FixtureHandler.playback_manifest_bytes = manifest
    FixtureHandler.playback_cache = {(42, 0): (manifest, arguments.media)}
    FixtureHandler.playback_preparing = {}
    FixtureHandler.plex_base_url = "http://127.0.0.1:9"
    FixtureHandler.plex_token = None
    FixtureHandler.playback_target = "dreamcast"
    FixtureHandler.libraries = {}
    FixtureHandler.pairing_client = None
    server = http.server.ThreadingHTTPServer(
        ("0.0.0.0", arguments.port), FixtureHandler
    )
    print(f"Dreamcast Flycast gateway ready on port {arguments.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
