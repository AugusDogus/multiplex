#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ui_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
output=${1:-"$ui_dir/zig-out/reference-frame.rgba"}
exporter="$ui_dir/zig-out/export-reference-frame"

cd "$ui_dir"
zig build host-core
mkdir -p "$(dirname -- "$output")"
cc -O2 -Wall -Wextra -Werror \
  -I"$ui_dir/include" \
  "$ui_dir/reference-frame/export_frame.c" \
  "$ui_dir/zig-out/lib/libmultiplex-console-ui-host.a" \
  -lm -no-pie -o "$exporter"
"$exporter" "$output"

test "$(wc -c <"$output")" -eq 1228800
