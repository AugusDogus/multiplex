#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to prepare the pinned devkitPPC toolchain." >&2
  exit 1
fi

cache_dir="$app_dir/.ci-cache"
image_archive="$cache_dir/devkitppc-image.tar"
mkdir -p "$cache_dir"

if [ -s "$image_archive" ]; then
  podman load --input "$image_archive"
  # Digest-only references are not retained by Docker archives. Re-pull the
  # pinned manifest after loading the cached layers to restore that identity.
  podman pull "$DEVKITPPC_IMAGE"
else
  podman pull "$DEVKITPPC_IMAGE"
  temporary_archive="$image_archive.tmp"
  trap 'rm -f "$temporary_archive"' EXIT HUP INT TERM
  podman save --format docker-archive --output "$temporary_archive" \
    "$DEVKITPPC_IMAGE"
  mv "$temporary_archive" "$image_archive"
  trap - EXIT HUP INT TERM
fi

podman image exists "$DEVKITPPC_IMAGE"
echo "Pinned devkitPPC toolchain is ready."
