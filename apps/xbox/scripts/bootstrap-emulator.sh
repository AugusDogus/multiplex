#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

emulator_dir="$app_dir/.xemu"
xemu_path="$emulator_dir/xemu.AppImage"
hdd_path="$emulator_dir/xbox_hdd.qcow2"
xemu_url="https://github.com/xemu-project/xemu/releases/download/v$XEMU_VERSION/xemu-$XEMU_VERSION-x86_64.AppImage"
hdd_url="https://github.com/xemu-project/xemu-dashboard/releases/download/v$XEMU_DASHBOARD_VERSION/xbox_hdd.qcow2"

mkdir -p "$emulator_dir"

download_and_verify() {
  output_path=$1
  source_url=$2
  expected_sha256=$3

  if [ -f "$output_path" ] && printf '%s  %s\n' "$expected_sha256" "$output_path" | sha256sum --check --status; then
    return
  fi

  partial_path="$output_path.partial"
  curl --fail --location --retry 3 --output "$partial_path" "$source_url"
  printf '%s  %s\n' "$expected_sha256" "$partial_path" | sha256sum --check --status
  mv "$partial_path" "$output_path"
}

download_and_verify "$xemu_path" "$xemu_url" "$XEMU_SHA256"
download_and_verify "$hdd_path" "$hdd_url" "$XEMU_HDD_SHA256"
chmod +x "$xemu_path"
emulator_data_dir="$emulator_dir/data"
env XDG_DATA_HOME="$emulator_data_dir" "$xemu_path" --version >/dev/null 2>&1

echo "xemu $XEMU_VERSION and dashboard HDD $XEMU_DASHBOARD_VERSION are ready."
echo "Set XEMU_MCPX_PATH and XEMU_BIOS_PATH to legal dumps from your Xbox before running emulator checks."
