#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

MULTIPLEX_PLATFORM=wii sh \
  "$script_dir/../../gamecube/scripts/run-with-tooling.sh" sh \
  "$script_dir/../../../packages/libogc-gx/scripts/build-reference-dol.sh"
