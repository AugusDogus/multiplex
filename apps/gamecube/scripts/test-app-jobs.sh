#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-app-jobs.XXXXXX")
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

mkdir "$test_dir/include"
printf '%s\n' \
  '#ifndef MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_GATEWAY_URL ""' \
  '#define MULTIPLEX_BASE_URL ""' \
  '#endif' >"$test_dir/include/media-source.h"

compile_binary() {
  output=$1
  pairing=$2
  shift 2
  if $sanitize; then
    set -- -fsanitize=address,undefined -fno-omit-frame-pointer \
      -fno-sanitize-recover=all "$@"
  fi
  "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
    -DMULTIPLEX_PAIRING_ENABLED="$pairing" \
    -I"$test_dir/include" -I"$app_dir/host-reference-gx" \
    -I"$app_dir/host-reference" \
    "$app_dir/host-reference-gx/app_jobs.c" \
    "$app_dir/host-reference-gx/app_jobs_work.c" \
    "$app_dir/host-reference-gx/app_jobs_posters.c" \
    "$app_dir/host-reference-gx/app_jobs_prefetch.c" \
    "$app_dir/tests/app_jobs_test_support.c" \
    "$app_dir/tests/app_jobs_test_fakes.c" \
    "$@" -o "$output"
}

compile_binary "$test_dir/paired" 1 \
  "$app_dir/tests/app_jobs_test.c" \
  "$app_dir/tests/app_jobs_work_test.c" \
  "$app_dir/tests/app_jobs_posters_test.c" \
  "$app_dir/tests/app_jobs_prefetch_test.c" \
  "$app_dir/tests/app_jobs_lifecycle_test.c"

compile_binary "$test_dir/unpaired" 0 \
  "$app_dir/tests/app_jobs_unpaired_test.c"

if $sanitize; then
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 "$test_dir/paired"
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:strict_string_checks=1 \
    UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 "$test_dir/unpaired"
else
  "$test_dir/paired"
  "$test_dir/unpaired"
fi
