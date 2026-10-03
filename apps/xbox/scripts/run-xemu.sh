#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

default_mcpx_path="$app_dir/.xemu/firmware/mcpx_1.0.bin"
default_bios_path="$app_dir/.xemu/firmware/Complex_4627.bin"
XEMU_MCPX_PATH=${XEMU_MCPX_PATH:-$default_mcpx_path}
XEMU_BIOS_PATH=${XEMU_BIOS_PATH:-$default_bios_path}

: "${XEMU_MCPX_PATH:?Set XEMU_MCPX_PATH to a legal MCPX dump from your Xbox.}"
: "${XEMU_BIOS_PATH:?Set XEMU_BIOS_PATH to a legal debug or modded BIOS dump from your Xbox.}"

"$script_dir/bootstrap-emulator.sh"
"$script_dir/build-iso.sh"

canonical_path() {
  local input_path=$1
  local label=$2
  local resolved_path

  if [ ! -f "$input_path" ]; then
    echo "$label does not exist at $input_path." >&2
    exit 1
  fi
  resolved_path=$(realpath "$input_path")
  case "$resolved_path" in
  *\'* | *\\*)
    echo "$label path contains a character unsupported by the xemu config renderer: $resolved_path" >&2
    exit 1
    ;;
  esac
  printf '%s\n' "$resolved_path"
}

MULTIPLEX_XEMU_MCPX_PATH=$(canonical_path "$XEMU_MCPX_PATH" "MCPX dump")
MULTIPLEX_XEMU_BIOS_PATH=$(canonical_path "$XEMU_BIOS_PATH" "BIOS dump")
actual_mcpx_md5=$(md5sum "$MULTIPLEX_XEMU_MCPX_PATH" | cut -d ' ' -f 1)
if [ "$actual_mcpx_md5" != "$XEMU_MCPX_MD5" ]; then
  echo "MCPX dump has MD5 $actual_mcpx_md5; xemu requires $XEMU_MCPX_MD5." >&2
  exit 1
fi

emulator_dir="$app_dir/.xemu"
emulator_data_dir="$emulator_dir/data"
work_hdd="$emulator_dir/xbox_hdd.work.qcow2"
if [ ! -f "$work_hdd" ]; then
  cp --reflink=auto "$emulator_dir/xbox_hdd.qcow2" "$work_hdd"
fi

MULTIPLEX_XEMU_EEPROM_PATH=$(canonical_path "$emulator_data_dir/xemu/xemu/eeprom.bin" "Generated EEPROM")
MULTIPLEX_XEMU_HDD_PATH=$(canonical_path "$work_hdd" "Xbox hard disk")
MULTIPLEX_XEMU_DVD_PATH=$(canonical_path "${XEMU_DVD_PATH:-$app_dir/Multiplex.iso}" "Xbox XISO")
export MULTIPLEX_XEMU_MCPX_PATH MULTIPLEX_XEMU_BIOS_PATH
export MULTIPLEX_XEMU_EEPROM_PATH MULTIPLEX_XEMU_HDD_PATH MULTIPLEX_XEMU_DVD_PATH

config_path="$emulator_dir/multiplex-xemu.toml"
envsubst <"$app_dir/xemu.template.toml" >"$config_path"

exec env XDG_DATA_HOME="$emulator_data_dir" \
  "$emulator_dir/xemu.AppImage" \
  -config_path "$config_path" \
  "$@"
