#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

"$script_dir/bootstrap-cxbx.sh"
"$app_dir/scripts/build-reference-xbe.sh"

cxbx_dir="$app_dir/.cxbx"
export WINEPREFIX="$cxbx_dir/wine"
export WINEDEBUG="${WINEDEBUG:--all}"
mkdir -p "$WINEPREFIX"

exec wine "$cxbx_dir/release/cxbxr-ldr.exe" \
  /load "$(winepath -w "$app_dir/multiplex-xbox-native-reference.xbe")" \
  "$@"
