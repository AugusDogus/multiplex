#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

if [ ! -s "$app_dir/.libogc2-stage/opt/devkitpro/libogc2/wii/lib/libogc.a" ]; then
  echo "Missing the pinned libogc2 Wii runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi
if [ ! -s "$app_dir/.mbedtls-stage/lib/libmbedtls.a" ]; then
  echo "Missing the pinned Mbed TLS runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi

sh "$script_dir/check.sh"

mkdir -p "$app_dir/build-native-reference-wii"
sh "$script_dir/generate-media-source-header.sh" \
  "$app_dir/build-native-reference-wii/media-source.h"
sh "$script_dir/generate-tls-ca-header.sh" \
  "$app_dir/build-native-reference-wii/tls-ca.h"

podman run --rm \
  --volume "$app_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/.libogc2-stage/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.reference.wii'

test -s "$app_dir/multiplex-wii-native-reference.dol"
readelf -sW "$app_dir/multiplex-wii-native-reference.elf" |
  grep -q "multiplex_native_app_render_reference"

dol_size=$(wc -c <"$app_dir/multiplex-wii-native-reference.dol")
echo "Wii Native reference DOL is ready at $app_dir/multiplex-wii-native-reference.dol ($dol_size bytes)"
