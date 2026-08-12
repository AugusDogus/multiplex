#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
runtime_dir=$(CDPATH= cd -- "$app_dir/../../packages/libogc-gx" && pwd)
mbedtls_include=${GAMECUBE_MBEDTLS_INCLUDE_DIR:-$app_dir/.mbedtls-stage/include}
test_binary=$(mktemp)
trap 'rm -f "$test_binary"' EXIT INT TERM

if grep -En 'MBEDTLS_PRIVATE|next_merged' \
  "$runtime_dir/src/tls_client.c" \
  "$runtime_dir/src/x509_name_compare.c" \
  "$runtime_dir/src/x509_name_compare.h"; then
  echo "GameCube X.509 comparison accesses a private Mbed TLS field." >&2
  exit 1
fi

test -f "$mbedtls_include/mbedtls/x509.h"
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  -I"$runtime_dir/src" \
  -I"$mbedtls_include" \
  "$runtime_dir/src/x509_name_compare.c" \
  "$app_dir/tests/x509_name_compare_test.c" \
  -o "$test_binary"
"$test_binary"
