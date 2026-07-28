#!/usr/bin/env python3

"""Create and claim Plex's device-key PIN flow for the console gateway."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


CLIENT_IDENTIFIER = "multiplex-gamecube"
PRODUCT = "Multiplex GameCube"
PINS_URL = "https://clients.plex.tv/api/v2/pins"


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def device_key() -> tuple[Ed25519PrivateKey, dict[str, str]]:
    private_key = Ed25519PrivateKey.generate()
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    kid = base64url(hashlib.sha256(public_bytes).digest())
    return private_key, {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": base64url(public_bytes),
        "kid": kid,
        "alg": "EdDSA",
        "use": "sig",
    }


def private_key_bytes(private_key: Ed25519PrivateKey) -> str:
    return base64url(
        private_key.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
    )


def decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def signed_device_jwt(state: dict[str, object], now: int | None = None) -> str:
    issued_at = int(time.time()) if now is None else now
    key = Ed25519PrivateKey.from_private_bytes(
        decode_base64url(str(state["privateKey"]))
    )
    header = {"kid": state["kid"], "alg": "EdDSA", "typ": "JWT"}
    payload = {
        "aud": "plex.tv",
        "iss": CLIENT_IDENTIFIER,
        "iat": issued_at,
        "exp": issued_at + 300,
    }
    unsigned = ".".join(
        base64url(json.dumps(part, separators=(",", ":")).encode("utf-8"))
        for part in (header, payload)
    )
    return f"{unsigned}.{base64url(key.sign(unsigned.encode('ascii')))}"


def auth_url(code: str) -> str:
    fragment = urllib.parse.urlencode(
        {
            "clientID": CLIENT_IDENTIFIER,
            "code": code,
            "context[device][product]": PRODUCT,
        }
    )
    return f"https://app.plex.tv/auth#?{fragment}"


def request_json(request: urllib.request.Request) -> dict[str, object]:
    with urllib.request.urlopen(request, timeout=15) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise RuntimeError("Plex returned a non-object authentication response")
    return value


def save_state(path: pathlib.Path, state: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def start_pairing(path: pathlib.Path) -> dict[str, object]:
    private_key, jwk = device_key()
    request = urllib.request.Request(
        PINS_URL,
        method="POST",
        data=json.dumps({"jwk": jwk, "strong": True}).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    response = request_json(request)
    pin_id = response.get("id")
    code = response.get("code")
    if not isinstance(pin_id, int) or not isinstance(code, str) or not code:
        raise RuntimeError("Plex did not return a usable PIN")
    state: dict[str, object] = {
        "version": 1,
        "pinId": pin_id,
        "code": code,
        "kid": jwk["kid"],
        "privateKey": private_key_bytes(private_key),
        "createdAt": int(time.time()),
    }
    save_state(path, state)
    return {"status": "waiting", "code": code, "url": auth_url(code)}


def poll_pairing(path: pathlib.Path) -> dict[str, object]:
    state = json.loads(path.read_text(encoding="utf-8"))
    pin_id = int(state["pinId"])
    query = urllib.parse.urlencode({"deviceJWT": signed_device_jwt(state)})
    request = urllib.request.Request(
        f"{PINS_URL}/{pin_id}?{query}",
        headers={
            "Accept": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    response = request_json(request)
    token = response.get("authToken") or response.get("auth_token")
    if not isinstance(token, str) or not token:
        return {"status": "waiting", "code": state["code"], "url": auth_url(str(state["code"]))}
    state["authToken"] = token
    state["claimedAt"] = int(time.time())
    save_state(path, state)
    return {"status": "claimed"}


def print_token(path: pathlib.Path) -> None:
    state = json.loads(path.read_text(encoding="utf-8"))
    token = state.get("authToken")
    if not isinstance(token, str) or not token:
        raise RuntimeError("The Plex PIN has not been claimed")
    print(token)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("start", "poll", "token"))
    parser.add_argument("state", type=pathlib.Path)
    arguments = parser.parse_args()
    if arguments.command == "start":
        print(json.dumps(start_pairing(arguments.state)))
    elif arguments.command == "poll":
        print(json.dumps(poll_pairing(arguments.state)))
    else:
        print_token(arguments.state)


if __name__ == "__main__":
    main()
