#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

sh "$script_dir/lint.sh"
sh "$script_dir/meson.sh" analyze
sh "$script_dir/test-portable.sh"
sh "$script_dir/test-sanitize.sh"

echo "GameCube app checks passed."
