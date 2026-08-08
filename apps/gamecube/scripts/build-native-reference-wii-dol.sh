#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

MULTIPLEX_PLATFORM=wii sh "$script_dir/build-native-reference-dol.sh"
