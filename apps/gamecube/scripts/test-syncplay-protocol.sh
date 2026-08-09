#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-syncplay-protocol.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

sanitize_flags=""
if [ "${1:-}" = "--sanitize" ]; then
  sanitize_flags="-fsanitize=address,undefined -fno-omit-frame-pointer"
elif [ "${1:-}" != "" ]; then
  echo "usage: $0 [--sanitize]" >&2
  exit 2
fi

# shellcheck disable=SC2086
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
  ${sanitize_flags} \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/syncplay_protocol.c" \
  "$app_dir/tests/syncplay_protocol_test.c" \
  -o "$test_binary"
"$test_binary"
