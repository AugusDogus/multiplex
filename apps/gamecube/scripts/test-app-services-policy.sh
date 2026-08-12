#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
test_binary=$(mktemp "${TMPDIR:-/tmp}/multiplex-app-services-policy.XXXXXX")
trap 'rm -f "$test_binary"' EXIT HUP INT TERM

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -pedantic \
  -I"$runtime_dir/src" \
  "$runtime_dir/src/app_services_policy.c" \
  "$app_dir/tests/app_services_policy_test.c" \
  -o "$test_binary"
"$test_binary"
