#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

cxbx_dir="$app_dir/.cxbx"
archive_path="$cxbx_dir/CxbxReloaded-Release.zip"
release_dir="$cxbx_dir/release"
source_url="https://github.com/Cxbx-Reloaded/Cxbx-Reloaded/releases/download/$CXBXR_RELEASE/CxbxReloaded-Release.zip"

mkdir -p "$cxbx_dir"
if [ ! -f "$archive_path" ] || ! printf '%s  %s\n' "$CXBXR_SHA256" "$archive_path" | sha256sum --check --status; then
  partial_path="$archive_path.partial"
  curl --fail --location --retry 3 --output "$partial_path" "$source_url"
  printf '%s  %s\n' "$CXBXR_SHA256" "$partial_path" | sha256sum --check --status
  mv "$partial_path" "$archive_path"
fi

if [ ! -f "$release_dir/cxbxr-ldr.exe" ]; then
  rm -rf "$release_dir"
  mkdir -p "$release_dir"
  unzip -q "$archive_path" -d "$release_dir"
fi

test -s "$release_dir/cxbxr-ldr.exe"
echo "Cxbx-Reloaded $CXBXR_RELEASE is ready."
