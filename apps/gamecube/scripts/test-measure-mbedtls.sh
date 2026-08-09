#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
stage_dir=${GAMECUBE_MBEDTLS_STAGE_DIR:-$app_dir/.mbedtls-stage}
test_stage=$(mktemp -d)
test_output=$(mktemp)
trap 'rm -rf "$test_stage"; rm -f "$test_output"' EXIT INT TERM

mkdir -p "$test_stage/include/mbedtls" "$test_stage/lib"
cp "$stage_dir/.build-input" "$test_stage/"
cp "$stage_dir/include/mbedtls/build_info.h" "$test_stage/include/mbedtls/"
cp "$stage_dir/lib/libmbedtls.a" \
  "$stage_dir/lib/libmbedx509.a" \
  "$stage_dir/lib/libmbedcrypto.a" \
  "$test_stage/lib/"
printf 'not an archive\n' >"$test_stage/lib/libmbedtls.a"

if GAMECUBE_MBEDTLS_STAGE_DIR="$test_stage" \
  sh "$script_dir/measure-mbedtls.sh" >"$test_output" 2>&1; then
  echo "Corrupt Mbed TLS archive passed the measurement check." >&2
  exit 1
fi
if ! grep -q 'powerpc-eabi-size could not read' "$test_output"; then
  echo "Corrupt Mbed TLS archive failed for the wrong reason." >&2
  sed -n '1,120p' "$test_output" >&2
  exit 1
fi

echo "Corrupt Mbed TLS archive was rejected."
