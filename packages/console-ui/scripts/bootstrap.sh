#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ui_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
sdk_dir="$ui_dir/.native-sdk"
sdk_url="https://github.com/vercel-labs/native.git"

: "${NATIVE_SDK_COMMIT:?NATIVE_SDK_COMMIT is required}"
: "${ZIG_VERSION:?ZIG_VERSION is required}"

for command in git npm zig; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to bootstrap the console UI." >&2
    exit 1
  fi
done

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

apply_sdk_patch "$ui_dir/patches/native-sdk-single-threaded-canvas.patch"
apply_sdk_patch "$ui_dir/patches/native-sdk-reference-render-fast-paths.patch"
apply_sdk_patch "$ui_dir/patches/native-sdk-panel-focus-indicator.patch"

actual_zig=$(zig version)
if [ "$actual_zig" != "$ZIG_VERSION" ]; then
  echo "Zig $ZIG_VERSION is required; found $actual_zig" >&2
  exit 1
fi

npm ci --prefix "$sdk_dir/packages/core"
echo "Native SDK $NATIVE_SDK_COMMIT and Zig $ZIG_VERSION are ready."
