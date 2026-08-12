#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-trpc-rooms.XXXXXX")
trap 'rm -f "$test_binary"' EXIT INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/trpc_rooms.c" \
  "$app_dir/tests/trpc_rooms_test.c" \
  -o "$test_binary"
"$test_binary"
