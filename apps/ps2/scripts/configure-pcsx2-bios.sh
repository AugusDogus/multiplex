#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
bios_input=${1:-}

if [ -z "$bios_input" ]; then
  echo "Usage: bun run ps2:emulator:configure-bios -- /absolute/path/to/bios.bin" >&2
  exit 1
fi
if [ ! -f "$bios_input" ] || [ ! -r "$bios_input" ]; then
  echo "The PS2 BIOS is not a readable regular file: $bios_input" >&2
  exit 1
fi
if [ "$(wc -c <"$bios_input")" -ne 4194304 ]; then
  echo "The PS2 BIOS is not 4 MiB: $bios_input" >&2
  exit 1
fi

bios_dir=$(CDPATH= cd -- "$(dirname -- "$bios_input")" && pwd)
bios_path="$bios_dir/$(basename -- "$bios_input")"
case "$bios_path" in
  "$app_dir"/*)
    echo "The PS2 BIOS must remain outside the repository: $bios_path" >&2
    exit 1
    ;;
esac

config_dir="$app_dir/.pcsx2"
config_path="$config_dir/bios-path"
mkdir -p "$config_dir"
temporary_path="$config_path.tmp.$$"
trap 'rm -f "$temporary_path"' EXIT HUP INT TERM
printf '%s\n' "$bios_path" >"$temporary_path"
mv "$temporary_path" "$config_path"
trap - EXIT HUP INT TERM

echo "Configured the isolated PCSX2 profile to use: $bios_path"
echo "The BIOS remains outside the repository. No emulator was launched."
