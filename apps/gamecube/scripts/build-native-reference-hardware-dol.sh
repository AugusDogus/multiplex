#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

sh "$script_dir/bootstrap-libogc2-hardware.sh"
LIBOGC2_STAGE_NAME=.libogc2-hardware-stage \
  sh "$script_dir/build-native-reference-dol.sh"
