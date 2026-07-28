#!/usr/bin/env python3

import base64
import importlib.util
import json
import pathlib
import sys
import unittest
import urllib.parse


MODULE_PATH = pathlib.Path(__file__).with_name("plex-pair.py")
SPEC = importlib.util.spec_from_file_location("plex_pair", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
pair = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pair
SPEC.loader.exec_module(pair)


class PlexPairTest(unittest.TestCase):
    def test_device_jwt_is_signed_with_expected_identity(self) -> None:
        private_key, jwk = pair.device_key()
        state = {
            "privateKey": pair.private_key_bytes(private_key),
            "kid": jwk["kid"],
        }
        token = pair.signed_device_jwt(state, now=1_700_000_000)
        header_part, payload_part, signature_part = token.split(".")

        def decode(value: str) -> dict[str, object]:
            raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            return json.loads(raw)

        self.assertEqual(decode(header_part)["kid"], jwk["kid"])
        self.assertEqual(decode(payload_part)["aud"], "plex.tv")
        self.assertEqual(decode(payload_part)["iss"], pair.CLIENT_IDENTIFIER)
        self.assertEqual(decode(payload_part)["exp"], 1_700_000_300)
        private_key.public_key().verify(
            pair.decode_base64url(signature_part),
            f"{header_part}.{payload_part}".encode("ascii"),
        )

    def test_auth_url_carries_pin_and_device_product(self) -> None:
        url = pair.auth_url("abc123")
        fragment = urllib.parse.parse_qs(urllib.parse.urlparse(url).fragment.removeprefix("?"))
        self.assertEqual(fragment["clientID"], [pair.CLIENT_IDENTIFIER])
        self.assertEqual(fragment["code"], ["abc123"])
        self.assertEqual(fragment["context[device][product]"], [pair.PRODUCT])


if __name__ == "__main__":
    unittest.main()
