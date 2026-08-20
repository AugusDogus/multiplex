#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

for command in curl sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to bootstrap PCSX2." >&2
    exit 1
  fi
done

emulator_dir="$app_dir/.pcsx2/$PCSX2_VERSION"
appimage="$emulator_dir/pcsx2.AppImage"
binary="$emulator_dir/squashfs-root/usr/bin/pcsx2-qt"

mkdir -p "$emulator_dir"
if [ ! -s "$appimage" ] ||
  [ "$(sha256sum "$appimage" | awk '{print $1}')" != "$PCSX2_APPIMAGE_SHA256" ]; then
  curl -fL --retry 3 --output "$appimage.download" "$PCSX2_APPIMAGE_URL"
  actual_sha256=$(sha256sum "$appimage.download" | awk '{print $1}')
  if [ "$actual_sha256" != "$PCSX2_APPIMAGE_SHA256" ]; then
    echo "PCSX2 AppImage digest was $actual_sha256; expected $PCSX2_APPIMAGE_SHA256." >&2
    exit 1
  fi
  mv "$appimage.download" "$appimage"
  chmod +x "$appimage"
fi

if [ ! -x "$binary" ]; then
  (
    cd "$emulator_dir"
    "$appimage" --appimage-extract >/dev/null
  )
fi

actual_version=$(
  "$binary" -version 2>&1 |
    sed -n 's/^PCSX2 v//p' |
    sed -n '1p'
)
if [ "$actual_version" != "$PCSX2_VERSION" ]; then
  echo "PCSX2 reported version $actual_version; expected $PCSX2_VERSION." >&2
  exit 1
fi

echo "PCSX2 $PCSX2_VERSION is ready at $binary."
