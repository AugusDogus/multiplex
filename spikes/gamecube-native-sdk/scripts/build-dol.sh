#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

sh "$script_dir/check.sh"

python3 "$script_dir/generate-font-atlas.py" \
  "$spike_dir/.native-sdk/src/primitives/canvas/fonts/Geist-Regular.ttf" \
  "$spike_dir/generated/geist_atlas.h"

podman run --rm \
  --volume "$spike_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.gamecube'

test -s "$spike_dir/multiplex-gamecube-spike.dol"
readelf -sW "$spike_dir/multiplex-gamecube-spike.elf" |
  grep -q "multiplex_core_selection_after_next"

dol_size=$(wc -c <"$spike_dir/multiplex-gamecube-spike.dol")
echo "GameCube DOL is ready at $spike_dir/multiplex-gamecube-spike.dol ($dol_size bytes)"
