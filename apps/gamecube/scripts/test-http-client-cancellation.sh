#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-http-cancel.XXXXXX")
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

set -- -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/tests/http-client-stubs" -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/http_client.c" \
  "$app_dir/host-reference-gx/http_response.c" \
  "$app_dir/tests/http_client_cancellation_test.c"
if $sanitize; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer \
    -fno-sanitize-recover=all "$@"
fi
"${CC:-cc}" "$@" -o "$test_dir/http-client-cancellation"

if $sanitize; then
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$test_dir/http-client-cancellation"
else
  "$test_dir/http-client-cancellation"
fi
