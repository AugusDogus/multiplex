#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
bundle="$spike_dir/certs/mozilla-ca-bundle.pem"
expected_sha256=3ff344e30b9b1ed2971044eabb438a08f2e2245ddb5f8ab1a3ad8b63ab4eaf91
temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT

actual_sha256=$(sha256sum "$bundle" | awk '{print $1}')
test "$actual_sha256" = "$expected_sha256"
bundle_roots=$(grep -c -- '-----BEGIN CERTIFICATE-----' "$bundle")
test "$bundle_roots" -gt 100

mkdir -p "$temporary_dir/home/.portless"
cp "$bundle" "$temporary_dir/home/.portless/ca.pem"

public_header="$temporary_dir/public.h"
HOME="$temporary_dir/home" \
  MULTIPLEX_BASE_URL=https://multiplex.example.com \
  sh "$script_dir/generate-tls-ca-header.sh" "$public_header"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$public_header")" \
  -eq "$bundle_roots"

portless_header="$temporary_dir/portless.h"
HOME="$temporary_dir/home" \
  MULTIPLEX_BASE_URL=https://multiplex.localhost \
  sh "$script_dir/generate-tls-ca-header.sh" "$portless_header"
test "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$portless_header")" \
  -eq "$((bundle_roots * 2))"

echo "GameCube TLS CA bundle tests passed."
