import unittest
from pathlib import Path
import tempfile

from gecko import (
    pad_command,
    parse_capture_chunk,
    parse_capture_header,
    yuyv_to_rgb,
    screenshot,
)


class GeckoTests(unittest.TestCase):
    def test_controller_encoding_and_bounds(self):
        self.assertEqual(
            pad_command("A,B", -128, 127, 100), "MULTIPLEX:PAD 0300 80 7f 064"
        )
        self.assertEqual(pad_command("", 0, 0, 0), "MULTIPLEX:PAD 0000 00 00 000")
        for values in [("INVALID", 0, 0, 10), ("", 128, 0, 10), ("", 0, 0, 4096)]:
            with self.assertRaises(ValueError):
                pad_command(*values)

    def test_header_rejects_unbounded_or_inconsistent_capture(self):
        self.assertEqual(
            parse_capture_header("MULTIPLEX:SHOT 640 480 1280 614400 12345678"),
            (640, 480, 1280, 614400, 0x12345678),
        )
        for line in [
            "MULTIPLEX:SHOT 640 480 1280 1 0",
            "MULTIPLEX:SHOT 100000 100000 200000 20000000000 0",
            "MULTIPLEX:SHOT 641 480 1312 629760 0",
            "MULTIPLEX:SHOT 640 480 1280 614400 -1",
        ]:
            with self.assertRaises(ValueError):
                parse_capture_header(line)

    def test_chunks_validate_offset_and_size(self):
        self.assertEqual(
            parse_capture_chunk("MULTIPLEX:DATA 00000200 1080", 512, 2), b"\x10\x80"
        )
        with self.assertRaises(ValueError):
            parse_capture_chunk("MULTIPLEX:DATA 00000000 1080", 512, 2)
        with self.assertRaises(ValueError):
            parse_capture_chunk("MULTIPLEX:DATA 00000200 10", 512, 2)

    def test_interrupted_chunk_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_capture_chunk(
                "MULTIPLEX:DATA 00000000 1080REFERENCE GX: presentation=120",
                0,
                2,
            )

    def test_yuyv_black_white_and_padding(self):
        pixels = bytes([16, 128, 235, 128]) + bytes(28)
        self.assertEqual(yuyv_to_rgb(pixels, 2, 1, 32), bytes([0, 0, 0, 255, 255, 255]))

    def test_corrupt_capture_does_not_save_a_png(self):
        class CorruptGecko:
            def send(self, command):
                pass

            def read(self, prefix):
                if prefix == b"MULTIPLEX:SHOT ":
                    return "MULTIPLEX:SHOT 2 1 32 32 00000000"
                return "MULTIPLEX:DATA 00000000 " + "00" * 32

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "capture.png"
            with self.assertRaisesRegex(ValueError, "checksum failed"):
                screenshot(CorruptGecko(), output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
