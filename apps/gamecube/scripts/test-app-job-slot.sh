#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-app-job-slot.XXXXXX")
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
  sanitizer_flags="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all"
else
  sanitizer_flags=""
fi

# shellcheck disable=SC2086
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
  ${sanitizer_flags} \
  -I"$app_dir/host-reference-gx" \
  "$app_dir/host-reference-gx/app_job_slot.c" \
  "$app_dir/tests/app_job_slot_test.c" \
  -o "$test_binary"
if $sanitize; then
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$test_binary"
else
  "$test_binary"
fi
