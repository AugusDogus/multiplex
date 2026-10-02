#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ui_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
output=${1:-"$ui_dir/zig-out/reference.scene"}
exporter="$ui_dir/zig-out/export-scene"

cd "$ui_dir"
zig build host-core
mkdir -p "$(dirname -- "$output")"
cc -std=c11 -O2 -Wall -Wextra -Werror \
  -I"$ui_dir/include" \
  "$ui_dir/scene/console_scene.c" \
  "$ui_dir/scene/export_scene.c" \
  "$ui_dir/zig-out/lib/libmultiplex-console-ui-host.a" \
  -lm -no-pie -o "$exporter"
"$exporter" "$output"

test -s "$output"
