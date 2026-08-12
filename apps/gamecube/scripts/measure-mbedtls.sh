#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
# shellcheck disable=SC1091
. "$app_dir/PINS.env"

stage_dir=${GAMECUBE_MBEDTLS_STAGE_DIR:-$app_dir/.mbedtls-stage}
source_dir=${GAMECUBE_MBEDTLS_SOURCE_DIR:-$app_dir/.mbedtls}
config_file="$runtime_dir/src/mbedtls-gamecube-config.h"
stage_recovery() {
  if [ -n "${GAMECUBE_MBEDTLS_STAGE_DIR:-}" ]; then
    printf '%s\n' "Unset GAMECUBE_MBEDTLS_STAGE_DIR and run bun run gamecube:bootstrap, or point it at a stage matching the pinned commit and current config."
  else
    printf '%s\n' "Run bun run gamecube:bootstrap first."
  fi
}
if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to inspect the staged Mbed TLS archives." >&2
  exit 1
fi
if [ ! -d "$source_dir" ] ||
  ! actual_commit=$(git -C "$source_dir" rev-parse HEAD 2>/dev/null); then
  echo "Missing Mbed TLS source checkout at $source_dir. Run bun run gamecube:bootstrap or set GAMECUBE_MBEDTLS_SOURCE_DIR." >&2
  exit 1
fi

if [ "$actual_commit" != "$MBEDTLS_COMMIT" ]; then
  echo "Mbed TLS checkout is at $actual_commit; expected $MBEDTLS_COMMIT." >&2
  exit 1
fi
if ! git -C "$source_dir" diff --quiet HEAD --; then
  echo "Mbed TLS checkout has local changes; restore the pinned upstream tree." >&2
  exit 1
fi

expected_input="$MBEDTLS_COMMIT $(cksum "$config_file")"
stamp_file="$stage_dir/.build-input"
if [ ! -f "$stamp_file" ] ||
  [ "$(sed -n '1p' "$stamp_file")" != "$expected_input" ]; then
  echo "Mbed TLS stage does not match the pinned commit and current config. $(stage_recovery)" >&2
  exit 1
fi

source_build_info="$source_dir/include/mbedtls/build_info.h"
staged_build_info="$stage_dir/include/mbedtls/build_info.h"
if [ ! -s "$staged_build_info" ]; then
  echo "Missing staged public header: $staged_build_info. $(stage_recovery)" >&2
  exit 1
fi
source_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' "$source_build_info")
staged_version=$(sed -n 's/^#define[[:space:]]*MBEDTLS_VERSION_STRING[[:space:]]*"\([^"]*\)".*/\1/p' "$staged_build_info")
if [ -z "$source_version" ] || [ "$staged_version" != "$source_version" ]; then
  echo "Staged Mbed TLS version '$staged_version' does not match pinned source version '$source_version'." >&2
  exit 1
fi

archives="libmbedtls.a libmbedx509.a libmbedcrypto.a"
for archive in $archives; do
  if [ ! -s "$stage_dir/lib/$archive" ]; then
    echo "Missing $stage_dir/lib/$archive. $(stage_recovery)" >&2
    exit 1
  fi
done
stage_dir=$(CDPATH= cd -- "$stage_dir" && pwd)

total_bytes=0
for archive in $archives; do
  bytes=$(wc -c <"$stage_dir/lib/$archive")
  total_bytes=$((total_bytes + bytes))
done
printf 'archive file bytes: %s\n' "$total_bytes"

size_output=$(mktemp)
trap 'rm -f "$size_output"' EXIT INT TERM
if ! podman run --rm \
  --volume "$stage_dir/lib:/stage:ro,Z" \
  "$DEVKITPPC_IMAGE" \
  sh -ec '
    export DEVKITPPC=/opt/devkitpro/devkitPPC
    export PATH="$DEVKITPPC/bin:$PATH"
    powerpc-eabi-size \
      /stage/libmbedtls.a \
      /stage/libmbedx509.a \
      /stage/libmbedcrypto.a
  ' >"$size_output"; then
  echo "powerpc-eabi-size could not read the staged Mbed TLS archives." >&2
  exit 1
fi

if ! section_bytes=$(
  awk '
    $1 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ { total += $4; rows += 1 }
    END { if (rows == 0) exit 1; print total }
  ' "$size_output"
); then
  echo "powerpc-eabi-size returned no object section rows." >&2
  exit 1
fi
printf 'object text + data + bss bytes: %s\n' "$section_bytes"
