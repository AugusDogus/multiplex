#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
mbedtls_dir=${GAMECUBE_MBEDTLS_SOURCE_DIR:-$app_dir/.mbedtls}
mbedtls_config="$runtime_dir/src/mbedtls-gamecube-config.h"
stage_dir=${GAMECUBE_MBEDTLS_STAGE_DIR:-$app_dir/.mbedtls-stage}
cmake=${CMAKE:-cmake}
cc=${CC:-cc}
server_cc=${GAMECUBE_MBEDTLS_SERVER_CC:-cc}
python=${PYTHON:-python}

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

stage_recovery() {
  if [ -n "${GAMECUBE_MBEDTLS_STAGE_DIR:-}" ]; then
    printf '%s\n' "Unset GAMECUBE_MBEDTLS_STAGE_DIR and run bun run gamecube:bootstrap, or point it at a stage matching the pinned commit and current config."
  else
    printf '%s\n' "Run bun run gamecube:bootstrap first."
  fi
}

require_command() {
  command_path=$(command -v "$1" 2>/dev/null || true)
  if [ -z "$command_path" ]; then
    echo "$1 is required for the Mbed TLS handshake test. Install it or set $2 to its executable path." >&2
    exit 1
  fi
  case "$command_path" in
    /*) ;;
    *)
      command_dir=$(CDPATH= cd -- "$(dirname -- "$command_path")" && pwd)
      command_path="$command_dir/$(basename -- "$command_path")"
      ;;
  esac
  printf '%s\n' "$command_path"
}

cmake=$(require_command "$cmake" CMAKE)
cc=$(require_command "$cc" CC)
server_cc=$(require_command "$server_cc" GAMECUBE_MBEDTLS_SERVER_CC)
python=$(require_command "$python" PYTHON)
if [ ! -d "$mbedtls_dir" ] ||
  ! actual_commit=$(git -C "$mbedtls_dir" rev-parse HEAD 2>/dev/null); then
  echo "Missing Mbed TLS source checkout at $mbedtls_dir. Run bun run gamecube:bootstrap or set GAMECUBE_MBEDTLS_SOURCE_DIR." >&2
  exit 1
fi

if [ "$actual_commit" != "$MBEDTLS_COMMIT" ]; then
  echo "Mbed TLS checkout is at $actual_commit; expected $MBEDTLS_COMMIT from PINS.env." >&2
  exit 1
fi
if ! git -C "$mbedtls_dir" diff --quiet HEAD --; then
  echo "Mbed TLS checkout has local changes; expected the pinned upstream tree." >&2
  exit 1
fi

if [ ! -f "$mbedtls_config" ]; then
  echo "Missing GameCube Mbed TLS config: $mbedtls_config" >&2
  exit 1
fi
expected_input="$MBEDTLS_COMMIT $(cksum "$mbedtls_config")"
if [ ! -f "$stage_dir/.build-input" ] ||
  [ "$(sed -n '1p' "$stage_dir/.build-input")" != "$expected_input" ]; then
  echo "Mbed TLS stage does not match the pinned commit and current config. $(stage_recovery)" >&2
  exit 1
fi
for header in mbedtls/build_info.h mbedtls/error.h mbedtls/ssl.h \
  mbedtls/x509_crt.h; do
  if [ ! -f "$stage_dir/include/$header" ]; then
    echo "Missing staged public header: $stage_dir/include/$header. $(stage_recovery)" >&2
    exit 1
  fi
done
source_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$mbedtls_dir/include/mbedtls/build_info.h")
staged_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$stage_dir/include/mbedtls/build_info.h")
if [ -z "$source_version" ] || [ "$staged_version" != "$source_version" ]; then
  echo "Staged Mbed TLS version '$staged_version' does not match pinned source version '$source_version'." >&2
  exit 1
fi

server_certificate="$mbedtls_dir/framework/data_files/server2-sha256.crt"
server_key="$mbedtls_dir/framework/data_files/server2.key"
trust_root="$mbedtls_dir/framework/data_files/test-ca.crt"
different_root="$mbedtls_dir/framework/data_files/test-ca2.crt"
for fixture in "$server_certificate" "$server_key" "$trust_root" \
  "$different_root"; do
  if [ ! -s "$fixture" ]; then
    echo "Missing pinned Mbed TLS fixture: $fixture" >&2
    exit 1
  fi
done

temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-mbedtls-verification.XXXXXX")
server_pid=
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

client_build="$temporary_dir/client-build"
server_build="$temporary_dir/server-build"
test_binary="$temporary_dir/mbedtls-verification-test"
client_cflags=${CFLAGS:+$CFLAGS }
client_cflags="${client_cflags}-DMBEDTLS_PLATFORM_TIME_ALT"
CC="$cc" CFLAGS="$client_cflags" "$cmake" -S "$mbedtls_dir" -B "$client_build" \
  -DMBEDTLS_CONFIG_FILE="$mbedtls_config" \
  -DENABLE_TESTING=OFF \
  -DENABLE_PROGRAMS=OFF \
  -DUSE_STATIC_MBEDTLS_LIBRARY=ON \
  -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
  -DCMAKE_BUILD_TYPE=Release
"$cmake" --build "$client_build" --target mbedtls \
  --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-2}"

CC="$server_cc" "$cmake" -S "$mbedtls_dir" -B "$server_build" \
  -DENABLE_TESTING=OFF \
  -DENABLE_PROGRAMS=ON \
  -DUSE_STATIC_MBEDTLS_LIBRARY=ON \
  -DUSE_SHARED_MBEDTLS_LIBRARY=OFF \
  -DCMAKE_BUILD_TYPE=Release
"$cmake" --build "$server_build" --target ssl_server2 \
  --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-2}"

"$cc" -std=c11 -Wall -Wextra -Werror \
  -DMBEDTLS_CONFIG_FILE=\"mbedtls-gamecube-config.h\" \
  -DMBEDTLS_PLATFORM_TIME_ALT \
  -I"$runtime_dir/src" \
  -I"$stage_dir/include" \
  "$runtime_dir/src/tls_client_verification.c" \
  "$app_dir/tests/mbedtls_verification_test.c" \
  -L"$client_build/library" \
  -lmbedtls -lmbedx509 -lmbedcrypto \
  -o "$test_binary"

port=${GAMECUBE_MBEDTLS_TEST_PORT:-}
if [ -z "$port" ]; then
  port=$(
    "$python" -c 'import socket
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])'
  )
fi
server_log="$temporary_dir/server.log"
"$server_build/programs/ssl/ssl_server2" \
  server_addr=127.0.0.1 \
  server_port="$port" \
  force_version=tls12 \
  crt_file="$server_certificate" \
  key_file="$server_key" \
  exchanges=0 \
  debug_level=0 >"$server_log" 2>&1 &
server_pid=$!

run_case() {
  root=$1
  hostname=$2
  expectation=$3
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Pinned Mbed TLS server exited before the $expectation case." >&2
    sed -n '1,160p' "$server_log" >&2
    exit 1
  fi
  if ! "$test_binary" "$port" "$root" "$hostname" "$expectation"; then
    echo "Pinned Mbed TLS server output:" >&2
    sed -n '1,160p' "$server_log" >&2
    exit 1
  fi
}

printf 'Mbed TLS %s production-boundary handshake fixtures: %s, %s, %s, %s\n' \
  "$MBEDTLS_COMMIT" "$(basename "$server_certificate")" \
  "$(basename "$server_key")" "$(basename "$trust_root")" \
  "$(basename "$different_root")"
run_case "$trust_root" localhost none
run_case "$trust_root" wrong.example hostname
run_case "$different_root" localhost trust

echo "Production TLS client verification boundary passed."
