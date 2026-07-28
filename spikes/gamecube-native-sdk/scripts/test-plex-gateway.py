#!/usr/bin/env python3

import importlib.util
import pathlib
import struct
import sys
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("plex-gateway.py")
SPEC = importlib.util.spec_from_file_location("plex_gateway", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
gateway = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gateway
SPEC.loader.exec_module(gateway)


class CatalogContractTest(unittest.TestCase):
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
        self.assertEqual((rating_key, duration, offset, flags), (42, 120_000, 30_000, 0))
        self.assertEqual(encoded[cursor : cursor + title_length], b"Fresh")

    def test_bounds_items_and_utf8_without_splitting_a_codepoint(self) -> None:
        items = [gateway.CatalogItem(index, 0, 0, "x" * 200 + "é") for index in range(8)]
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
        row_title_length, item_count = struct.unpack(">HH", encoded[cursor : cursor + 4])
        cursor += 4 + row_title_length
        item = struct.unpack(">IIIHBBHH", encoded[cursor : cursor + 20])
        self.assertEqual(item[:6], (99, 200_000, 50_000, 0, 25, 0))
        self.assertEqual(item_count, 1)

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
        self.assertEqual(header[:8], (b"MPXD", 1, 1, 416284, 6_851_264, 50_000, 2022, 82))
        self.assertEqual(header[13], gateway.MAX_DETAIL_SUMMARY_BYTES)

    def test_encodes_playback_manifest(self) -> None:
        manifest = gateway.PlaybackManifest(
            416284,
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
        header = struct.unpack(">4sHHIIIIIIqqH", encoded[:50])
        self.assertEqual(header[:4], (b"MPXP", 1, 1, 416284))
        self.assertEqual(header[4:9], (15_597_568, 13_584_755, 1_920_000, 3596, 5000))
        self.assertEqual(encoded[50:], b"/v1/media/current.mpg")


if __name__ == "__main__":
    unittest.main()
