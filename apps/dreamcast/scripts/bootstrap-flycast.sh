#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

for command in curl sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to install Flycast." >&2
    exit 1
  fi
done

flycast_dir="$app_dir/.flycast"
flycast_appimage="$flycast_dir/flycast.AppImage"
flycast_url="https://github.com/flyinghead/flycast/releases/download/$FLYCAST_VERSION/flycast-x86_64.AppImage"

mkdir -p "$flycast_dir"
if [ ! -s "$flycast_appimage" ]; then
  partial_appimage="$flycast_appimage.partial"
  trap 'rm -f "$partial_appimage"' EXIT HUP INT TERM
  curl --fail --location --retry 3 --output "$partial_appimage" \
    "$flycast_url"
  mv "$partial_appimage" "$flycast_appimage"
  trap - EXIT HUP INT TERM
fi
printf '%s  %s\n' "$FLYCAST_APPIMAGE_SHA256" "$flycast_appimage" |
  sha256sum --check --status
chmod +x "$flycast_appimage"

if [ ! -x "$flycast_dir/squashfs-root/AppRun" ]; then
  (cd "$flycast_dir" && ./flycast.AppImage --appimage-extract >/dev/null)
fi

test -x "$flycast_dir/squashfs-root/AppRun"
echo "Flycast $FLYCAST_VERSION is ready."
