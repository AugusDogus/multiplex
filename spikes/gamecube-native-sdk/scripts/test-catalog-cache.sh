#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-catalog-cache.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I"$spike_dir/host-reference-gx" \
  "$spike_dir/host-reference-gx/catalog_cache.c" \
  "$spike_dir/tests/catalog_cache_test.c" \
  -o "$test_binary"
"$test_binary"
