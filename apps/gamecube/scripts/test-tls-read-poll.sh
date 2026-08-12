#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-tls-poll.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

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

set -- -std=c11 -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/tests/http-client-stubs" -I"$runtime_dir/src" \
  "$runtime_dir/src/tls_read_poll.c" \
  "$app_dir/tests/tls_read_poll_test.c"
if $sanitize; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer \
    -fno-sanitize-recover=all "$@"
fi
"${CC:-cc}" "$@" -o "$test_dir/tls-read-poll"

if $sanitize; then
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$test_dir/tls-read-poll"
else
  "$test_dir/tls-read-poll"
fi
