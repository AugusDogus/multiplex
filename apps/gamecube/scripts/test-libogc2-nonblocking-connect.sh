#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

source_dir="$app_dir/.libogc2"
patch_file="$app_dir/patches/libogc2-flush-tcp-writes.patch"
if [ ! -d "$source_dir/.git" ]; then
  echo "Run $script_dir/bootstrap.sh before the libogc2 patch regression." >&2
  exit 1
fi
if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required for the libogc2 patch regression." >&2
  exit 1
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-libogc2-patch.XXXXXX")
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

checkout="$work_dir/libogc2"
git -c advice.detachedHead=false clone --quiet --no-hardlinks \
  "$source_dir" "$checkout"
git -c advice.detachedHead=false -C "$checkout" checkout --quiet --detach \
  "$LIBOGC2_COMMIT"
if [ "$(git -C "$checkout" rev-parse HEAD)" != "$LIBOGC2_COMMIT" ] ||
  [ -n "$(git -C "$checkout" status --porcelain)" ]; then
  echo "Fresh libogc2 checkout does not match $LIBOGC2_COMMIT." >&2
  exit 1
fi

git -C "$checkout" apply --check "$patch_file"
git -C "$checkout" apply "$patch_file"
python "$script_dir/check-libogc2-nonblocking-connect.py" \
  "$checkout/lwip/network.c"

podman run --rm \
  --volume "$checkout:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -ec 'export DEVKITPRO="/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; make -j2 cube wii'

echo "Fresh pinned libogc2 patch and Cube/Wii builds passed."
