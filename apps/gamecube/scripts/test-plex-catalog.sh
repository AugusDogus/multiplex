#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp)
trap 'rm -f "$test_binary"' EXIT INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -ffunction-sections \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/plex_catalog.c" \
  "$app_dir/tests/plex_catalog_test.c" \
  -Wl,--gc-sections \
  -o "$test_binary"
"$test_binary"
