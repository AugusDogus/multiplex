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

libogc2_stage_name=${LIBOGC2_STAGE_NAME:-.libogc2-stage}
case "$libogc2_stage_name" in
  .libogc2-stage) reference_variant=dolphin ;;
  .libogc2-clean-stage) reference_variant=clean ;;
  .libogc2-hardware-stage) reference_variant=hardware ;;
  *)
    echo "Unsupported libogc2 stage: $libogc2_stage_name" >&2
    exit 1
    ;;
esac
artifact_stem="multiplex-gamecube-native-reference-$reference_variant"

if [ ! -s "$app_dir/$libogc2_stage_name/opt/devkitpro/libogc2/gamecube/lib/libogc.a" ]; then
  echo "Missing the pinned libogc2 runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi
if [ ! -s "$app_dir/.mbedtls-stage/lib/libmbedtls.a" ]; then
  echo "Missing the pinned Mbed TLS runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi

sh "$script_dir/check.sh"
make --no-print-directory -f "$app_dir/Makefile.assets" font-atlas

build_dir="$app_dir/build-native-reference"
stage_stamp="$build_dir/.libogc2-stage"
mkdir -p "$build_dir"
if [ ! -f "$stage_stamp" ] ||
  [ "$(sed -n '1p' "$stage_stamp" 2>/dev/null)" != "$libogc2_stage_name" ]; then
  rm -f "$build_dir"/*.o "$build_dir"/*.d
fi
if [ -z "${MULTIPLEX_BASE_URL:-}" ] &&
  [ -s "$build_dir/media-source.h" ] &&
  grep -q '#define MULTIPLEX_PAIRING_ENABLED 1' \
    "$build_dir/media-source.h"; then
  echo "Keeping the existing hardware endpoints."
else
  sh "$script_dir/generate-media-source-header.sh" \
    "$build_dir/media-source.h"
fi
sh "$script_dir/generate-tls-ca-header.sh" \
  "$build_dir/tls-ca.h"

# The selected libogc2 stage changes both headers and libraries. Stage changes
# discard objects above; every build also refreshes the final link products.
rm -f "$app_dir/$artifact_stem.elf" "$app_dir/$artifact_stem.dol"

podman run --rm \
  --volume "$app_dir:/workspace:Z" \
  --workdir /workspace \
  --env LIBOGC2_STAGE_NAME="$libogc2_stage_name" \
  --env REFERENCE_VARIANT="$reference_variant" \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/$LIBOGC2_STAGE_NAME/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.reference.gamecube REFERENCE_VARIANT="$REFERENCE_VARIANT"'

test -s "$app_dir/$artifact_stem.dol"
printf '%s\n' "$libogc2_stage_name" >"$stage_stamp"
readelf -sW "$app_dir/$artifact_stem.elf" |
  grep -q "multiplex_native_app_render_reference"

dol_size=$(wc -c <"$app_dir/$artifact_stem.dol")
echo "Native $reference_variant DOL is ready at $app_dir/$artifact_stem.dol ($dol_size bytes)"
