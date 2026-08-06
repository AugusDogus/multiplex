#!/bin/sh
set -eu

sanitizer_cc=${GAMECUBE_SANITIZER_CC:-clang}

exec "$sanitizer_cc" \
  -fsanitize=address,undefined \
  -fno-omit-frame-pointer \
  -fno-sanitize-recover=all \
  "$@"
