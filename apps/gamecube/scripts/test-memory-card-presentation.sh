#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/memory_card_presentation.c" \
  "$app_dir/tests/memory_card_presentation_test.c" \
  -o "$build_dir/memory-card-presentation-test"

"$build_dir/memory-card-presentation-test"
