#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

if [ -n "${GAMECUBE_SANITIZER_CC:-}" ]; then
  if ! command -v "$GAMECUBE_SANITIZER_CC" >/dev/null 2>&1; then
    echo "$GAMECUBE_SANITIZER_CC is required for GameCube sanitizer tests." >&2
    exit 1
  fi
elif ! command -v zig >/dev/null 2>&1; then
  echo "Zig $ZIG_VERSION is required for GameCube sanitizer tests." >&2
  exit 1
elif [ "$(zig version)" != "$ZIG_VERSION" ]; then
  echo "Zig $ZIG_VERSION is required for sanitizer tests; found $(zig version)." >&2
  exit 1
fi

export CC="$script_dir/sanitize-cc.sh"
export ASAN_OPTIONS="detect_leaks=1:halt_on_error=1:strict_string_checks=1"
export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1"

sh "$script_dir/meson.sh" sanitize

for test_script in \
  test-catalog-cache.sh \
  test-memory-card-presentation.sh \
  test-plex-server-directory.sh \
  test-plex-catalog.sh \
  test-hls-playlist.sh \
  test-mpeg-ts-parser.sh \
  test-audio-buffer-queue.sh \
  test-trpc-rooms.sh \
  test-reference-frame.sh \
  test-gui-navigation.sh; do
  sh "$script_dir/$test_script"
done

echo "GameCube ASan and UBSan tests passed."
