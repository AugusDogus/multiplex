#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-reference-frame.XXXXXX")
trap 'rm -f "$test_binary"' EXIT INT TERM

cc -std=c11 -Wall -Wextra -Werror \
  -I"$spike_dir/host" \
  -I"$spike_dir/host-reference" \
  "$spike_dir/host-reference/reference_frame.c" \
  "$spike_dir/tests/reference_frame_test.c" \
  -o "$test_binary"
"$test_binary"
