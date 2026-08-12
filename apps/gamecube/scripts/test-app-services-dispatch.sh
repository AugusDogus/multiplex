#!/bin/sh
set -eu

set --
if [ "${MULTIPLEX_TEST_SANITIZERS:-0}" = 1 ]; then
  set -- -fsanitize=address,undefined -fno-omit-frame-pointer
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/multiplex-app-services-dispatch.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
printf '%s\n' \
  '#ifndef MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_MEDIA_SOURCE_H' \
  '#define MULTIPLEX_PAIRING_ENABLED 0' \
  '#endif' >"$test_dir/media-source.h"
run_test() {
  test_binary="$test_dir/$1.test"
  test_source=$2
  shift 2
  "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
    "$@" \
    -I"$test_dir" \
    -I"$app_dir/host" \
    -I"$repo_dir/packages/console-ui/include" \
    -I"$runtime_dir/src" \
    -I"$app_dir/build-native-reference" \
    "$runtime_dir/src/app_services.c" \
    "$runtime_dir/src/app_services_policy.c" \
    "$runtime_dir/src/app_services_request_slots.c" \
    "$runtime_dir/src/app_services_scheduler.c" \
    "$app_dir/tests/app_services_dispatch_test_support.c" \
    "$app_dir/tests/app_services_dispatch_watch_test_support.c" \
    "$app_dir/tests/$test_source" \
    -o "$test_binary"
  "$test_binary"
}

run_test poster-scheduler app_services_poster_scheduler_test.c "$@"
run_test facade-routing app_services_dispatch_test.c "$@"
