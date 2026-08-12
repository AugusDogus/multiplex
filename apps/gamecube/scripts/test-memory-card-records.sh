#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT INT TERM

compile_test() {
  "${CC:-cc}" -std=c11 -Wall -Wextra -Werror "$@" \
    -I"$runtime_dir/src" \
    "$runtime_dir/src/auth_record.c" \
    "$runtime_dir/src/memory_card_records.c" \
    "$app_dir/tests/memory_card_records_test.c" \
    -o "$build_dir/memory-card-records-test"
}

case "${1:-}" in
"")
  compile_test
  "$build_dir/memory-card-records-test"
  ;;
--sanitize)
  compile_test -fsanitize=address,undefined -fno-omit-frame-pointer \
    -fno-sanitize-recover=all
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$build_dir/memory-card-records-test"
  ;;
*)
  echo "usage: $0 [--sanitize]" >&2
  exit 2
  ;;
esac
