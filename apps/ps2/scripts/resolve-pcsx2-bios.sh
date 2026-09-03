#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
bios_config="$app_dir/.pcsx2/bios-path"
bios_path=${MULTIPLEX_PS2_BIOS:-}

if [ -z "$bios_path" ] && [ -r "$bios_config" ]; then
  IFS= read -r bios_path <"$bios_config"
fi
if [ -z "$bios_path" ]; then
  echo "No PS2 BIOS is configured. Run bun run ps2:emulator:configure-bios -- /absolute/path/to/bios.bin." >&2
  exit 1
fi
if [ ! -f "$bios_path" ] || [ ! -r "$bios_path" ]; then
  echo "The configured PS2 BIOS is not a readable regular file: $bios_path" >&2
  exit 1
fi
if [ "$(wc -c <"$bios_path")" -ne 4194304 ]; then
  echo "The configured PS2 BIOS is not 4 MiB: $bios_path" >&2
  exit 1
fi
case "$bios_path" in
  "$app_dir"/*)
    echo "The PS2 BIOS must remain outside the repository: $bios_path" >&2
    exit 1
    ;;
esac

printf '%s\n' "$bios_path"
