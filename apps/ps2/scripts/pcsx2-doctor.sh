#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

binary=$(sh "$script_dir/pcsx2-preflight.sh")
bios_path=$(sh "$script_dir/resolve-pcsx2-bios.sh")
bios_sha256=$(sha256sum "$bios_path" | awk '{print $1}')

echo "PCSX2: $($binary -version 2>&1 | sed -n '1p')"
echo "BIOS: validated 4 MiB file (sha256 $bios_sha256)"
echo "Profile: isolated portable PCSX2 data directory"
echo "No emulator was launched."
