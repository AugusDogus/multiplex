#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
elf_path=${GAMECUBE_ELF:-$app_dir/multiplex-gamecube-native-reference-hardware.elf}

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 0x80123456 [0x80123478 ...]" >&2
  echo "Set GAMECUBE_ELF to symbolize a different exact build." >&2
  exit 2
fi
if [ ! -s "$elf_path" ]; then
  echo "Missing ELF with symbols: $elf_path" >&2
  echo "Build it with bun run gamecube:reference:hardware-dol." >&2
  exit 1
fi
if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

case "$elf_path" in
  "$app_dir"/*) elf_in_container=/workspace/${elf_path#"$app_dir"/} ;;
  *)
    echo "GAMECUBE_ELF must point inside $app_dir." >&2
    exit 2
    ;;
esac

podman run --rm \
  --volume "$app_dir:/workspace:Z" \
  "$DEVKITPPC_IMAGE" \
  /opt/devkitpro/devkitPPC/bin/powerpc-eabi-addr2line \
  --exe="$elf_in_container" --functions --demangle "$@"
