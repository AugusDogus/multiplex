#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
ui_dir="$repo_dir/packages/console-ui"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"
# shellcheck disable=SC1091
. "$repo_dir/apps/gamecube/PINS.env"

actual_zig=$(zig version)
if [ "$actual_zig" != "$ZIG_VERSION" ]; then
  echo "Zig $ZIG_VERSION is required; found $actual_zig." >&2
  exit 1
fi

sdk_dir="$ui_dir/.native-sdk"
if [ ! -d "$sdk_dir/.git" ]; then
  if [ -e "$sdk_dir" ]; then
    echo "$sdk_dir exists but is not a Native SDK git checkout." >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout \
    https://github.com/vercel-labs/native.git "$sdk_dir"
  git -C "$sdk_dir" checkout --detach "$NATIVE_SDK_COMMIT"
fi

actual_sdk_commit=$(git -C "$sdk_dir" rev-parse HEAD)
if [ "$actual_sdk_commit" != "$NATIVE_SDK_COMMIT" ]; then
  echo "Native SDK is at $actual_sdk_commit; expected $NATIVE_SDK_COMMIT." >&2
  exit 1
fi

for patch_file in "$ui_dir"/patches/*.patch; do
  if git -C "$sdk_dir" apply --unidiff-zero --reverse --check "$patch_file" >/dev/null 2>&1; then
    continue
  fi
  if git -C "$sdk_dir" apply --unidiff-zero --check "$patch_file"; then
    git -C "$sdk_dir" apply --unidiff-zero "$patch_file"
    continue
  fi
  echo "Native SDK patch does not apply cleanly: $patch_file" >&2
  exit 1
done
npm ci --prefix "$sdk_dir/packages/core"

nxdk_dir="$app_dir/.nxdk"
if [ ! -d "$nxdk_dir/.git" ]; then
  if [ -e "$nxdk_dir" ]; then
    echo "$nxdk_dir exists but is not an nxdk git checkout." >&2
    exit 1
  fi
  git clone --filter=blob:none --no-checkout \
    https://github.com/XboxDev/nxdk.git "$nxdk_dir"
  git -C "$nxdk_dir" checkout --detach "$NXDK_COMMIT"
fi

actual_nxdk_commit=$(git -C "$nxdk_dir" rev-parse HEAD)
if [ "$actual_nxdk_commit" != "$NXDK_COMMIT" ]; then
  echo "nxdk is at $actual_nxdk_commit; expected $NXDK_COMMIT." >&2
  exit 1
fi
git -C "$nxdk_dir" submodule update --init --depth 1

"$script_dir/build-codecs.sh"

echo "Native SDK $NATIVE_SDK_COMMIT, nxdk $NXDK_COMMIT, FFmpeg $MPLAYER_CE_LIBOGC2_COMMIT, and Zig $ZIG_VERSION are ready."
