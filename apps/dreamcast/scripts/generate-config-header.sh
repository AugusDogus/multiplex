#!/bin/sh
set -eu

output=$1
gateway_url=${DREAMCAST_GATEWAY_URL:-}

if [ -n "$gateway_url" ] &&
  ! printf '%s' "$gateway_url" | LC_ALL=C grep -Eq \
    '^http://[A-Za-z0-9._-]+(:[0-9]+)?$'; then
  echo "DREAMCAST_GATEWAY_URL must be an HTTP origin without a path." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$output")"
temporary="$output.tmp"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
{
  printf '%s\n' '#ifndef MULTIPLEX_DREAMCAST_CONFIG_H'
  printf '%s\n' '#define MULTIPLEX_DREAMCAST_CONFIG_H'
  printf '#define DREAMCAST_GATEWAY_URL "%s"\n' "$gateway_url"
  printf '%s\n' '#endif'
} >"$temporary"

if [ -f "$output" ] && cmp -s "$temporary" "$output"; then
  rm "$temporary"
else
  mv "$temporary" "$output"
fi
trap - EXIT HUP INT TERM
