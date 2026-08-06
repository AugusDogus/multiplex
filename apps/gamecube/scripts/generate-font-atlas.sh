#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
requirements_file="$app_dir/requirements.txt"

required_pillow_version=$(
  sed -n 's/^Pillow==\([^[:space:]]*\)$/\1/p' "$requirements_file"
)
if [ -z "$required_pillow_version" ]; then
  echo "Missing an exact Pillow version in $requirements_file." >&2
  exit 1
fi

if ! installed_pillow_version=$(
  python3 -c 'from PIL import __version__; print(__version__)' 2>/dev/null
); then
  echo "Pillow $required_pillow_version is required to generate the GameCube font atlas, but Pillow is not installed." >&2
  echo "Install it with: python3 -m pip install -r apps/gamecube/requirements.txt" >&2
  exit 1
fi
if [ "$installed_pillow_version" != "$required_pillow_version" ]; then
  echo "Pillow $required_pillow_version is required to generate the GameCube font atlas; found $installed_pillow_version." >&2
  echo "Install it with: python3 -m pip install -r apps/gamecube/requirements.txt" >&2
  exit 1
fi

case "${1:-}" in
  --check) exit 0 ;;
  "") ;;
  *)
    echo "usage: generate-font-atlas.sh [--check]" >&2
    exit 2
    ;;
esac

python3 "$script_dir/generate-font-atlas.py" \
  "$app_dir/.native-sdk/src/primitives/canvas/fonts/Geist-Regular.ttf" \
  "$app_dir/generated/geist_atlas.h"
