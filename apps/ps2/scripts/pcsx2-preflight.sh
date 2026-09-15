#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

emulator_dir="$app_dir/.pcsx2/$PCSX2_VERSION"
binary="$emulator_dir/squashfs-root/usr/bin/pcsx2-qt"
bios_path=$(sh "$script_dir/resolve-pcsx2-bios.sh")

if [ ! -x "$binary" ]; then
  echo "PCSX2 $PCSX2_VERSION is missing; run bun run ps2:emulator:bootstrap." >&2
  exit 1
fi
printf '%s\n' "$binary"
