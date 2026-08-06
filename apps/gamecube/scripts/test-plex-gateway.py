#!/usr/bin/env python3

import importlib.util
import pathlib
import struct
import sys
import unittest
import urllib.parse
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("plex-gateway.py")
SPEC = importlib.util.spec_from_file_location("plex_gateway", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
gateway = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gateway
SPEC.loader.exec_module(gateway)


class CatalogContractTest(unittest.TestCase):
    def test_encodes_versioned_pairing_status(self) -> None:
        encoded = gateway.encode_pairing_status(
            gateway.PairingStatus(
                "waiting",
                "GCN4",
                "https://multiplex.example/link",
                "2026-07-28T14:05:00.000Z",
            )
        )
        magic, version, state, code_length, url_length = struct.unpack(
            ">4sHHHH", encoded[:12]
        )
        self.assertEqual((magic, version, state), (b"MPXL", 1, 1))
        self.assertEqual(encoded[12 : 12 + code_length], b"GCN4")
        self.assertEqual(
            encoded[12 + code_length : 12 + code_length + url_length],
            b"https://multiplex.example/link",
        )

    def test_rejects_incomplete_waiting_pairing_status(self) -> None:
        encoded = gateway.encode_pairing_status(
            gateway.PairingStatus("waiting", "GCN4")
        )
        self.assertEqual(
            struct.unpack(">4sHHHH", encoded),
            (b"MPXL", 1, 3, 0, 0),
        )

    def test_reports_web_parity_timeline_contract(self) -> None:
        with mock.patch.object(gateway.urllib.request, "urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b""
            gateway.report_timeline(
                "http://plex.test:32400",
                "secret",
                "gamecube-session",
                42,
                31_000,
                120_000,
                "playing",
            )

        request = urlopen.call_args.args[0]
        query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
        self.assertEqual(query["ratingKey"], ["42"])
        self.assertEqual(query["key"], ["/library/metadata/42"])
        self.assertEqual(query["playbackTime"], ["31000"])
        self.assertEqual(query["time"], ["31000"])
        self.assertEqual(query["duration"], ["120000"])
        self.assertEqual(query["state"], ["playing"])
        self.assertEqual(query["X-Plex-Playback-Session-Id"], ["gamecube-session"])
        self.assertEqual(query["X-Plex-Token"], ["secret"])

    def test_encodes_versioned_big_endian_catalog(self) -> None:
        encoded = gateway.encode_catalog(
            "Living Room",
            [gateway.CatalogItem(42, 120_000, 30_000, "Fresh")],
        )
        magic, version, count, server_length, reserved = struct.unpack(
            ">4sHHHH", encoded[:12]
        )
        self.assertEqual((magic, version, count, reserved), (b"MPXG", 1, 1, 0))
        cursor = 12
        self.assertEqual(encoded[cursor : cursor + server_length], b"Living Room")
        cursor += server_length
        rating_key, duration, offset, title_length, flags = struct.unpack(
            ">IIIHH", encoded[cursor : cursor + 16]
        )
        cursor += 16
        self.assertEqual(
            (rating_key, duration, offset, flags), (42, 120_000, 30_000, 0)
        )
        self.assertEqual(encoded[cursor : cursor + title_length], b"Fresh")

    def test_bounds_items_and_utf8_without_splitting_a_codepoint(self) -> None:
        items = [
            gateway.CatalogItem(index, 0, 0, "x" * 200 + "é") for index in range(8)
        ]
        encoded = gateway.encode_catalog("é" * 100, items)
        _, _, count, server_length, _ = struct.unpack(">4sHHHH", encoded[:12])
        self.assertEqual(count, gateway.MAX_ITEMS)
        self.assertLessEqual(server_length, gateway.MAX_SERVER_NAME_BYTES)
        encoded[12 : 12 + server_length].decode("utf-8")

    def test_encodes_home_rows_with_progress_and_artwork_slots(self) -> None:
        rows = [
            gateway.HomeRow(
                "Continue Watching",
                [
                    gateway.HomeItem(
                        99,
                        200_000,
                        50_000,
                        "A Show",
                        "Pilot · S01 E01",
                        "/poster.jpg",
                    )
                ],
            )
        ]
        encoded = gateway.encode_home_catalog("Plex", rows)
        magic, version, row_count, server_length, _ = struct.unpack(
            ">4sHHHH", encoded[:12]
        )
        self.assertEqual((magic, version, row_count), (b"MPXG", 2, 1))
        cursor = 12 + server_length
        row_title_length, item_count = struct.unpack(
            ">HH", encoded[cursor : cursor + 4]
        )
        cursor += 4 + row_title_length
        item = struct.unpack(">IIIHBBHH", encoded[cursor : cursor + 20])
        self.assertEqual(item[:6], (99, 200_000, 50_000, 0, 25, 0))
        self.assertEqual(item_count, 1)

    def test_home_shelves_allow_eight_items_without_expanding_pages(self) -> None:
        items = [
            gateway.HomeItem(index + 1, 1000, 0, f"Item {index}", "2026", None)
            for index in range(10)
        ]
        encoded = gateway.encode_home_catalog(
            "Plex", [gateway.HomeRow("Recently Added", items)]
        )
        _, _, _, server_length, _ = struct.unpack(">4sHHHH", encoded[:12])
        _, item_count = struct.unpack(
            ">HH", encoded[12 + server_length : 16 + server_length]
        )

        self.assertEqual(item_count, gateway.MAX_HOME_ITEMS)
        self.assertEqual(gateway.MAX_ITEMS, 4)
        self.assertEqual(gateway.MAX_BROWSE_ITEMS, 21)

    def test_encodes_v3_bootstrap_libraries(self) -> None:
        rows = [
            gateway.HomeRow(
                "Recently Added",
                [gateway.HomeItem(7, 1000, 0, "Movie", "2026", "/thumb.jpg")],
            )
        ]
        libraries = [gateway.LibrarySection(1, "Movies", "movie")]
        encoded = gateway.encode_bootstrap_catalog("Plex", rows, libraries)
        magic, version, row_count, server_length, library_count = struct.unpack(
            ">4sHHHH", encoded[:12]
        )
        self.assertEqual((magic, version, row_count, library_count), (b"MPXG", 3, 1, 1))
        self.assertEqual(encoded[-12:], struct.pack(">HBBH", 1, 1, 0, 6) + b"Movies")
        self.assertEqual(encoded[12 : 12 + server_length], b"Plex")

    def test_encodes_browse_page_bounds(self) -> None:
        section = gateway.LibrarySection(4, "Anime", "show")
        page = gateway.BrowsePage(
            section,
            4,
            50,
            [gateway.HomeItem(99, 200_000, 50_000, "A Show", "2026", None)],
        )
        encoded = gateway.encode_browse_page(page)
        header = struct.unpack(">4sHHHHHH", encoded[:16])
        self.assertEqual(header, (b"MPXB", 1, 4, 1, 4, 50, 5))

    def test_browse_window_contains_three_seven_item_rows(self) -> None:
        section = gateway.LibrarySection(4, "Anime", "show")
        items = [
            gateway.HomeItem(index + 1, 0, 0, f"Show {index}", "2026", None)
            for index in range(30)
        ]
        encoded = gateway.encode_browse_page(
            gateway.BrowsePage(section, 0, len(items), items)
        )

        _, _, _, item_count, _, _, _ = struct.unpack(">4sHHHHHH", encoded[:16])
        self.assertEqual(item_count, gateway.MAX_BROWSE_ITEMS)
        self.assertEqual(item_count, gateway.BROWSE_COLUMNS * 3)

    def test_encodes_search_page_with_shared_item_records(self) -> None:
        page = gateway.SearchPage(
            "Fresh",
            [gateway.HomeItem(416284, 6_851_264, 0, "Fresh", "2022", None)],
        )
        encoded = gateway.encode_search_page(page)
        header = struct.unpack(">4sHHH", encoded[:10])
        self.assertEqual(header, (b"MPXS", 1, 1, 5))
        self.assertEqual(encoded[10:15], b"Fresh")

    def test_encodes_bounded_item_details(self) -> None:
        page = gateway.DetailsPage(
            416284,
            6_851_264,
            50_000,
            2022,
            82,
            True,
            "Fresh",
            "It's not for everyone.",
            "Movie",
            "Movies",
            "R",
            "A" * 500,
            "Thriller · Horror · Comedy",
            "Directed by Mimi Cave",
        )
        encoded = gateway.encode_details_page(page)
        header = struct.unpack(">4sHHIIIHHHHHHHHHH", encoded[:40])
        self.assertEqual(
            header[:8], (b"MPXD", 1, 1, 416284, 6_851_264, 50_000, 2022, 82)
        )
        self.assertEqual(header[13], gateway.MAX_DETAIL_SUMMARY_BYTES)

    def test_encodes_playback_manifest(self) -> None:
        manifest = gateway.PlaybackManifest(
            416284,
            6_851_264,
            60_000,
            120_000,
            15_597_568,
            13_584_755,
            1_920_000,
            3596,
            5000,
            48003,
            47101,
            "/v1/media/current.mpg",
        )
        encoded = gateway.encode_playback_manifest(manifest)
        header = struct.unpack(">4sHHIIIIIIIIIqqH", encoded[:62])
        self.assertEqual(header[:4], (b"MPXP", 2, 1, 416284))
        self.assertEqual(header[4:7], (6_851_264, 60_000, 120_000))
        self.assertEqual(header[7:12], (15_597_568, 13_584_755, 1_920_000, 3596, 5000))
        self.assertEqual(encoded[62:], b"/v1/media/current.mpg")

    def test_finds_following_playback_segment(self) -> None:
        manifest = gateway.PlaybackManifest(
            42,
            6_851_264,
            60_000,
            120_000,
            1_000_000,
            800_000,
            150_000,
            3600,
            4600,
            45_000,
            43_200,
            "/v4/media/42/60000.mpg",
        )
        encoded = gateway.encode_playback_manifest(manifest)
        self.assertEqual(
            gateway.GatewayHandler._next_playback_segment(encoded),
            (42, 180_000),
        )

    def test_does_not_prefetch_past_media_end(self) -> None:
        manifest = gateway.PlaybackManifest(
            42,
            170_000,
            60_000,
            120_000,
            1_000_000,
            800_000,
            150_000,
            3600,
            4600,
            45_000,
            43_200,
            "/v4/media/42/60000.mpg",
        )
        encoded = gateway.encode_playback_manifest(manifest)
        self.assertIsNone(gateway.GatewayHandler._next_playback_segment(encoded))


if __name__ == "__main__":
    unittest.main()
