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

apply_sdk_patch() {
  patch_file=$1
  if git -C "$sdk_dir" apply --unidiff-zero --reverse --check "$patch_file" >/dev/null 2>&1; then
    return
  fi
  if git -C "$sdk_dir" apply --unidiff-zero --check "$patch_file"; then
    git -C "$sdk_dir" apply --unidiff-zero "$patch_file"
    return
  fi
  echo "Native SDK patch does not apply cleanly: $patch_file" >&2
  exit 1
}

apply_sdk_patch "$spike_dir/patches/native-sdk-single-threaded-canvas.patch"
apply_sdk_patch "$spike_dir/patches/native-sdk-reference-render-fast-paths.patch"

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

mplayer_dir="$spike_dir/.mplayer-ce-libogc2"
mplayer_url="https://github.com/SuperrSonic/mplayer-ce-libogc2.git"
if [ ! -d "$mplayer_dir/.git" ]; then
  if [ -e "$mplayer_dir" ]; then
    echo "$mplayer_dir exists but is not an MPlayer CE git checkout" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$mplayer_url" "$mplayer_dir"
  git -C "$mplayer_dir" checkout --detach "$MPLAYER_CE_LIBOGC2_COMMIT"
fi

actual_mplayer_commit=$(git -C "$mplayer_dir" rev-parse HEAD)
if [ "$actual_mplayer_commit" != "$MPLAYER_CE_LIBOGC2_COMMIT" ]; then
  echo "MPlayer CE checkout is at $actual_mplayer_commit; expected $MPLAYER_CE_LIBOGC2_COMMIT" >&2
  exit 1
fi

avcodec_library="$mplayer_dir/mplayer/ffmpeg/libavcodec/libavcodec.a"
avutil_library="$mplayer_dir/mplayer/ffmpeg/libavutil/libavutil.a"
if [ ! -s "$avcodec_library" ] || [ ! -s "$avutil_library" ]; then
  if ! command -v podman >/dev/null 2>&1; then
    echo "Podman is required to build the pinned MPlayer CE decoder." >&2
    exit 1
  fi
  podman run --rm \
    --volume "$spike_dir:/workspace:Z" \
    --workdir /workspace/.mplayer-ce-libogc2/mplayer \
    "$DEVKITPPC_IMAGE" \
    sh -c 'export DEVKITPRO="/workspace/.libogc2-stage/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="$DEVKITPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -j2 ffmpeg/libavcodec/libavcodec.a ffmpeg/libavutil/libavutil.a'
fi

echo "Native SDK $NATIVE_SDK_COMMIT, libogc2 $LIBOGC2_COMMIT, MPlayer CE $MPLAYER_CE_LIBOGC2_COMMIT, and Zig $ZIG_VERSION are ready."
