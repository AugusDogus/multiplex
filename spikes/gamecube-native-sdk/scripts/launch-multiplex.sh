#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

exec /bin/sh "$script_dir/dolphin-qa.sh" launch
