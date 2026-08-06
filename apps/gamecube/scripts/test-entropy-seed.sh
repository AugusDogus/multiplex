#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-entropy-seed.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

cc -std=c11 -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/entropy_seed.c" \
  "$app_dir/tests/entropy_seed_test.c" \
  -o "$test_binary"
"$test_binary"
