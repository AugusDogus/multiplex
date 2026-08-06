#!/usr/bin/env python3

import base64
import importlib.util
import json
import pathlib
import sys
import unittest
import urllib.parse
import urllib.request
from unittest import mock


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
        fragment = urllib.parse.parse_qs(
            urllib.parse.urlparse(url).fragment.removeprefix("?")
        )
        self.assertEqual(fragment["clientID"], [pair.CLIENT_IDENTIFIER])
        self.assertEqual(fragment["code"], ["abc123"])
        self.assertEqual(fragment["context[device][product]"], [pair.PRODUCT])

    def test_pms_auth_url_uses_four_character_link_page(self) -> None:
        url = urllib.parse.urlparse(pair.pms_auth_url("A1B2"))
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "plex.tv")
        self.assertEqual(url.path, "/link/")
        self.assertEqual(urllib.parse.parse_qs(url.query)["pin"], ["A1B2"])

    def test_start_pms_pairing_requests_weak_pin_and_clears_stale_token(self) -> None:
        state = {
            "version": 1,
            "pmsAuthToken": "stale",
            "pmsClaimedAt": 1_600_000_000,
        }
        with mock.patch.object(
            pair, "request_json", return_value={"id": 42, "code": "A1B2"}
        ) as request:
            with mock.patch.object(pair, "load_state", return_value=state):
                with mock.patch.object(pair, "save_state") as save:
                    with mock.patch.object(pathlib.Path, "exists", return_value=True):
                        result = pair.start_pms_pairing(pathlib.Path("auth.json"))

        created_request = request.call_args.args[0]
        parsed = urllib.parse.urlparse(created_request.full_url)
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(created_request.method, "POST")
        self.assertEqual(query["strong"], ["false"])
        self.assertEqual(query["X-Plex-Client-Identifier"], [pair.CLIENT_IDENTIFIER])
        self.assertEqual(result["url"], "https://plex.tv/link/?pin=A1B2")
        saved_state = save.call_args.args[1]
        self.assertNotIn("pmsAuthToken", saved_state)
        self.assertNotIn("pmsClaimedAt", saved_state)

    def test_poll_pms_pairing_sends_code_and_stores_claimed_token(self) -> None:
        state = {"pmsPinId": 42, "pmsCode": "A1B2"}
        with mock.patch.object(pair, "load_state", return_value=state):
            with mock.patch.object(
                pair, "request_json", return_value={"authToken": "claimed"}
            ) as request:
                with mock.patch.object(pair, "save_state") as save:
                    result = pair.poll_pms_pairing(pathlib.Path("auth.json"))

        parsed = urllib.parse.urlparse(request.call_args.args[0].full_url)
        self.assertEqual(parsed.path, "/api/v2/pins/42")
        self.assertEqual(urllib.parse.parse_qs(parsed.query)["code"], ["A1B2"])
        self.assertEqual(result, {"status": "claimed"})
        self.assertEqual(save.call_args.args[1]["pmsAuthToken"], "claimed")

    def test_signed_refresh_jwt_carries_nonce(self) -> None:
        private_key, jwk = pair.device_key()
        state = {
            "privateKey": pair.private_key_bytes(private_key),
            "kid": jwk["kid"],
        }
        token = pair.signed_device_jwt(
            state,
            now=1_700_000_000,
            nonce="once",
            scopes=pair.DEVICE_SCOPES,
        )
        payload_part = token.split(".")[1]
        raw = base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4))
        payload = json.loads(raw)
        self.assertEqual(payload["nonce"], "once")
        self.assertEqual(payload["scope"], ",".join(pair.DEVICE_SCOPES))

    def test_token_expiry_validates_plex_identity(self) -> None:
        payload = {
            "iss": "plex.tv",
            "aud": ["plex.tv", pair.CLIENT_IDENTIFIER],
            "exp": 1_700_604_800,
        }
        encoded = pair.base64url(json.dumps(payload).encode("utf-8"))
        self.assertEqual(pair.token_expiry(f"x.{encoded}.x"), 1_700_604_800)

    def test_ensure_keeps_token_outside_refresh_window(self) -> None:
        token = self._token(expiry=1_700_604_800)
        with mock.patch.object(pair, "load_state", return_value={"authToken": token}):
            with mock.patch.object(pair, "refresh_pairing") as refresh:
                self.assertEqual(
                    pair.ensure_token(pathlib.Path("auth.json"), 1_700_000_000), token
                )
        refresh.assert_not_called()

    def test_ensure_refreshes_expiring_token(self) -> None:
        old_token = self._token(expiry=1_700_000_001)
        new_token = self._token(expiry=1_700_604_800)
        with mock.patch.object(
            pair, "load_state", return_value={"authToken": old_token}
        ):
            with mock.patch.object(
                pair,
                "refresh_pairing",
                return_value={"authToken": new_token},
            ) as refresh:
                self.assertEqual(
                    pair.ensure_token(pathlib.Path("auth.json"), 1_700_000_000),
                    new_token,
                )
        refresh.assert_called_once_with(pathlib.Path("auth.json"), now=1_700_000_000)

    def test_server_token_matches_local_machine_identifier(self) -> None:
        responses = [
            mock.MagicMock(
                __enter__=lambda value: value,
                __exit__=mock.Mock(return_value=False),
                read=mock.Mock(
                    return_value=b'<MediaContainer machineIdentifier="server-id"/>'
                ),
            ),
            mock.MagicMock(
                __enter__=lambda value: value,
                __exit__=mock.Mock(return_value=False),
                read=mock.Mock(return_value=b"<"),
            ),
        ]
        with mock.patch.object(
            pair,
            "load_state",
            return_value={"pmsAuthToken": "legacy-account-secret"},
        ):
            with mock.patch.object(
                urllib.request,
                "urlopen",
                side_effect=responses,
            ):
                token = pair.server_token(
                    pathlib.Path("auth.json"),
                    "http://plex:32400",
                    now=1_700_000_000,
                )
        self.assertEqual(token, "legacy-account-secret")

    def test_server_token_rejects_current_jwt_resource_response(self) -> None:
        resources = [
            {
                "clientIdentifier": "server-id",
                "accessToken": "header.payload.signature",
            },
        ]
        responses = [
            mock.MagicMock(
                __enter__=lambda value: value,
                __exit__=mock.Mock(return_value=False),
                read=mock.Mock(
                    return_value=b'<MediaContainer machineIdentifier="server-id"/>'
                ),
            ),
            mock.MagicMock(
                __enter__=lambda value: value,
                __exit__=mock.Mock(return_value=False),
                read=mock.Mock(return_value=json.dumps(resources).encode("utf-8")),
            ),
        ]
        with mock.patch.object(pair, "load_state", return_value={"authToken": "jwt"}):
            with mock.patch.object(pair, "ensure_token", return_value="account-jwt"):
                with mock.patch.object(
                    urllib.request,
                    "urlopen",
                    side_effect=responses,
                ):
                    with self.assertRaisesRegex(
                        RuntimeError,
                        "account JWT instead of a PMS access token",
                    ):
                        pair.server_token(
                            pathlib.Path("auth.json"),
                            "http://plex:32400",
                            now=1_700_000_000,
                        )

    @staticmethod
    def _token(expiry: int) -> str:
        payload = {
            "iss": "plex.tv",
            "aud": ["plex.tv", pair.CLIENT_IDENTIFIER],
            "exp": expiry,
        }
        return f"x.{pair.base64url(json.dumps(payload).encode('utf-8'))}.x"


if __name__ == "__main__":
    unittest.main()
