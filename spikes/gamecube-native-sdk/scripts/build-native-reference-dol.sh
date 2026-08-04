#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

if [ ! -s "$spike_dir/.libogc2-stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a" ]; then
  echo "Missing the pinned libogc2 runtime; run bun run spike:gamecube:bootstrap first." >&2
  exit 1
fi
if [ ! -s "$spike_dir/.mbedtls-stage/lib/libmbedtls.a" ]; then
  echo "Missing the pinned Mbed TLS runtime; run bun run spike:gamecube:bootstrap first." >&2
  exit 1
fi

sh "$script_dir/check.sh"

mkdir -p "$spike_dir/build-native-reference"
if [ -z "${MULTIPLEX_BASE_URL:-}" ] &&
  [ -s "$spike_dir/build-native-reference/media-source.h" ] &&
  grep -q '#define MULTIPLEX_PAIRING_ENABLED 1' \
    "$spike_dir/build-native-reference/media-source.h"; then
  echo "Keeping the existing hardware endpoints."
else
  sh "$script_dir/generate-media-source-header.sh" \
    "$spike_dir/build-native-reference/media-source.h"
fi
sh "$script_dir/generate-tls-ca-header.sh" \
  "$spike_dir/build-native-reference/tls-ca.h"

podman run --rm \
  --volume "$spike_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/.libogc2-stage/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.reference.gamecube'

test -s "$spike_dir/multiplex-gamecube-native-reference.dol"
readelf -sW "$spike_dir/multiplex-gamecube-native-reference.elf" |
  grep -q "multiplex_native_app_render_reference"

dol_size=$(wc -c <"$spike_dir/multiplex-gamecube-native-reference.dol")
echo "Native reference DOL is ready at $spike_dir/multiplex-gamecube-native-reference.dol ($dol_size bytes)"
