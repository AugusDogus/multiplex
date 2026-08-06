#!/usr/bin/env python3

"""Persistent Multiplex device pairing for console gateways."""

from __future__ import annotations

import json
import os
import pathlib
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


PAIRING_POLL_INTERVAL_SECONDS = 1.0


@dataclass(frozen=True)
class PairingStatus:
    status: str
    code: str = ""
    link_url: str = ""
    expires_at: str = ""
    plex_linked: bool = False


@dataclass(frozen=True)
class ConsolePlexServer:
    server_id: str
    name: str
    owned: bool
    presence: bool
    relay: bool


class MultiplexPairingClient:
    def __init__(
        self,
        base_url: str,
        state_path: pathlib.Path,
        poll_interval: float = PAIRING_POLL_INTERVAL_SECONDS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.state_path = state_path
        self.poll_interval = poll_interval
        self._lock = threading.Lock()
        self._last_poll = 0.0
        self._cached = PairingStatus("unavailable")

    def refresh(self, force: bool = False) -> PairingStatus:
        with self._lock:
            current = time.monotonic()
            if not force and current - self._last_poll < self.poll_interval:
                return self._cached
            self._last_poll = current
            try:
                self._cached = self._refresh()
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                self._cached = PairingStatus(
                    "unavailable",
                    self._cached.code,
                    self._cached.link_url,
                    self._cached.expires_at,
                )
            return self._cached

    def load_plex_servers(self) -> list[ConsolePlexServer]:
        with self._lock:
            state = self._load_state()
            if state is None or state.get("status") != "linked":
                return []
            device_id = _required_string(state, "deviceId")
            device_secret = _required_string(state, "deviceSecret")
            request = urllib.request.Request(
                self._url("/api/console/plex/servers"),
                method="GET",
                headers={
                    "Accept": "application/json",
                    "Authorization": (f"MultiplexDevice {device_id}:{device_secret}"),
                },
            )
            response = _request_json(request)
            if response.get("apiVersion") != 1 or response.get("status") != "ready":
                raise ValueError("Multiplex returned an invalid Plex server response")
            values = response.get("servers")
            if not isinstance(values, list):
                raise ValueError("Multiplex Plex server response is incomplete")
            servers: list[ConsolePlexServer] = []
            for value in values:
                if not isinstance(value, dict):
                    raise ValueError("Multiplex returned an invalid Plex server")
                servers.append(
                    ConsolePlexServer(
                        _required_string(value, "id"),
                        _required_string(value, "name"),
                        _required_bool(value, "owned"),
                        _required_bool(value, "presence"),
                        _required_bool(value, "relay"),
                    )
                )
            return servers

    def _refresh(self) -> PairingStatus:
        state = self._load_state()
        if state is None:
            return self._create()
        if state.get("status") == "linked":
            try:
                return self._bootstrap(state)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    return self._create()
                raise

        request = urllib.request.Request(
            self._url("/api/console/pairings/poll"),
            method="POST",
            data=json.dumps(
                {
                    "deviceId": state["deviceId"],
                    "deviceSecret": state["deviceSecret"],
                },
                separators=(",", ":"),
            ).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            response = _request_json(request)
        except urllib.error.HTTPError as error:
            if error.code in {401, 410}:
                return self._create()
            raise

        status = response.get("status")
        if status == "linked":
            state["status"] = "linked"
            state["credentialExpiresAt"] = _required_string(
                response, "credentialExpiresAt"
            )
            state.pop("code", None)
            state.pop("expiresAt", None)
            self._save_state(state)
            return self._bootstrap(state)
        if status == "waiting":
            expires_at = _required_string(response, "expiresAt")
            state["status"] = "waiting"
            state["expiresAt"] = expires_at
            self._save_state(state)
            return PairingStatus(
                "waiting",
                _required_string(state, "code"),
                _required_string(state, "linkUrl"),
                expires_at,
            )
        if status == "expired":
            return self._create()
        raise ValueError("Multiplex returned an unknown pairing status")

    def _bootstrap(self, state: dict[str, object]) -> PairingStatus:
        device_id = _required_string(state, "deviceId")
        device_secret = _required_string(state, "deviceSecret")
        request = urllib.request.Request(
            self._url("/api/console/bootstrap"),
            method="GET",
            headers={
                "Accept": "application/json",
                "Authorization": (f"MultiplexDevice {device_id}:{device_secret}"),
            },
        )
        response = _request_json(request)
        if response.get("apiVersion") != 1 or response.get("status") != "ready":
            raise ValueError("Multiplex returned an invalid console bootstrap")
        device = response.get("device")
        account = response.get("account")
        if not isinstance(device, dict) or not isinstance(account, dict):
            raise ValueError("Multiplex console bootstrap is incomplete")
        if _required_string(device, "id") != device_id:
            raise ValueError("Multiplex console bootstrap changed device identity")
        credential_expires_at = _required_string(device, "credentialExpiresAt")
        plex_linked = _required_bool(account, "plexLinked")
        state["credentialExpiresAt"] = credential_expires_at
        state["plexLinked"] = plex_linked
        self._save_state(state)
        return PairingStatus("linked", plex_linked=plex_linked)

    def _create(self) -> PairingStatus:
        request = urllib.request.Request(
            self._url("/api/console/pairings"),
            method="POST",
            data=b'{"platform":"gamecube","name":"Nintendo GameCube"}',
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        response = _request_json(request)
        device_id = _required_string(response, "deviceId")
        device_secret = _required_string(response, "deviceSecret")
        code = _required_string(response, "code")
        expires_at = _required_string(response, "expiresAt")
        link_path = _required_string(response, "linkPath")
        if len(code) != 4:
            raise ValueError("Multiplex returned an invalid pairing code")
        link_url = self._url(link_path)
        self._save_state(
            {
                "version": 1,
                "baseUrl": self.base_url,
                "deviceId": device_id,
                "deviceSecret": device_secret,
                "status": "waiting",
                "code": code,
                "linkUrl": link_url,
                "expiresAt": expires_at,
            }
        )
        return PairingStatus("waiting", code, link_url, expires_at)

    def _load_state(self) -> dict[str, object] | None:
        if not self.state_path.is_file():
            return None
        value = json.loads(self.state_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return None
        if value.get("version") != 1 or value.get("baseUrl") != self.base_url:
            return None
        _required_string(value, "deviceId")
        _required_string(value, "deviceSecret")
        return value

    def _save_state(self, state: dict[str, object]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(state, separators=(",", ":")),
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(self.state_path)

    def _url(self, path: str) -> str:
        normalized = path if path.startswith("/") else f"/{path}"
        return urllib.parse.urljoin(f"{self.base_url}/", normalized.lstrip("/"))


def _request_json(request: urllib.request.Request) -> dict[str, object]:
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise ValueError("Multiplex returned a non-object pairing response")
    return value


def _required_string(value: dict[str, object], key: str) -> str:
    field = value.get(key)
    if not isinstance(field, str) or not field:
        raise ValueError(f"Multiplex pairing response is missing {key}")
    return field


def _required_bool(value: dict[str, object], key: str) -> bool:
    field = value.get(key)
    if not isinstance(field, bool):
        raise ValueError(f"Multiplex pairing response is missing {key}")
    return field
