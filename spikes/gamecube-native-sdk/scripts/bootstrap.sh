#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

sdk_dir="$spike_dir/.native-sdk"
sdk_url="https://github.com/vercel-labs/native.git"

if [ ! -d "$sdk_dir/.git" ]; then
  if [ -e "$sdk_dir" ]; then
    echo "$sdk_dir exists but is not a Native SDK git checkout" >&2
    exit 1
  fi

  git clone --filter=blob:none --no-checkout "$sdk_url" "$sdk_dir"
  git -C "$sdk_dir" checkout --detach "$NATIVE_SDK_COMMIT"
fi

actual_commit=$(git -C "$sdk_dir" rev-parse HEAD)
if [ "$actual_commit" != "$NATIVE_SDK_COMMIT" ]; then
  echo "Native SDK checkout is at $actual_commit; expected $NATIVE_SDK_COMMIT" >&2
  echo "Remove $sdk_dir and run this command again to recreate the pinned checkout." >&2
  exit 1
fi

canvas_patch="$spike_dir/patches/native-sdk-single-threaded-canvas.patch"
if git -C "$sdk_dir" apply --unidiff-zero --reverse --check "$canvas_patch" >/dev/null 2>&1; then
  :
elif git -C "$sdk_dir" apply --unidiff-zero --check "$canvas_patch"; then
  git -C "$sdk_dir" apply --unidiff-zero "$canvas_patch"
else
  echo "Native SDK GameCube canvas patch does not apply cleanly." >&2
  exit 1
fi

actual_zig=$(zig version)
if [ "$actual_zig" != "$ZIG_VERSION" ]; then
  echo "Zig $ZIG_VERSION is required; found $actual_zig" >&2
  exit 1
fi

npm ci --prefix "$sdk_dir/packages/core"

libogc2_dir="$spike_dir/.libogc2"
libogc2_url="https://github.com/extremscorner/libogc2.git"
libogc2_stage="$spike_dir/.libogc2-stage"
if [ ! -d "$libogc2_dir/.git" ]; then
  if [ -e "$libogc2_dir" ]; then
    echo "$libogc2_dir exists but is not a libogc2 git checkout" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$libogc2_url" "$libogc2_dir"
  git -C "$libogc2_dir" checkout --detach "$LIBOGC2_COMMIT"
fi

actual_libogc2_commit=$(git -C "$libogc2_dir" rev-parse HEAD)
if [ "$actual_libogc2_commit" != "$LIBOGC2_COMMIT" ]; then
  echo "libogc2 checkout is at $actual_libogc2_commit; expected $LIBOGC2_COMMIT" >&2
  exit 1
fi

if [ ! -s "$libogc2_stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a" ]; then
  if ! command -v podman >/dev/null 2>&1; then
    echo "Podman is required to build the pinned libogc2 runtime." >&2
    exit 1
  fi
  podman run --rm \
    --volume "$spike_dir:/workspace:Z" \
    --workdir /workspace/.libogc2 \
    "$DEVKITPPC_IMAGE" \
    sh -c 'export DEVKITPRO="/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; make cube; stage="/workspace/.libogc2-stage/opt/devkitpro/libogc2"; mkdir -p "$stage/gamecube/lib"; cp -R include "$stage/gamecube/"; cp lib/cube/*.a "$stage/gamecube/lib/"; cp *_license.txt *_rules "$stage/"'
fi

echo "Native SDK $NATIVE_SDK_COMMIT, libogc2 $LIBOGC2_COMMIT, and Zig $ZIG_VERSION are ready."
