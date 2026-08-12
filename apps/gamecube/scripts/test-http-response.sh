#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-http-response.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

sanitize=false
if [ "${1:-}" = "--sanitize" ]; then
  sanitize=true
elif [ "${1:-}" != "" ]; then
  echo "usage: $0 [--sanitize]" >&2
  exit 2
fi

if $sanitize; then
  sanitizer_flags='-fsanitize=address,undefined -fno-omit-frame-pointer'
else
  sanitizer_flags=''
fi

# shellcheck disable=SC2086
${CC:-cc} -std=c11 -Wall -Wextra -Werror -pedantic $sanitizer_flags \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/http_response.c" \
  "$app_dir/tests/http_response_test.c" -o "$test_binary"
"$test_binary"
