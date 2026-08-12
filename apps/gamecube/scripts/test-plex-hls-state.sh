#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-plex-hls-state.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

sanitize=false
if [ "$#" -gt 1 ]; then
  echo "usage: $0 [--sanitize]" >&2
  exit 2
elif [ "${1:-}" = "--sanitize" ]; then
  sanitize=true
elif [ "${1:-}" != "" ]; then
  echo "usage: $0 [--sanitize]" >&2
  exit 2
fi

if $sanitize; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer \
    -fno-sanitize-recover=all
else
  set --
fi

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic -pthread \
  "$@" \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/plex_hls_state.c" \
  "$app_dir/tests/plex_hls_state_test.c" \
  -o "$test_binary"
if $sanitize; then
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$test_binary"
else
  "$test_binary"
fi
