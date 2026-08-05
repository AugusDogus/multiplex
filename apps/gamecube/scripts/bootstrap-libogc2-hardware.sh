#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

source_dir="$app_dir/.libogc2-hardware"
stage_dir="$app_dir/.libogc2-hardware-stage"
patch_file="$app_dir/patches/libogc2-limit-bba-tcp-receive-window.patch"
stage_library="$stage_dir/opt/devkitpro/libogc2/gamecube/lib/libogc.a"
stamp="$stage_dir/.build-input"
build_input="$LIBOGC2_COMMIT $(cksum "$patch_file")"

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
  echo "Hardware libogc2 checkout is at $actual_commit; expected $LIBOGC2_COMMIT" >&2
  exit 1
fi
if git -C "$source_dir" apply --reverse --check "$patch_file" \
  >/dev/null 2>&1; then
  git -C "$source_dir" apply --reverse "$patch_file"
  if ! git -C "$source_dir" diff --quiet ||
    [ -n "$(git -C "$source_dir" ls-files --others --exclude-standard)" ]; then
    git -C "$source_dir" apply "$patch_file"
    echo "Hardware libogc2 checkout contains unverified local changes." >&2
    exit 1
  fi
elif ! git -C "$source_dir" diff --quiet ||
  [ -n "$(git -C "$source_dir" ls-files --others --exclude-standard)" ]; then
  echo "Hardware libogc2 checkout contains unverified local changes." >&2
  exit 1
fi
git -C "$source_dir" apply --check "$patch_file"
git -C "$source_dir" apply "$patch_file"

if [ ! -s "$stage_library" ] || [ ! -f "$stamp" ] ||
  [ "$(sed -n '1p' "$stamp")" != "$build_input" ]; then
  podman run --rm \
    --volume "$app_dir:/workspace:Z" \
    --workdir /workspace/.libogc2-hardware \
    "$DEVKITPPC_IMAGE" \
    sh -ec 'export DEVKITPRO=/opt/devkitpro; export DEVKITPPC=/opt/devkitpro/devkitPPC; make clean; make cube; stage=/workspace/.libogc2-hardware-stage/opt/devkitpro/libogc2; rm -rf "$stage"; mkdir -p "$stage/gamecube/lib"; cp -R include "$stage/gamecube/"; cp lib/cube/*.a "$stage/gamecube/lib/"; cp *_license.txt *_rules "$stage/"'
  printf '%s\n' "$build_input" >"$stamp"
fi
