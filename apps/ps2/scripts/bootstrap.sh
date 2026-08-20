#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
ui_dir="$repo_dir/packages/console-ui"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

NATIVE_SDK_COMMIT="$NATIVE_SDK_COMMIT" ZIG_VERSION="$ZIG_VERSION" \
  sh "$ui_dir/scripts/bootstrap.sh"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned PS2DEV toolchain." >&2
  exit 1
fi
if ! podman image exists "$PS2DEV_IMAGE"; then
  podman pull "$PS2DEV_IMAGE"
fi

echo "PS2DEV $PS2DEV_REVISION and image $PS2DEV_IMAGE are ready."
