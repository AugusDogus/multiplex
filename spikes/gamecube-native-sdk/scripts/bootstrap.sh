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
apply_sdk_patch "$spike_dir/patches/native-sdk-panel-focus-indicator.patch"

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

libogc2_patch="$spike_dir/patches/libogc2-flush-tcp-writes.patch"
libogc2_bba_wrap_patch="$spike_dir/patches/libogc2-wrap-bba-receive-dma.patch"
libogc2_bba_recovery_patch="$spike_dir/patches/libogc2-recover-malformed-bba-descriptors.patch"
libogc2_bba_pbuf_patch="$spike_dir/patches/libogc2-drop-bba-packet-on-pbuf-exhaustion.patch"
libogc2_tcp_sequence_patch="$spike_dir/patches/libogc2-lwip-rfc-snd-nxt.patch"
libogc2_tcp_window_patch="$spike_dir/patches/libogc2-flush-tcp-window-updates.patch"
libogc2_bba_link_patch="$spike_dir/patches/libogc2-start-bba-after-link.patch"
libogc2_dhcp_worker_patch="$spike_dir/patches/libogc2-start-network-worker-before-dhcp.patch"
libogc2_dhcp_state_patch="$spike_dir/patches/libogc2-arm-dhcp-state-before-send.patch"
for patch_file in "$libogc2_patch" "$libogc2_bba_wrap_patch" "$libogc2_bba_recovery_patch" "$libogc2_bba_pbuf_patch" "$libogc2_tcp_sequence_patch" "$libogc2_tcp_window_patch" "$libogc2_bba_link_patch" "$libogc2_dhcp_worker_patch" "$libogc2_dhcp_state_patch"; do
  if git -C "$libogc2_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    :
  elif git -C "$libogc2_dir" apply --check "$patch_file"; then
    git -C "$libogc2_dir" apply "$patch_file"
  else
    echo "libogc2 patch does not apply cleanly: $patch_file" >&2
    exit 1
  fi
done

libogc2_input="$LIBOGC2_COMMIT $(cksum "$libogc2_patch") $(cksum "$libogc2_bba_wrap_patch") $(cksum "$libogc2_bba_recovery_patch") $(cksum "$libogc2_bba_pbuf_patch") $(cksum "$libogc2_tcp_sequence_patch") $(cksum "$libogc2_tcp_window_patch") $(cksum "$libogc2_bba_link_patch") $(cksum "$libogc2_dhcp_worker_patch") $(cksum "$libogc2_dhcp_state_patch")"
libogc2_stamp="$libogc2_stage/.build-input"
if [ ! -s "$libogc2_stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a" ] ||
  [ ! -s "$libogc2_stage/opt/devkitpro/libogc2/wii/lib/libogc.a" ] ||
  [ ! -f "$libogc2_stamp" ] ||
  [ "$(sed -n '1p' "$libogc2_stamp")" != "$libogc2_input" ]; then
  if ! command -v podman >/dev/null 2>&1; then
    echo "Podman is required to build the pinned libogc2 runtime." >&2
    exit 1
  fi
  podman run --rm \
    --volume "$spike_dir:/workspace:Z" \
    --workdir /workspace/.libogc2 \
    "$DEVKITPPC_IMAGE" \
    sh -ec 'export DEVKITPRO="/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; make clean; make cube wii; stage="/workspace/.libogc2-stage/opt/devkitpro/libogc2"; rm -rf "$stage"; mkdir -p "$stage/gamecube/lib" "$stage/wii/lib"; cp -R include "$stage/gamecube/"; cp -R include "$stage/wii/"; cp lib/cube/*.a "$stage/gamecube/lib/"; cp lib/wii/*.a "$stage/wii/lib/"; cp *_license.txt *_rules "$stage/"'
  printf '%s\n' "$libogc2_input" >"$libogc2_stamp"
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

mbedtls_dir="$spike_dir/.mbedtls"
mbedtls_url="https://github.com/Mbed-TLS/mbedtls.git"
mbedtls_stage="$spike_dir/.mbedtls-stage"
mbedtls_config="$spike_dir/host-reference-gx/mbedtls-gamecube-config.h"
if [ ! -d "$mbedtls_dir/.git" ]; then
  if [ -e "$mbedtls_dir" ]; then
    echo "$mbedtls_dir exists but is not an Mbed TLS git checkout" >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout "$mbedtls_url" "$mbedtls_dir"
  git -C "$mbedtls_dir" checkout --detach "$MBEDTLS_COMMIT"
  git -C "$mbedtls_dir" submodule update --init --depth 1
fi

actual_mbedtls_commit=$(git -C "$mbedtls_dir" rev-parse HEAD)
if [ "$actual_mbedtls_commit" != "$MBEDTLS_COMMIT" ]; then
  echo "Mbed TLS checkout is at $actual_mbedtls_commit; expected $MBEDTLS_COMMIT" >&2
  exit 1
fi
if ! git -C "$mbedtls_dir" diff --quiet; then
  echo "Mbed TLS checkout has local changes; expected the pinned upstream tree" >&2
  exit 1
fi

mbedtls_input="$MBEDTLS_COMMIT $(cksum "$mbedtls_config")"
mbedtls_stamp="$mbedtls_stage/.build-input"
if [ ! -s "$mbedtls_stage/lib/libmbedtls.a" ] ||
  [ ! -s "$mbedtls_stage/lib/libmbedx509.a" ] ||
  [ ! -s "$mbedtls_stage/lib/libmbedcrypto.a" ] ||
  [ ! -f "$mbedtls_stamp" ] ||
  [ "$(sed -n '1p' "$mbedtls_stamp")" != "$mbedtls_input" ]; then
  if ! command -v podman >/dev/null 2>&1; then
    echo "Podman is required to build the pinned Mbed TLS runtime." >&2
    exit 1
  fi
  podman run --rm \
    --volume "$spike_dir:/workspace:Z" \
    --workdir /workspace/.mbedtls \
    "$DEVKITPPC_IMAGE" \
    sh -c 'export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="$DEVKITPPC/bin:$PATH"; make clean >/dev/null; touch library/error.c library/version_features.c library/ssl_debug_helpers_generated.c library/psa_crypto_driver_wrappers.h library/psa_crypto_driver_wrappers_no_static.c; make -j2 lib GEN_FILES= CC=powerpc-eabi-gcc AR=powerpc-eabi-ar RL=powerpc-eabi-ranlib CFLAGS="-O2 -g -DGEKKO -mrvl -mcpu=750 -meabi -mhard-float -I/workspace/host-reference-gx -DMBEDTLS_CONFIG_FILE=\\\"mbedtls-gamecube-config.h\\\""'
  mkdir -p "$mbedtls_stage/include" "$mbedtls_stage/lib"
  cp -R "$mbedtls_dir/include/mbedtls" "$mbedtls_stage/include/"
  cp -R "$mbedtls_dir/include/psa" "$mbedtls_stage/include/"
  cp "$mbedtls_dir/library/libmbedtls.a" \
    "$mbedtls_dir/library/libmbedx509.a" \
    "$mbedtls_dir/library/libmbedcrypto.a" \
    "$mbedtls_stage/lib/"
  cp "$mbedtls_dir/LICENSE" "$mbedtls_stage/"
  printf '%s\n' "$mbedtls_input" >"$mbedtls_stamp"
fi

echo "Native SDK $NATIVE_SDK_COMMIT, libogc2 $LIBOGC2_COMMIT, MPlayer CE $MPLAYER_CE_LIBOGC2_COMMIT, Mbed TLS $MBEDTLS_COMMIT, and Zig $ZIG_VERSION are ready."
