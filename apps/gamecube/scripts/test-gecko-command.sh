#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-gecko-command.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

set --
if [ "${MULTIPLEX_TEST_SANITIZERS:-0}" = 1 ]; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer
fi
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic "$@" \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/gecko_command.c" \
  "$app_dir/tests/gecko_command_test.c" -o "$test_binary"
"$test_binary"
