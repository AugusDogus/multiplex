#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
elf_path=${GAMECUBE_ELF:-$spike_dir/multiplex-gamecube-hardware-debug.elf}

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 0x80123456 [0x80123478 ...]" >&2
  echo "Set GAMECUBE_ELF to symbolize a different exact build." >&2
  exit 2
fi
if [ ! -s "$elf_path" ]; then
  echo "Missing ELF with symbols: $elf_path" >&2
  echo "Build it with bun run spike:gamecube:hardware-debug:dol." >&2
  exit 1
fi
if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

case "$elf_path" in
  "$spike_dir"/*) elf_in_container=/workspace/${elf_path#"$spike_dir"/} ;;
  *)
    echo "GAMECUBE_ELF must point inside $spike_dir." >&2
    exit 2
    ;;
esac

podman run --rm \
  --volume "$spike_dir:/workspace:Z" \
  "$DEVKITPPC_IMAGE" \
  /opt/devkitpro/devkitPPC/bin/powerpc-eabi-addr2line \
  --exe="$elf_in_container" --functions --demangle "$@"
