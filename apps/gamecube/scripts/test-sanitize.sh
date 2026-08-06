#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v "${GAMECUBE_SANITIZER_CC:-clang}" >/dev/null 2>&1; then
  echo "${GAMECUBE_SANITIZER_CC:-clang} is required for GameCube sanitizer tests." >&2
  exit 1
fi

export CC="$script_dir/sanitize-cc.sh"
export ASAN_OPTIONS="detect_leaks=1:halt_on_error=1:strict_string_checks=1"
export UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1"

for test_script in \
  test-auth-record.sh \
  test-catalog-cache.sh \
  test-memory-card-presentation.sh \
  test-entropy-seed.sh \
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
