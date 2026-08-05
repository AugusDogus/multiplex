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

for dependency in \
  "$app_dir/.libogc2-stage/opt/devkitpro/libogc2/gamecube/lib/libogc.a" \
  "$app_dir/.opengx-build/libopengx.a" \
  "$app_dir/.raylib/src/libraylib.a"
do
  if [ ! -s "$dependency" ]; then
    echo "Missing pinned raylib presenter dependency: $dependency" >&2
    echo "Run the raylib/libogc2 bootstrap before building this experimental artifact." >&2
    exit 1
  fi
done

sh "$script_dir/check.sh"

podman run --rm \
  --volume "$app_dir:/workspace:Z" \
  --workdir /workspace \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/.libogc2-stage/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.raylib.gamecube'

test -s "$app_dir/multiplex-gamecube-raylib-reference.dol"

dol_size=$(wc -c <"$app_dir/multiplex-gamecube-raylib-reference.dol")
echo "Experimental raylib reference DOL is ready at $app_dir/multiplex-gamecube-raylib-reference.dol ($dol_size bytes)"
