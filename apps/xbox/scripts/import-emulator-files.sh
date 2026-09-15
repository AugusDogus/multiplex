#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
archive=${1:-${XBOX_EMULATOR_FILES_ARCHIVE:-}}

if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "Pass the path to an Xbox-Emulator-Files.zip archive." >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

temporary_dir=$(mktemp -d)
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

unzip -p "$archive" mcpx/mcpx_1.0.bin >"$temporary_dir/mcpx_1.0.bin"
unzip -p "$archive" bios/Complex_4627.bin >"$temporary_dir/Complex_4627.bin"

actual_mcpx_md5=$(md5sum "$temporary_dir/mcpx_1.0.bin" | cut -d ' ' -f 1)
if [ "$actual_mcpx_md5" != "$XEMU_MCPX_MD5" ]; then
  echo "MCPX dump has MD5 $actual_mcpx_md5; xemu requires $XEMU_MCPX_MD5." >&2
  exit 1
fi

bios_size=$(wc -c <"$temporary_dir/Complex_4627.bin")
if [ "$bios_size" -ne 1048576 ]; then
  echo "Complex 4627 BIOS must be 1048576 bytes; found $bios_size." >&2
  exit 1
fi

firmware_dir="$app_dir/.xemu/firmware"
mkdir -p "$firmware_dir"
install -m 600 "$temporary_dir/mcpx_1.0.bin" "$firmware_dir/mcpx_1.0.bin"
install -m 600 "$temporary_dir/Complex_4627.bin" "$firmware_dir/Complex_4627.bin"

echo "Imported validated xemu firmware into $firmware_dir."
