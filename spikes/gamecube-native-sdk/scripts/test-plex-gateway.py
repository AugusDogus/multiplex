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


if __name__ == "__main__":
    unittest.main()
