#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT INT TERM

cc -std=c11 -Wall -Wextra -Werror \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/memory_card_presentation.c" \
  "$app_dir/tests/memory_card_presentation_test.c" \
  -o "$build_dir/memory-card-presentation-test"

"$build_dir/memory-card-presentation-test"
