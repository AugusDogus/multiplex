#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
bundle="$app_dir/certs/mozilla-ca-bundle.pem"
expected_sha256=3ff344e30b9b1ed2971044eabb438a08f2e2245ddb5f8ab1a3ad8b63ab4eaf91
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT

actual_sha256=$(sha256sum "$bundle" | awk '{print $1}')
test "$actual_sha256" = "$expected_sha256"
bundle_roots=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$bundle")
test "$bundle_roots" -gt 100

mkdir -p "$temporary_dir/home/.portless"
awk '
  /-----BEGIN CERTIFICATE-----/ { certificate += 1 }
  certificate == 1 { print }
  certificate == 1 && /-----END CERTIFICATE-----/ { exit }
' "$bundle" >"$temporary_dir/home/.portless/ca.pem"
portless_roots=$(grep -c -- '-----BEGIN CERTIFICATE-----' \
  "$temporary_dir/home/.portless/ca.pem")
test "$portless_roots" -eq 1
printf '%s\n' 'PORTLESS_HOST_CERTIFICATE_SHOULD_NOT_BE_EMBEDDED' \
  >"$temporary_dir/home/.portless/server.pem"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'not-a-real-key' \
  '-----END PRIVATE KEY-----' \
  >"$temporary_dir/home/.portless/server-key.pem"

assert_header_safe() {
  header=$1
  if grep -Eq -- '-----BEGIN ([A-Z0-9]+ )?PRIVATE KEY-----' "$header"; then
    return 1
  fi
  if grep -q -- 'PORTLESS_HOST_CERTIFICATE_SHOULD_NOT_BE_EMBEDDED' "$header"; then
    return 1
  fi
}

public_header="$temporary_dir/public.h"
HOME="$temporary_dir/home" \
  MULTIPLEX_BASE_URL=https://multiplex.example.com \
  sh "$script_dir/generate-tls-ca-header.sh" "$public_header"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$public_header")" \
  -eq "$bundle_roots"
assert_header_safe "$public_header"

portless_header="$temporary_dir/portless.h"
HOME="$temporary_dir/home" \
  MULTIPLEX_BASE_URL=https://multiplex.localhost \
  sh "$script_dir/generate-tls-ca-header.sh" "$portless_header"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$portless_header")" \
  -eq "$((bundle_roots + portless_roots))"
assert_header_safe "$portless_header"

preserved_dir="$temporary_dir/preserved"
mkdir -p "$preserved_dir"
printf '%s\n' '#define MULTIPLEX_BASE_URL "https://multiplex.localhost"' \
  >"$preserved_dir/media-source.h"
HOME="$temporary_dir/home" \
  sh "$script_dir/generate-tls-ca-header.sh" "$preserved_dir/tls-ca.h"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$preserved_dir/tls-ca.h")" \
  -eq "$((bundle_roots + portless_roots))"
assert_header_safe "$preserved_dir/tls-ca.h"

override_ca="$temporary_dir/override-ca.pem"
awk '
  /-----BEGIN CERTIFICATE-----/ { certificate += 1 }
  certificate == 2 { print }
  certificate == 2 && /-----END CERTIFICATE-----/ { exit }
' "$bundle" >"$override_ca"
override_roots=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$override_ca")
test "$override_roots" -eq 1
override_header="$temporary_dir/override.h"
HOME="$temporary_dir/home" \
  MULTIPLEX_BASE_URL=https://multiplex.example.com \
  GAMECUBE_TLS_CA_FILE="$override_ca" \
  sh "$script_dir/generate-tls-ca-header.sh" "$override_header"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$override_header")" \
  -eq "$((bundle_roots + override_roots))"
assert_header_safe "$override_header"

echo "GameCube TLS CA bundle tests passed."
