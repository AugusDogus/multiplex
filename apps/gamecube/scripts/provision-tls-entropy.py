#!/usr/bin/env python3
"""Create a private GameCube GCI containing a host-generated TLS seed."""

from __future__ import annotations

import argparse
import binascii
import os
import secrets
import struct
import time
from pathlib import Path


BLOCK_SIZE = 8192
SEED_SIZE = 32
RECORD_SIZE = 48
GAMECUBE_EPOCH = 946684800


def entropy_record(seed: bytes, generation: int) -> bytes:
    if len(seed) != SEED_SIZE:
        raise ValueError("entropy seed must be exactly 32 bytes")
    record = bytearray(RECORD_SIZE)
    record[0:4] = b"MPXR"
    struct.pack_into(">HHI", record, 4, 1, 12, generation)
    record[12:44] = seed
    struct.pack_into(">I", record, 44, binascii.crc32(record[:44]) & 0xFFFFFFFF)
    return bytes(record)


def gci_file(seed: bytes) -> bytes:
    header = bytearray(b"\xff" * 64)
    header[0:4] = b"MPLX"
    header[4:6] = b"MX"
    header[6] = 0xFF
    header[7] = 0
    filename = b"Multiplex TLS Entropy"
    header[8 : 8 + len(filename)] = filename
    modified = max(0, int(time.time()) - GAMECUBE_EPOCH)
    struct.pack_into(
        ">IIHHBBHH2sI",
        header,
        40,
        modified,
        0xFFFFFFFF,
        0,
        0,
        0x0C,
        0,
        0,
        2,
        b"\xff\xff",
        0xFFFFFFFF,
    )
    first = entropy_record(seed, 1).ljust(BLOCK_SIZE, b"\0")
    second = bytes(BLOCK_SIZE)
    return bytes(header) + first + second


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create a two-block Multiplex TLS entropy save for Dolphin or GCMM"
        )
    )
    parser.add_argument("output", type=Path, help="output .gci path")
    return parser.parse_args()


def main() -> int:
    arguments = parse_args()
    output = arguments.output
    if output.exists():
        raise SystemExit(f"Refusing to replace existing entropy seed: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(gci_file(secrets.token_bytes(SEED_SIZE)))
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    print(f"Created private TLS entropy save at {output}")
    print("Import it into memory card slot A or B, then keep backups private.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
