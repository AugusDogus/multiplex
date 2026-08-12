#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp)
trap 'rm -f "$test_binary"' EXIT INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/mpeg_ts_parser.c" \
  "$app_dir/tests/mpeg_ts_parser_test.c" \
  -o "$test_binary"
"$test_binary"
if [ "$#" -eq 1 ]; then
  "$test_binary" "$1"
fi
