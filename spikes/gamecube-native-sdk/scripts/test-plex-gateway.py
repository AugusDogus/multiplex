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


if __name__ == "__main__":
    unittest.main()
