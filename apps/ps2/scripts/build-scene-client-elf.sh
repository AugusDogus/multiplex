#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
build_dir="$app_dir/build-scene-client"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

scene_host=${MULTIPLEX_PS2_SCENE_HOST:-}
scene_port=${MULTIPLEX_PS2_SCENE_PORT:-18195}
case "$scene_host" in
  *[!0-9.]* | "")
    echo "MULTIPLEX_PS2_SCENE_HOST must be an IPv4 address." >&2
    exit 1
    ;;
esac
case "$scene_port" in
  *[!0-9]* | "")
    echo "MULTIPLEX_PS2_SCENE_PORT must be a decimal port." >&2
    exit 1
    ;;
esac

mkdir -p "$build_dir"
python3 "$script_dir/generate-font-atlas.py" \
  "$repo_dir/packages/console-ui/.native-sdk/src/primitives/canvas/fonts/Geist-Regular.ttf" \
  "$build_dir/geist_atlas.h"
cat >"$build_dir/scene_client_config.h" <<EOF
#ifndef MULTIPLEX_PS2_SCENE_CLIENT_CONFIG_H
#define MULTIPLEX_PS2_SCENE_CLIENT_CONFIG_H
#define MULTIPLEX_SCENE_HOST "$scene_host"
#define MULTIPLEX_SCENE_PORT $scene_port
#endif
EOF

podman run --rm \
  --volume "$repo_dir:/workspace:Z" \
  --workdir /workspace/apps/ps2 \
  "$PS2DEV_IMAGE" \
  sh scripts/build-scene-client-in-container.sh

output="$app_dir/multiplex-ps2-scene-client.elf"
test -s "$output"
file "$output"
echo "PlayStation 2 scene client is ready at $output."
