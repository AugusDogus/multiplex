#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$runtime_dir/../.." && pwd)
toolchain_dir="$repo_dir/apps/gamecube"

# shellcheck disable=SC1091
. "$toolchain_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

platform=${MULTIPLEX_PLATFORM:-gamecube}
libogc2_stage_name=${LIBOGC2_STAGE_NAME:-.libogc2-stage}
case "$platform" in
  gamecube)
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
    artifact_root="$repo_dir/apps/gamecube"
    build_dir="$artifact_root/build-native-reference"
    libogc_runtime="$toolchain_dir/$libogc2_stage_name/opt/devkitpro/libogc2/gamecube/lib/libogc.a"
    ;;
  wii)
    if [ "$libogc2_stage_name" != .libogc2-stage ]; then
      echo "Only the default libogc2 stage carries the Wii runtime; unset LIBOGC2_STAGE_NAME." >&2
      exit 1
    fi
    reference_variant=
    artifact_stem="multiplex-wii-native-reference"
    artifact_root="$repo_dir/apps/wii"
    build_dir="$artifact_root/build-native-reference-wii"
    libogc_runtime="$toolchain_dir/$libogc2_stage_name/opt/devkitpro/libogc2/wii/lib/libogc.a"
    ;;
  *)
    echo "Unsupported MULTIPLEX_PLATFORM: $platform" >&2
    exit 1
    ;;
esac

if [ ! -s "$libogc_runtime" ]; then
  echo "Missing the pinned libogc2 runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi
if [ ! -s "$toolchain_dir/.mbedtls-stage/lib/libmbedtls.a" ]; then
  echo "Missing the pinned Mbed TLS runtime; run bun run gamecube:bootstrap first." >&2
  exit 1
fi

sh "$toolchain_dir/scripts/check.sh"
make --no-print-directory -f "$toolchain_dir/Makefile.assets" font-atlas

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
  sh "$toolchain_dir/scripts/generate-media-source-header.sh" \
    "$build_dir/media-source.h"
fi
sh "$toolchain_dir/scripts/generate-tls-ca-header.sh" \
  "$build_dir/tls-ca.h"

# The selected libogc2 stage changes both headers and libraries. Stage changes
# discard objects above; every build also refreshes the final link products.
rm -f "$artifact_root/$artifact_stem.elf" "$artifact_root/$artifact_stem.dol"

podman run --rm \
  --volume "$repo_dir:/workspace:Z" \
  --workdir /workspace/apps/gamecube \
  --env LIBOGC2_STAGE_NAME="$libogc2_stage_name" \
  --env MULTIPLEX_PLATFORM="$platform" \
  --env REFERENCE_VARIANT="$reference_variant" \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/apps/gamecube/$LIBOGC2_STAGE_NAME/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f packages/libogc-gx/Makefile.reference MULTIPLEX_PLATFORM="$MULTIPLEX_PLATFORM" ${REFERENCE_VARIANT:+REFERENCE_VARIANT="$REFERENCE_VARIANT"}'

test -s "$artifact_root/$artifact_stem.dol"
printf '%s\n' "$libogc2_stage_name" >"$stage_stamp"
readelf -sW "$artifact_root/$artifact_stem.elf" |
  grep -q "multiplex_native_app_render_reference"

dol_size=$(wc -c <"$artifact_root/$artifact_stem.dol")
echo "Native reference DOL is ready at $artifact_root/$artifact_stem.dol ($dol_size bytes)"
