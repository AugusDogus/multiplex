#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-trpc-rooms.XXXXXX")
trap 'rm -f "$test_binary"' EXIT INT TERM

cc -std=c11 -Wall -Wextra -Werror \
  -I"$spike_dir/host-reference-gx" \
  "$spike_dir/host-reference-gx/trpc_rooms.c" \
  "$spike_dir/tests/trpc_rooms_test.c" \
  -o "$test_binary"
"$test_binary"
