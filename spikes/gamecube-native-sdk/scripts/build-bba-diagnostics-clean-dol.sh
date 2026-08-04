#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

source_dir="$spike_dir/.libogc2-clean"
stage_dir="$spike_dir/.libogc2-clean-stage"
stage_library="$stage_dir/opt/devkitpro/libogc2/gamecube/lib/libogc.a"
stamp="$stage_dir/.build-input"

if [ ! -d "$source_dir/.git" ]; then
  if [ -e "$source_dir" ]; then
    echo "$source_dir exists but is not a libogc2 git checkout" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout \
    https://github.com/extremscorner/libogc2.git "$source_dir"
  git -C "$source_dir" checkout --detach "$LIBOGC2_COMMIT"
fi

actual_commit=$(git -C "$source_dir" rev-parse HEAD)
if [ "$actual_commit" != "$LIBOGC2_COMMIT" ]; then
  echo "Clean libogc2 checkout is at $actual_commit; expected $LIBOGC2_COMMIT" >&2
  exit 1
fi
if [ -n "$(git -C "$source_dir" status --short)" ]; then
  echo "Clean libogc2 checkout contains local changes." >&2
  exit 1
fi

if [ ! -s "$stage_library" ] || [ ! -f "$stamp" ] ||
  [ "$(sed -n '1p' "$stamp")" != "$LIBOGC2_COMMIT" ]; then
  podman run --rm \
    --volume "$spike_dir:/workspace:Z" \
    --workdir /workspace/.libogc2-clean \
    "$DEVKITPPC_IMAGE" \
    sh -ec 'export DEVKITPRO=/opt/devkitpro; export DEVKITPPC=/opt/devkitpro/devkitPPC; make clean; make cube; stage=/workspace/.libogc2-clean-stage/opt/devkitpro/libogc2; rm -rf "$stage"; mkdir -p "$stage/gamecube/lib"; cp -R include "$stage/gamecube/"; cp lib/cube/*.a "$stage/gamecube/lib/"; cp *_license.txt *_rules "$stage/"'
  printf '%s\n' "$LIBOGC2_COMMIT" >"$stamp"
fi

LIBOGC2_STAGE_NAME=.libogc2-clean-stage \
  sh "$script_dir/build-bba-diagnostics-dol.sh"
