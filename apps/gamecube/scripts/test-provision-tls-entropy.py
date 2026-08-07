#!/usr/bin/env python3

from __future__ import annotations

import binascii
import importlib.util
import stat
import struct
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("provision-tls-entropy.py")
SPEC = importlib.util.spec_from_file_location("provision_tls_entropy", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load entropy provisioning script")
provision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provision)


class ProvisionTlsEntropyTest(unittest.TestCase):
    def test_gci_has_bounded_journal_and_valid_seed_record(self) -> None:
        seed = bytes(range(32))
        gci = provision.gci_file(seed)
        self.assertEqual(len(gci), 64 + 2 * provision.BLOCK_SIZE)
        self.assertEqual(gci[0:6], b"MPLXMX")
        self.assertEqual(gci[8:29], b"Multiplex TLS Entropy")
        self.assertEqual(gci[29:40], bytes(11))
        self.assertEqual(struct.unpack_from(">H", gci, 56)[0], 2)
        record = gci[64 : 64 + provision.RECORD_SIZE]
        self.assertEqual(record[0:4], b"MPXR")
        self.assertEqual(record[12:44], seed)
        self.assertEqual(
            struct.unpack_from(">I", record, 44)[0],
            binascii.crc32(record[:44]) & 0xFFFFFFFF,
        )
        self.assertEqual(
            gci[64 + provision.BLOCK_SIZE :], bytes(provision.BLOCK_SIZE)
        )

    def test_output_is_private_and_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "entropy.gci"
            descriptor = provision.os.open(
                path,
                provision.os.O_WRONLY
                | provision.os.O_CREAT
                | provision.os.O_EXCL,
                0o600,
            )
            with provision.os.fdopen(descriptor, "wb") as file:
                file.write(provision.gci_file(bytes(32)))
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                provision.os.open(
                    path,
                    provision.os.O_WRONLY
                    | provision.os.O_CREAT
                    | provision.os.O_EXCL,
                    0o600,
                )

    def test_inspection_tracks_generations_and_corruption_preserves_seeds(
        self,
    ) -> None:
        gci = provision.gci_file(bytes(range(32)))
        self.assertEqual(provision.valid_generations(gci), (1,))
        corrupted = provision.corrupt_records(gci)
        self.assertEqual(provision.valid_generations(corrupted), ())
        for index in range(2):
            seed_start = 64 + index * provision.BLOCK_SIZE + 12
            seed_end = seed_start + provision.SEED_SIZE
            self.assertEqual(corrupted[seed_start:seed_end], gci[seed_start:seed_end])


if __name__ == "__main__":
    unittest.main()
