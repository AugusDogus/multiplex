#!/usr/bin/env python3

"""Small versioned Plex-to-console gateway for the GameCube spike."""

from __future__ import annotations

import argparse
import http.server
import io
import json
import pathlib
import struct
import threading
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass


CATALOG_MAGIC = b"MPXG"
CATALOG_VERSION = 1
HOME_CATALOG_VERSION = 2
BOOTSTRAP_CATALOG_VERSION = 3
BROWSE_CATALOG_VERSION = 1
MAX_ITEMS = 4
MAX_ROWS = 3
MAX_SERVER_NAME_BYTES = 63
MAX_TITLE_BYTES = 95
MAX_SUBTITLE_BYTES = 95
ARTWORK_WIDTH = 80
ARTWORK_HEIGHT = 120


@dataclass(frozen=True)
class CatalogItem:
    rating_key: int
    duration_ms: int
    view_offset_ms: int
    title: str


@dataclass(frozen=True)
class HomeItem:
    rating_key: int
    duration_ms: int
    view_offset_ms: int
    title: str
    subtitle: str
    artwork_path: str | None


@dataclass(frozen=True)
class HomeRow:
    title: str
    items: list[HomeItem]


@dataclass(frozen=True)
class LibrarySection:
    section_id: int
    title: str
    media_type: str


@dataclass(frozen=True)
class BrowsePage:
    section: LibrarySection
    start: int
    total_size: int
    items: list[HomeItem]


def _bounded_utf8(value: str, maximum: int) -> bytes:
    encoded = value.encode("utf-8")[:maximum]
    while encoded:
        try:
            encoded.decode("utf-8")
            return encoded
        except UnicodeDecodeError:
            encoded = encoded[:-1]
    return b""


def encode_catalog(server_name: str, items: list[CatalogItem]) -> bytes:
    server = _bounded_utf8(server_name, MAX_SERVER_NAME_BYTES)
    bounded_items = items[:MAX_ITEMS]
    body = bytearray(
        struct.pack(">4sHHHH", CATALOG_MAGIC, CATALOG_VERSION, len(bounded_items), len(server), 0)
    )
    body.extend(server)
    for item in bounded_items:
        title = _bounded_utf8(item.title, MAX_TITLE_BYTES)
        body.extend(
            struct.pack(
                ">IIIHH",
                max(0, min(item.rating_key, 0xFFFFFFFF)),
                max(0, min(item.duration_ms, 0xFFFFFFFF)),
                max(0, min(item.view_offset_ms, 0xFFFFFFFF)),
                len(title),
                0,
            )
        )
        body.extend(title)
    return bytes(body)


def _plex_xml(base_url: str, path: str, token: str | None) -> ET.Element:
    url = f"{base_url.rstrip('/')}{path}"
    if token:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urllib.parse.urlencode({'X-Plex-Token': token})}"
    request = urllib.request.Request(url, headers={"Accept": "application/xml"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return ET.fromstring(response.read())


def fetch_catalog(base_url: str, token: str | None) -> tuple[str, list[CatalogItem]]:
    root = _plex_xml(base_url, "/", token)
    server_name = root.get("friendlyName") or root.get("machineIdentifier") or "Plex"
    recent = _plex_xml(base_url, "/library/recentlyAdded", token)
    items: list[CatalogItem] = []
    for child in recent:
        if child.tag not in {"Video", "Directory"}:
            continue
        title = child.get("title") or child.get("grandparentTitle")
        rating_key = child.get("ratingKey", "")
        if not title or not rating_key.isdigit():
            continue
        items.append(
            CatalogItem(
                rating_key=int(rating_key),
                duration_ms=int(child.get("duration", "0") or 0),
                view_offset_ms=int(child.get("viewOffset", "0") or 0),
                title=title,
            )
        )
        if len(items) == MAX_ITEMS:
            break
    if not items:
        raise RuntimeError("Plex recently-added catalog contained no playable items")
    return server_name, items


def _item_title(element: ET.Element) -> str:
    if element.get("type") == "episode" and element.get("grandparentTitle"):
        return element.get("grandparentTitle", "Untitled")
    return element.get("title", "Untitled")


def _item_subtitle(element: ET.Element) -> str:
    if element.get("type") == "episode":
        episode = element.get("title", "Episode")
        season_index = element.get("parentIndex")
        episode_index = element.get("index")
        if season_index and episode_index:
            return f"{episode} · S{int(season_index):02d} E{int(episode_index):02d}"
        return episode
    return element.get("year") or element.get("type", "Media").replace("_", " ").title()


def fetch_home_catalog(base_url: str, token: str | None) -> tuple[str, list[HomeRow]]:
    root = _plex_xml(base_url, "/", token)
    server_name = root.get("friendlyName") or root.get("machineIdentifier") or "Plex"
    hubs = _plex_xml(base_url, "/hubs?onlyTransient=1", token)
    continue_rows: list[ET.Element] = []
    browse_rows: list[ET.Element] = []
    for hub in hubs.findall("Hub"):
        identifier = hub.get("hubIdentifier", "")
        if not list(hub):
            continue
        if ".continue" in identifier or ".inprogress" in identifier:
            continue_rows.append(hub)
        elif "home.ondeck" not in identifier:
            browse_rows.append(hub)

    rows: list[HomeRow] = []
    for hub in (continue_rows[:1] + browse_rows[: MAX_ROWS - 1]):
        items: list[HomeItem] = []
        for element in list(hub)[:MAX_ITEMS]:
            rating_key = element.get("ratingKey", "")
            if not rating_key.isdigit():
                continue
            artwork_path = element.get("grandparentThumb") or element.get("thumb")
            items.append(
                HomeItem(
                    rating_key=int(rating_key),
                    duration_ms=int(element.get("duration", "0") or 0),
                    view_offset_ms=int(element.get("viewOffset", "0") or 0),
                    title=_item_title(element),
                    subtitle=_item_subtitle(element),
                    artwork_path=artwork_path,
                )
            )
        if items:
            rows.append(HomeRow(hub.get("title", "Plex"), items))
    if not rows:
        raise RuntimeError("Plex home hubs contained no browsable items")
    return server_name, rows


def fetch_library_sections(base_url: str, token: str | None) -> list[LibrarySection]:
    root = _plex_xml(base_url, "/library/sections", token)
    sections: list[LibrarySection] = []
    for directory in root.findall("Directory"):
        key = directory.get("key", "")
        title = directory.get("title", "")
        media_type = directory.get("type", "")
        if not key.isdigit() or not title or not media_type:
            continue
        sections.append(LibrarySection(int(key), title, media_type))
    return sections[:8]


def fetch_browse_page(
    base_url: str,
    token: str | None,
    section: LibrarySection,
    start: int,
) -> BrowsePage:
    query = urllib.parse.urlencode(
        {
            "sort": "titleSort:asc",
            "X-Plex-Container-Start": start,
            "X-Plex-Container-Size": MAX_ITEMS,
        }
    )
    root = _plex_xml(base_url, f"/library/sections/{section.section_id}/all?{query}", token)
    items: list[HomeItem] = []
    for element in list(root)[:MAX_ITEMS]:
        rating_key = element.get("ratingKey", "")
        if not rating_key.isdigit():
            continue
        items.append(
            HomeItem(
                rating_key=int(rating_key),
                duration_ms=int(element.get("duration", "0") or 0),
                view_offset_ms=int(element.get("viewOffset", "0") or 0),
                title=_item_title(element),
                subtitle=_item_subtitle(element),
                artwork_path=element.get("grandparentThumb") or element.get("thumb"),
            )
        )
    total_size = int(root.get("totalSize") or root.get("size") or len(items))
    return BrowsePage(section, start, total_size, items)


def encode_home_catalog(server_name: str, rows: list[HomeRow]) -> bytes:
    server = _bounded_utf8(server_name, MAX_SERVER_NAME_BYTES)
    bounded_rows = rows[:MAX_ROWS]
    body = bytearray(
        struct.pack(">4sHHHH", CATALOG_MAGIC, HOME_CATALOG_VERSION, len(bounded_rows), len(server), 0)
    )
    body.extend(server)
    artwork_slot = 0
    for row in bounded_rows:
        title = _bounded_utf8(row.title, MAX_TITLE_BYTES)
        items = row.items[:MAX_ITEMS]
        body.extend(struct.pack(">HH", len(title), len(items)))
        body.extend(title)
        for item in items:
            item_title = _bounded_utf8(item.title, MAX_TITLE_BYTES)
            subtitle = _bounded_utf8(item.subtitle, MAX_SUBTITLE_BYTES)
            progress = 0 if item.duration_ms <= 0 else min(100, item.view_offset_ms * 100 // item.duration_ms)
            body.extend(
                struct.pack(
                    ">IIIHBBHH",
                    item.rating_key,
                    item.duration_ms,
                    item.view_offset_ms,
                    artwork_slot,
                    progress,
                    0,
                    len(item_title),
                    len(subtitle),
                )
            )
            body.extend(item_title)
            body.extend(subtitle)
            artwork_slot += 1
    return bytes(body)


def encode_bootstrap_catalog(
    server_name: str,
    rows: list[HomeRow],
    libraries: list[LibrarySection],
) -> bytes:
    body = bytearray(encode_home_catalog(server_name, rows))
    struct.pack_into(">H", body, 4, BOOTSTRAP_CATALOG_VERSION)
    struct.pack_into(">H", body, 10, len(libraries))
    media_types = {"movie": 1, "show": 2, "artist": 3, "photo": 4}
    for library in libraries:
        title = _bounded_utf8(library.title, MAX_TITLE_BYTES)
        body.extend(
            struct.pack(
                ">HBBH",
                min(library.section_id, 0xFFFF),
                media_types.get(library.media_type, 0),
                0,
                len(title),
            )
        )
        body.extend(title)
    return bytes(body)


def encode_browse_page(page: BrowsePage) -> bytes:
    title = _bounded_utf8(page.section.title, MAX_TITLE_BYTES)
    body = bytearray(
        struct.pack(
            ">4sHHHHHH",
            b"MPXB",
            BROWSE_CATALOG_VERSION,
            min(page.section.section_id, 0xFFFF),
            len(page.items),
            min(page.start, 0xFFFF),
            min(page.total_size, 0xFFFF),
            len(title),
        )
    )
    body.extend(title)
    for artwork_slot, item in enumerate(page.items):
        item_title = _bounded_utf8(item.title, MAX_TITLE_BYTES)
        subtitle = _bounded_utf8(item.subtitle, MAX_SUBTITLE_BYTES)
        progress = 0 if item.duration_ms <= 0 else min(100, item.view_offset_ms * 100 // item.duration_ms)
        body.extend(
            struct.pack(
                ">IIIHBBHH",
                item.rating_key,
                item.duration_ms,
                item.view_offset_ms,
                artwork_slot,
                progress,
                0,
                len(item_title),
                len(subtitle),
            )
        )
        body.extend(item_title)
        body.extend(subtitle)
    return bytes(body)


def _plex_bytes(base_url: str, path: str, token: str | None) -> bytes:
    url = f"{base_url.rstrip('/')}{path}"
    if token:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urllib.parse.urlencode({'X-Plex-Token': token})}"
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.read()


def build_artwork_atlas(base_url: str, token: str | None, rows: list[HomeRow]) -> bytes:
    from PIL import Image, ImageOps

    atlas_rows = max(1, min(MAX_ROWS, len(rows)))
    atlas = Image.new("RGB", (ARTWORK_WIDTH * MAX_ITEMS, ARTWORK_HEIGHT * atlas_rows))
    slot = 0
    for row in rows[:MAX_ROWS]:
        for item in row.items[:MAX_ITEMS]:
            try:
                if not item.artwork_path:
                    raise ValueError("missing artwork")
                source = Image.open(io.BytesIO(_plex_bytes(base_url, item.artwork_path, token)))
                image = ImageOps.fit(source.convert("RGB"), (ARTWORK_WIDTH, ARTWORK_HEIGHT))
            except Exception:
                color = ((item.rating_key * 29) & 255, (item.rating_key * 53) & 255, (item.rating_key * 97) & 255)
                image = Image.new("RGB", (ARTWORK_WIDTH, ARTWORK_HEIGHT), color)
            atlas.paste(
                image,
                ((slot % MAX_ITEMS) * ARTWORK_WIDTH, (slot // MAX_ITEMS) * ARTWORK_HEIGHT),
            )
            slot += 1
    encoded = io.BytesIO()
    atlas.save(encoded, format="JPEG", quality=75, optimize=True, progressive=False)
    return encoded.getvalue()


class GatewayHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    media_path: pathlib.Path
    catalog_bytes: bytes
    home_catalog_bytes: bytes
    bootstrap_catalog_bytes: bytes
    artwork_bytes: bytes
    health_bytes: bytes
    plex_base_url: str
    plex_token: str | None
    libraries: dict[int, LibrarySection]
    browse_cache: dict[tuple[int, int], tuple[bytes, bytes]] = {}
    browse_cache_lock = threading.Lock()

    @classmethod
    def _browse_payload(cls, section_id: int, start: int) -> tuple[bytes, bytes] | None:
        section = cls.libraries.get(section_id)
        if section is None or start < 0 or start > 0xFFFF:
            return None
        cache_key = (section_id, start)
        with cls.browse_cache_lock:
            cached = cls.browse_cache.get(cache_key)
            if cached is not None:
                return cached
            page = fetch_browse_page(cls.plex_base_url, cls.plex_token, section, start)
            catalog = encode_browse_page(page)
            artwork = build_artwork_atlas(
                cls.plex_base_url,
                cls.plex_token,
                [HomeRow(section.title, page.items)],
            )
            cls.browse_cache[cache_key] = (catalog, artwork)
            return catalog, artwork

    def _send_bytes(self, body: bytes, content_type: str) -> None:
        start = 0
        end = len(body) - 1
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
        payload = body[start : end + 1]
        self.send_response(206 if range_header is not None else 200)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        if range_header is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(payload)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _send_media(self) -> None:
        media_size = self.media_path.stat().st_size
        start = 0
        end = media_size - 1
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
        body_size = end - start + 1
        self.send_response(206 if range_header is not None else 200)
        self.send_header("Content-Type", "video/mpeg")
        self.send_header("Accept-Ranges", "bytes")
        if range_header is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{media_size}")
        self.send_header("Content-Length", str(body_size))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            with self.media_path.open("rb") as media:
                media.seek(start)
                remaining = body_size
                while remaining:
                    chunk = media.read(min(64 * 1024, remaining))
                    if not chunk:
                        raise OSError("media file ended during response")
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        if path == "/v1/health":
            self._send_bytes(self.health_bytes, "application/json")
        elif path == "/v1/catalog.bin":
            self._send_bytes(self.catalog_bytes, "application/octet-stream")
        elif path == "/v2/catalog.bin":
            self._send_bytes(self.home_catalog_bytes, "application/octet-stream")
        elif path == "/v2/artwork.jpg":
            self._send_bytes(self.artwork_bytes, "image/jpeg")
        elif path == "/v3/catalog.bin":
            self._send_bytes(self.bootstrap_catalog_bytes, "application/octet-stream")
        elif path in {"/v3/browse.bin", "/v3/browse.jpg"}:
            section_value = query.get("section", [""])[0]
            start_value = query.get("start", ["0"])[0]
            if not section_value.isdigit() or not start_value.isdigit():
                self.send_error(400)
                return
            payload = self._browse_payload(int(section_value), int(start_value))
            if payload is None:
                self.send_error(404)
                return
            if path.endswith(".bin"):
                self._send_bytes(payload[0], "application/octet-stream")
            else:
                self._send_bytes(payload[1], "image/jpeg")
        elif path == "/v1/media/current.mpg":
            self._send_media()
        else:
            self.send_error(404)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("port", type=int)
    parser.add_argument("media", type=pathlib.Path)
    parser.add_argument("--plex-base-url", required=True)
    parser.add_argument("--token")
    arguments = parser.parse_args()

    server_name, items = fetch_catalog(arguments.plex_base_url, arguments.token)
    home_server_name, rows = fetch_home_catalog(arguments.plex_base_url, arguments.token)
    libraries = fetch_library_sections(arguments.plex_base_url, arguments.token)
    GatewayHandler.media_path = arguments.media
    GatewayHandler.catalog_bytes = encode_catalog(server_name, items)
    GatewayHandler.home_catalog_bytes = encode_home_catalog(home_server_name, rows)
    GatewayHandler.bootstrap_catalog_bytes = encode_bootstrap_catalog(
        home_server_name, rows, libraries
    )
    GatewayHandler.artwork_bytes = build_artwork_atlas(arguments.plex_base_url, arguments.token, rows)
    GatewayHandler.plex_base_url = arguments.plex_base_url
    GatewayHandler.plex_token = arguments.token
    GatewayHandler.libraries = {library.section_id: library for library in libraries}
    GatewayHandler.health_bytes = json.dumps(
        {
            "contractVersion": BOOTSTRAP_CATALOG_VERSION,
            "server": server_name,
            "rows": len(rows),
            "items": sum(len(row.items) for row in rows),
            "artworkBytes": len(GatewayHandler.artwork_bytes),
            "libraries": len(libraries),
            "mediaBytes": arguments.media.stat().st_size,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", arguments.port), GatewayHandler)
    print(
        f"Multiplex console gateway v{BOOTSTRAP_CATALOG_VERSION}: "
        f"server={server_name!r} rows={len(rows)} "
        f"items={sum(len(row.items) for row in rows)} "
        f"libraries={len(libraries)} port={arguments.port}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
