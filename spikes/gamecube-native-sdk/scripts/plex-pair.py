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
NONCE_URL = "https://clients.plex.tv/api/v2/auth/nonce"
TOKEN_URL = "https://clients.plex.tv/api/v2/auth/token"
RESOURCES_URL = "https://plex.tv/api/v2/resources"
REFRESH_WINDOW_SECONDS = 24 * 60 * 60
DEVICE_SCOPES = (
    "username",
    "email",
    "friendly_name",
    "restricted",
    "anonymous",
    "joinedAt",
)


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


def signed_device_jwt(
    state: dict[str, object],
    now: int | None = None,
    nonce: str | None = None,
    scopes: tuple[str, ...] = (),
) -> str:
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
    if nonce is not None:
        payload["nonce"] = nonce
    if scopes:
        payload["scope"] = ",".join(scopes)
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


def load_state(path: pathlib.Path) -> dict[str, object]:
    state = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(state, dict):
        raise RuntimeError("Plex authentication state is not an object")
    return state


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


def start_pms_pairing(path: pathlib.Path) -> dict[str, object]:
    request = urllib.request.Request(
        PINS_URL,
        method="POST",
        data=urllib.parse.urlencode({"strong": "true"}).encode("ascii"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    response = request_json(request)
    pin_id = response.get("id")
    code = response.get("code")
    if not isinstance(pin_id, int) or not isinstance(code, str) or not code:
        raise RuntimeError("Plex did not return a usable PMS PIN")
    state = load_state(path) if path.exists() else {"version": 1}
    state["pmsPinId"] = pin_id
    state["pmsCode"] = code
    state["pmsCreatedAt"] = int(time.time())
    save_state(path, state)
    return {"status": "waiting", "code": code, "url": auth_url(code)}


def poll_pairing(path: pathlib.Path) -> dict[str, object]:
    state = load_state(path)
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


def poll_pms_pairing(path: pathlib.Path) -> dict[str, object]:
    state = load_state(path)
    pin_id = int(state["pmsPinId"])
    request = urllib.request.Request(
        f"{PINS_URL}/{pin_id}",
        headers={
            "Accept": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    response = request_json(request)
    token = response.get("authToken") or response.get("auth_token")
    if not isinstance(token, str) or not token:
        code = str(state["pmsCode"])
        return {"status": "waiting", "code": code, "url": auth_url(code)}
    state["pmsAuthToken"] = token
    state["pmsClaimedAt"] = int(time.time())
    save_state(path, state)
    return {"status": "claimed"}


def token_expiry(token: str) -> int:
    parts = token.split(".")
    if len(parts) != 3:
        raise RuntimeError("Plex authentication token is not a JWT")
    try:
        payload = json.loads(decode_base64url(parts[1]))
    except (ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("Plex authentication token has an invalid payload") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Plex authentication token payload is not an object")
    expiry = payload.get("exp")
    if not isinstance(expiry, int):
        raise RuntimeError("Plex authentication token has no expiry")
    if payload.get("iss") != "plex.tv":
        raise RuntimeError("Plex authentication token has an unexpected issuer")
    audience = payload.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if CLIENT_IDENTIFIER not in audiences:
        raise RuntimeError("Plex authentication token has an unexpected audience")
    return expiry


def refresh_pairing(
    path: pathlib.Path,
    now: int | None = None,
) -> dict[str, object]:
    state = load_state(path)
    issued_at = int(time.time()) if now is None else now
    nonce_request = urllib.request.Request(
        NONCE_URL,
        headers={
            "Accept": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    nonce = request_json(nonce_request).get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise RuntimeError("Plex did not return a usable authentication nonce")
    exchange_request = urllib.request.Request(
        TOKEN_URL,
        method="POST",
        data=json.dumps(
            {
                "jwt": signed_device_jwt(
                    state,
                    now=issued_at,
                    nonce=nonce,
                    scopes=DEVICE_SCOPES,
                )
            }
        ).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
        },
    )
    response = request_json(exchange_request)
    token = response.get("authToken") or response.get("auth_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Plex did not return a refreshed authentication token")
    token_expiry(token)
    state["authToken"] = token
    state["refreshedAt"] = issued_at
    save_state(path, state)
    return state


def ensure_token(
    path: pathlib.Path,
    now: int | None = None,
) -> str:
    state = load_state(path)
    token = state.get("authToken")
    if not isinstance(token, str) or not token:
        raise RuntimeError("The Plex PIN has not been claimed")
    current_time = int(time.time()) if now is None else now
    if token_expiry(token) <= current_time + REFRESH_WINDOW_SECONDS:
        state = refresh_pairing(path, now=current_time)
        token = state["authToken"]
    return str(token)


def server_token(path: pathlib.Path, base_url: str, now: int | None = None) -> str:
    state = load_state(path)
    pms_account_token = state.get("pmsAuthToken")
    account_token = (
        pms_account_token
        if isinstance(pms_account_token, str) and pms_account_token
        else ensure_token(path, now=now)
    )
    identity_request = urllib.request.Request(
        f"{base_url.rstrip('/')}/identity",
        headers={"Accept": "application/xml"},
    )
    with urllib.request.urlopen(identity_request, timeout=10) as response:
        identity = response.read().decode("utf-8", errors="replace")
    marker = 'machineIdentifier="'
    marker_start = identity.find(marker)
    if marker_start < 0:
        raise RuntimeError("Plex server identity has no machine identifier")
    identifier_start = marker_start + len(marker)
    identifier_end = identity.find('"', identifier_start)
    if identifier_end < 0:
        raise RuntimeError("Plex server identity has an invalid machine identifier")
    machine_identifier = identity[identifier_start:identifier_end]

    query = urllib.parse.urlencode({"includeHttps": 1, "includeRelay": 1})
    resources_request = urllib.request.Request(
        f"{RESOURCES_URL}?{query}",
        headers={
            "Accept": "application/json",
            "X-Plex-Product": PRODUCT,
            "X-Plex-Client-Identifier": CLIENT_IDENTIFIER,
            "X-Plex-Token": account_token,
        },
    )
    with urllib.request.urlopen(resources_request, timeout=15) as response:
        resources = json.loads(response.read())
    if not isinstance(resources, list):
        raise RuntimeError("Plex returned an invalid resource directory")
    for resource in resources:
        if not isinstance(resource, dict):
            continue
        if resource.get("clientIdentifier") != machine_identifier:
            continue
        access_token = resource.get("accessToken")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError("Selected Plex server has no access token")
        if access_token.count(".") == 2:
            raise RuntimeError(
                "Plex returned an account JWT instead of a PMS access token; "
                "run pms-start and pms-poll to authorize the compatibility token"
            )
        return access_token
    raise RuntimeError("Selected Plex server is absent from the approved account")


def print_token(path: pathlib.Path) -> None:
    state = load_state(path)
    token = state.get("authToken")
    if not isinstance(token, str) or not token:
        raise RuntimeError("The Plex PIN has not been claimed")
    print(token)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=(
            "start",
            "poll",
            "pms-start",
            "pms-poll",
            "token",
            "refresh",
            "ensure",
            "server-token",
        ),
    )
    parser.add_argument("state", type=pathlib.Path)
    parser.add_argument("base_url", nargs="?")
    arguments = parser.parse_args()
    if arguments.command == "start":
        print(json.dumps(start_pairing(arguments.state)))
    elif arguments.command == "poll":
        print(json.dumps(poll_pairing(arguments.state)))
    elif arguments.command == "pms-start":
        print(json.dumps(start_pms_pairing(arguments.state)))
    elif arguments.command == "pms-poll":
        print(json.dumps(poll_pms_pairing(arguments.state)))
    elif arguments.command == "refresh":
        refresh_pairing(arguments.state)
        print(json.dumps({"status": "refreshed"}))
    elif arguments.command == "ensure":
        print(ensure_token(arguments.state))
    elif arguments.command == "server-token":
        if not arguments.base_url:
            parser.error("server-token requires base_url")
        print(server_token(arguments.state, arguments.base_url))
    else:
        print_token(arguments.state)


if __name__ == "__main__":
    main()
