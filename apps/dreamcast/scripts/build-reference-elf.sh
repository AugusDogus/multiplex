#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
toolchain_dir="$app_dir/.dreamcast-toolchain"

if [[ ! -x "$toolchain_dir/sh-elf/bin/sh-elf-gcc" ||
      ! -f "$toolchain_dir/kos/environ.sh" ]]; then
  echo "Missing the pinned Dreamcast toolchain; run bun run dreamcast:bootstrap first." >&2
  exit 1
fi

set +u
# shellcheck disable=SC1091
source "$toolchain_dir/kos/environ.sh"
set -u
sh "$script_dir/generate-config-header.sh" "$app_dir/generated/config.h"
make --no-print-directory -f "$app_dir/Makefile.reference"

output="$app_dir/multiplex-dreamcast.elf"
test -s "$output"
file "$output"
echo "Dreamcast ELF is ready at $output ($(wc -c <"$output") bytes)"
