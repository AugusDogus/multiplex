#!/usr/bin/env python3
"""Control a Multiplex development DOL over USB Gecko (Linux/POSIX)."""

import argparse
import fcntl
import os
from pathlib import Path
import select
import sys
import termios
import time
import tty
import zlib

BUTTONS = {
    "LEFT": 0x0001,
    "RIGHT": 0x0002,
    "DOWN": 0x0004,
    "UP": 0x0008,
    "Z": 0x0010,
    "R": 0x0020,
    "L": 0x0040,
    "A": 0x0100,
    "B": 0x0200,
    "X": 0x0400,
    "Y": 0x0800,
    "START": 0x1000,
}
CHUNK_SIZE = 2048


class Gecko:
    def __init__(self, device):
        self.device = device
        self.fd = None
        self.pending = bytearray()

    def __enter__(self):
        self.fd = os.open(self.device, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self.original = termios.tcgetattr(self.fd)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            tty.setraw(self.fd)
            settings = termios.tcgetattr(self.fd)
            settings[2] |= termios.CLOCAL | termios.CREAD
            settings[2] &= ~termios.CRTSCTS
            settings[4] = settings[5] = termios.B115200
            termios.tcsetattr(self.fd, termios.TCSANOW, settings)
            termios.tcflush(self.fd, termios.TCIFLUSH)
            self.send("")  # Discard a partial command from an interrupted session.
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *_):
        if self.fd is not None:
            try:
                termios.tcsetattr(self.fd, termios.TCSANOW, self.original)
            finally:
                os.close(self.fd)
                self.fd = None

    def send(self, command):
        data = (command + "\n").encode("ascii")
        deadline = time.monotonic() + 5
        while data:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [self.fd], [], remaining)[1]:
                raise TimeoutError("USB Gecko did not accept the command.")
            count = os.write(self.fd, data)
            data = data[count:]

    def read(self, prefix, timeout=10):
        deadline = time.monotonic() + timeout
        while True:
            while b"\n" in self.pending:
                line, _, rest = self.pending.partition(b"\n")
                self.pending = bytearray(rest)
                if line.startswith(b"MULTIPLEX:ERROR "):
                    raise RuntimeError(line.decode("ascii", errors="replace"))
                if line.startswith(prefix):
                    return line.decode("ascii")
            if len(self.pending) > 16384:
                raise RuntimeError(
                    "USB Gecko returned an overlong line; transfer stopped."
                )
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.fd], [], [], remaining)[0]:
                raise TimeoutError(
                    "No development response. Check the DOL was built with "
                    "MULTIPLEX_DEVELOPMENT=1, Swiss debug is enabled, and other "
                    "serial readers are stopped."
                )
            data = os.read(self.fd, 8192)
            if not data:
                raise ConnectionError("USB Gecko disconnected.")
            self.pending.extend(data)


def parse_capture_header(line):
    fields = line.split()
    if len(fields) != 6 or fields[0] != "MULTIPLEX:SHOT":
        raise ValueError("Malformed screenshot header.")
    width, height, stride, size = map(int, fields[1:5])
    checksum = int(fields[5], 16)
    if (
        not 2 <= width <= 720
        or width % 2
        or not 1 <= height <= 576
        or stride != ((width + 15) & ~15) * 2
        or size != stride * height
        or not 0 <= checksum <= 0xFFFFFFFF
    ):
        raise ValueError("Invalid screenshot dimensions or checksum.")
    return width, height, stride, size, checksum


def parse_capture_chunk(line, offset, expected_size):
    fields = line.split()
    if len(fields) != 3 or fields[0] != "MULTIPLEX:DATA":
        raise ValueError("Malformed screenshot chunk.")
    if int(fields[1], 16) != offset:
        raise ValueError("Screenshot chunk arrived at the wrong offset.")
    pixels = bytes.fromhex(fields[2])
    if len(pixels) != expected_size:
        raise ValueError("Incomplete screenshot chunk.")
    return pixels


def yuyv_to_rgb(pixels, width, height, stride):
    if len(pixels) != stride * height:
        raise ValueError("Screenshot pixels do not match the declared dimensions.")
    rgb = bytearray(width * height * 3)
    output = 0
    for row in range(height):
        for column in range(0, width * 2, 4):
            offset = row * stride + column
            y0, u, y1, v = pixels[offset : offset + 4]
            d, e = u - 128, v - 128
            for y in (y0, y1):
                c = 298 * (y - 16)
                for value in (c + 409 * e, c - 100 * d - 208 * e, c + 516 * d):
                    rgb[output] = max(0, min(255, (value + 128) >> 8))
                    output += 1
    return bytes(rgb)


def screenshot(gecko, output):
    from PIL import Image

    if output.exists():
        raise FileExistsError(f"{output} already exists; choose a new screenshot path.")
    gecko.send("MULTIPLEX:SHOT")
    width, height, stride, size, checksum = parse_capture_header(
        gecko.read(b"MULTIPLEX:SHOT ")
    )
    pixels = bytearray()
    for offset in range(0, size, CHUNK_SIZE):
        gecko.send(f"MULTIPLEX:READ {offset:08x}")
        pixels.extend(
            parse_capture_chunk(
                gecko.read(b"MULTIPLEX:DATA "), offset, min(CHUNK_SIZE, size - offset)
            )
        )
    if zlib.adler32(pixels) != checksum:
        raise ValueError(
            "Screenshot checksum failed; no image was saved. Retry capture."
        )
    image = Image.frombytes(
        "RGB", (width, height), yuyv_to_rgb(pixels, width, height, stride)
    )
    with output.open("xb") as stream:
        image.save(stream, format="PNG")
    print(f"Saved {width}x{height} screenshot to {output}")


def pad_command(buttons, x, y, duration):
    if not -128 <= x <= 127 or not -128 <= y <= 127 or not 0 <= duration <= 4095:
        raise ValueError("Stick values must be -128..127; duration must be 0..4095 ms.")
    mask = 0
    for name in filter(None, buttons.upper().split(",")):
        if name not in BUTTONS:
            raise ValueError(f"Unknown button {name!r}. Use {', '.join(BUTTONS)}.")
        mask |= BUTTONS[name]
    return f"MULTIPLEX:PAD {mask:04x} {x & 255:02x} {y & 255:02x} {duration:03x}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default=os.environ.get("WIILOAD", "/dev/ttyUSB0"))
    commands = parser.add_subparsers(dest="command", required=True)
    shot = commands.add_parser("screenshot")
    shot.add_argument("output", type=Path)
    pad = commands.add_parser("pad")
    pad.add_argument("--buttons", default="")
    pad.add_argument("--x", type=int, default=0)
    pad.add_argument("--y", type=int, default=0)
    pad.add_argument("--ms", type=int, default=100)
    commands.add_parser("release")
    commands.add_parser("exit")
    args = parser.parse_args()
    try:
        command = (
            pad_command(args.buttons, args.x, args.y, args.ms)
            if args.command == "pad"
            else None
        )
        with Gecko(args.device) as gecko:
            if args.command == "screenshot":
                screenshot(gecko, args.output)
            elif args.command == "exit":
                gecko.send("MULTIPLEX:EXIT")
                gecko.read(b"REFERENCE GX: remote exit accepted")
                print("Remote exit accepted; wait for Swiss before uploading.")
            elif args.command == "release":
                gecko.send(pad_command("", 0, 0, 0))
                gecko.read(b"MULTIPLEX:PAD OK")
                print("Remote controller released.")
            else:
                gecko.send(command)
                try:
                    gecko.read(b"MULTIPLEX:PAD OK")
                    time.sleep(args.ms / 1000 + 0.05)
                finally:
                    gecko.send(pad_command("", 0, 0, 0))
                    gecko.read(b"MULTIPLEX:PAD OK")
                print("Controller input completed and released.")
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Gecko: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
