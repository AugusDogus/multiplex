#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
build_dir=build-native-reference-hardware-debug
target=multiplex-gamecube-hardware-debug

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

mkdir -p "$spike_dir/$build_dir"
if [ -z "${MULTIPLEX_BASE_URL:-}" ] &&
  [ -s "$spike_dir/build-native-reference/media-source.h" ] &&
  grep -q '#define MULTIPLEX_PAIRING_ENABLED 1' \
    "$spike_dir/build-native-reference/media-source.h"; then
  cp "$spike_dir/build-native-reference/media-source.h" \
    "$spike_dir/$build_dir/media-source.h"
  cp "$spike_dir/build-native-reference/tls-ca.h" \
    "$spike_dir/$build_dir/tls-ca.h"
  echo "Using the release DOL's saved hardware endpoints."
else
  sh "$script_dir/generate-media-source-header.sh" \
    "$spike_dir/$build_dir/media-source.h"
  sh "$script_dir/generate-tls-ca-header.sh" \
    "$spike_dir/$build_dir/tls-ca.h"
fi

podman run --rm \
  --volume "$spike_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/.libogc2-stage/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.reference.gamecube TARGET=multiplex-gamecube-hardware-debug BUILD=build-native-reference-hardware-debug CFLAGS_EXTRA=-DMULTIPLEX_HARDWARE_DIAGNOSTICS=1'

test -s "$spike_dir/$target.dol"
test -s "$spike_dir/$target.elf"
dol_size=$(wc -c <"$spike_dir/$target.dol")
echo "Hardware diagnostic DOL is ready at $spike_dir/$target.dol ($dol_size bytes)"
