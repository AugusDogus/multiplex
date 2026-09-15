#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
ui_dir="$repo_dir/packages/console-ui"
build_dir="$app_dir/build-native-reference"
frame="$build_dir/native-reference.rgba"
output="$app_dir/multiplex-ps2-native-reference.elf"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if [ ! -d "$ui_dir/.native-sdk/.git" ]; then
  echo "The pinned Native SDK checkout is missing; run bun run ps2:bootstrap first." >&2
  exit 1
fi
if ! command -v podman >/dev/null 2>&1 ||
  ! podman image exists "$PS2DEV_IMAGE"; then
  echo "The pinned PS2DEV image is missing; run bun run ps2:bootstrap first." >&2
  exit 1
fi

sh "$ui_dir/scripts/export-reference-frame.sh" "$frame"

podman run --rm \
  --volume "$repo_dir:/workspace:Z" \
  --workdir /workspace/apps/ps2 \
  "$PS2DEV_IMAGE" \
  sh scripts/build-in-container.sh

test -s "$output"
file "$output"
echo "PlayStation 2 reference ELF is ready at $output ($(wc -c <"$output") bytes)"
