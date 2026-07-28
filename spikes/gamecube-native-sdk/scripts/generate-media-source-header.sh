#!/bin/sh
set -eu

output=$1
media_url=${GAMECUBE_MEDIA_URL:-}

if [ -n "$media_url" ] &&
  printf '%s' "$media_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "GAMECUBE_MEDIA_URL contains unsupported characters." >&2
  exit 1
fi

temporary="$output.tmp"
trap 'rm -f "$temporary"' EXIT INT TERM
{
  printf '%s\n' '#ifndef MULTIPLEX_MEDIA_SOURCE_H'
  printf '%s\n' '#define MULTIPLEX_MEDIA_SOURCE_H'
  printf '#define MULTIPLEX_MEDIA_URL "%s"\n' "$media_url"
  printf '%s\n' '#endif'
} >"$temporary"

if [ -f "$output" ] && cmp -s "$temporary" "$output"; then
  rm "$temporary"
else
  mv "$temporary" "$output"
fi
trap - EXIT INT TERM
