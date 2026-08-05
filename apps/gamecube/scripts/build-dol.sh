#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

sh "$script_dir/check.sh"

python3 "$script_dir/generate-font-atlas.py" \
  "$app_dir/.native-sdk/src/primitives/canvas/fonts/Geist-Regular.ttf" \
  "$app_dir/generated/geist_atlas.h"

podman run --rm \
  --volume "$app_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.gamecube'

test -s "$app_dir/multiplex-gamecube-legacy.dol"
readelf -sW "$app_dir/multiplex-gamecube-legacy.elf" |
  grep -q "multiplex_core_selection_after_next"

dol_size=$(wc -c <"$app_dir/multiplex-gamecube-legacy.dol")
echo "GameCube DOL is ready at $app_dir/multiplex-gamecube-legacy.dol ($dol_size bytes)"
