#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
storage_output=$(mktemp "${TMPDIR:-/tmp}/multiplex-xbox-storage-test.XXXXXX")
auth_output=$(mktemp "${TMPDIR:-/tmp}/multiplex-xbox-auth-test.XXXXXX")
catalog_output=$(mktemp "${TMPDIR:-/tmp}/multiplex-xbox-catalog-test.XXXXXX")
trap 'rm -f -- "$storage_output" "$auth_output" "$catalog_output"' EXIT INT TERM

${CC:-cc} -std=c11 -D_GNU_SOURCE -Wall -Wextra -Werror \
  -I"$app_dir" \
  -I"$repo_dir/packages/console-core/include" \
  "$repo_dir/packages/console-core/src/auth_record.c" \
  "$app_dir/storage.c" \
  "$app_dir/tests/storage_test.c" \
  -o "$storage_output"
"$storage_output"

${CC:-cc} -std=c11 -Wall -Wextra -Werror \
  -I"$app_dir" \
  -I"$repo_dir/packages/console-core/include" \
  "$app_dir/gateway_auth.c" \
  "$app_dir/tests/gateway_auth_test.c" \
  -o "$auth_output"
"$auth_output"

${CC:-cc} -std=c11 -Wall -Wextra -Werror \
  -I"$app_dir" \
  "$app_dir/gateway_catalog.c" \
  "$app_dir/tests/gateway_catalog_test.c" \
  -o "$catalog_output"
"$catalog_output"

echo "Original Xbox portable tests passed."
