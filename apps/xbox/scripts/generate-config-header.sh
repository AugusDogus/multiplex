#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
base_url=${MULTIPLEX_XBOX_BASE_URL:-${MULTIPLEX_BASE_URL:-}}

case "$base_url" in
"" | http://*) ;;
*)
  echo "MULTIPLEX_XBOX_BASE_URL must be empty or an HTTP URL; the Xbox transport does not support HTTPS yet." >&2
  exit 1
  ;;
esac
case "$base_url" in
*[!A-Za-z0-9:/._~%+-]*)
  echo "MULTIPLEX_XBOX_BASE_URL contains unsupported characters." >&2
  exit 1
  ;;
esac

temporary=$(mktemp "${TMPDIR:-/tmp}/multiplex-xbox-config.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT INT TERM
{
  echo '#ifndef MULTIPLEX_XBOX_GENERATED_CONFIG_H'
  echo '#define MULTIPLEX_XBOX_GENERATED_CONFIG_H'
  printf '#define MULTIPLEX_XBOX_BASE_URL "%s"\n' "$base_url"
  echo '#endif'
} >"$temporary"

if ! cmp -s "$temporary" "$app_dir/generated-config.h"; then
  cp "$temporary" "$app_dir/generated-config.h"
fi
