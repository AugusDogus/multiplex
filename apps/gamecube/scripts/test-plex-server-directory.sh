#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp)
trap 'rm -f "$test_binary"' EXIT INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/plex_server_directory.c" \
  "$app_dir/tests/plex_server_directory_test.c" \
  -o "$test_binary"
"$test_binary"
