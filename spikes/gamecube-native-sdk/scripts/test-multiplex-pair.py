#!/usr/bin/env python3

import json
import pathlib
import stat
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest import mock

import multiplex_pair as pair


class MultiplexPairingClientTest(unittest.TestCase):
    def test_creates_then_polls_a_persistent_device_pairing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            state_path = pathlib.Path(temporary) / "device.json"
            client = pair.MultiplexPairingClient(
                "http://multiplex.test:3000/",
                state_path,
                poll_interval=0,
            )
            responses = [
                self._response(
                    {
                        "deviceId": "123e4567-e89b-42d3-a456-426614174000",
                        "deviceSecret": "device-secret-with-at-least-32-characters",
                        "code": "GCN4",
                        "expiresAt": "2026-07-28T14:05:00.000Z",
                        "linkPath": "/link",
                    }
                ),
                self._response(
                    {
                        "status": "linked",
                        "deviceId": "123e4567-e89b-42d3-a456-426614174000",
                        "credentialExpiresAt": "2026-10-26T14:00:00.000Z",
                    }
                ),
            ]
            with mock.patch.object(
                pair.urllib.request,
                "urlopen",
                side_effect=responses,
            ) as urlopen:
                waiting = client.refresh(force=True)
                linked = client.refresh(force=True)

            self.assertEqual(
                waiting,
                pair.PairingStatus(
                    "waiting",
                    "GCN4",
                    "http://multiplex.test:3000/link",
                    "2026-07-28T14:05:00.000Z",
                ),
            )
            self.assertEqual(linked, pair.PairingStatus("linked"))
            create_request = urlopen.call_args_list[0].args[0]
            self.assertEqual(
                urllib.parse.urlparse(create_request.full_url).path,
                "/api/console/pairings",
            )
            self.assertEqual(
                json.loads(create_request.data),
                {"platform": "gamecube", "name": "Nintendo GameCube"},
            )
            poll_request = urlopen.call_args_list[1].args[0]
            self.assertEqual(
                urllib.parse.urlparse(poll_request.full_url).path,
                "/api/console/pairings/poll",
            )
            self.assertEqual(
                json.loads(poll_request.data)["deviceSecret"],
                "device-secret-with-at-least-32-characters",
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["status"], "linked")
            self.assertNotIn("code", state)
            self.assertEqual(stat.S_IMODE(state_path.stat().st_mode), 0o600)

    def test_replaces_an_expired_pairing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            state_path = pathlib.Path(temporary) / "device.json"
            state_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "baseUrl": "http://multiplex.test:3000",
                        "deviceId": "old-device",
                        "deviceSecret": "old-secret",
                        "code": "OLD4",
                        "linkUrl": "http://multiplex.test:3000/link",
                    }
                ),
                encoding="utf-8",
            )
            client = pair.MultiplexPairingClient(
                "http://multiplex.test:3000",
                state_path,
                poll_interval=0,
            )
            expired = urllib.error.HTTPError(
                "http://multiplex.test:3000/api/console/pairings/poll",
                410,
                "Gone",
                {},
                None,
            )
            with mock.patch.object(
                pair.urllib.request,
                "urlopen",
                side_effect=[
                    expired,
                    self._response(
                        {
                            "deviceId": "new-device",
                            "deviceSecret": "new-secret",
                            "code": "NEW4",
                            "expiresAt": "2026-07-28T14:10:00.000Z",
                            "linkPath": "/link",
                        }
                    ),
                ],
            ):
                result = client.refresh(force=True)

            self.assertEqual(result.status, "waiting")
            self.assertEqual(result.code, "NEW4")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["deviceId"], "new-device")
            self.assertEqual(state["deviceSecret"], "new-secret")

    @staticmethod
    def _response(payload: dict[str, object]) -> mock.MagicMock:
        return mock.MagicMock(
            __enter__=lambda value: value,
            __exit__=mock.Mock(return_value=False),
            read=mock.Mock(return_value=json.dumps(payload).encode("utf-8")),
        )


if __name__ == "__main__":
    unittest.main()
