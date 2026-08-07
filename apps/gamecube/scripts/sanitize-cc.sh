#!/bin/sh
set -eu

if [ -n "${GAMECUBE_SANITIZER_CC:-}" ]; then
  exec "$GAMECUBE_SANITIZER_CC" \
    -fsanitize=address,undefined \
    -fno-omit-frame-pointer \
    -fno-sanitize-recover=all \
    "$@"
fi

exec zig cc \
  -fsanitize=address,undefined \
  -fno-omit-frame-pointer \
  -fno-sanitize-recover=all \
  "$@"
