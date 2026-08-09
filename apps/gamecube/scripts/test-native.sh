#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
mode=${1:-}

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 host|sanitize" >&2
  exit 2
fi

run_test_script_matrix() {
  while read -r scope test_script; do
    case "$scope" in
      all | "$mode") sh "$script_dir/$test_script" ;;
    esac
  done <<'EOF'
all test-catalog-cache.sh
all test-http-response.sh
all test-memory-card-presentation.sh
all test-memory-card-records.sh
host test-tls-ca.sh
all test-plex-server-directory.sh
all test-plex-catalog.sh
all test-hls-playlist.sh
all test-plex-hls-state.sh
all test-mpeg-ts-parser.sh
all test-audio-buffer-queue.sh
all test-playback-timeline-policy.sh
all test-playback-program-policy.sh
all test-trpc-rooms.sh
all test-reference-frame.sh
all test-gui-navigation.sh
all test-app-job-slot.sh
all test-syncplay-protocol.sh
EOF
}

run_host_tests() {
  python "$script_dir/test-plex-gateway.py"
  python "$script_dir/test-multiplex-pair.py"
  python "$script_dir/test-plex-pair.py"

  sh "$script_dir/meson.sh" test
  run_test_script_matrix

  cd "$app_dir"

  echo "Checking TypeScript reducer characterization..."
  bun test src/core.test.ts

  echo "Checking the TypeScript core and Native markup on the null platform..."
  zig build test -Dplatform=null

  echo "Compiling the generated core for the GameCube's PowerPC 750..."
  zig build gamecube-core

  test -s zig-out/lib/libmultiplex-gamecube-core.a
  file zig-out/lib/libmultiplex-gamecube-core.a

  echo "GameCube portable tests passed."
}

run_sanitizer_tests() {
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
  run_test_script_matrix

  echo "GameCube ASan and UBSan tests passed."
}

case "$mode" in
  host) run_host_tests ;;
  sanitize) run_sanitizer_tests ;;
  *)
    echo "Unknown native test mode '$mode'. Expected host or sanitize." >&2
    exit 2
    ;;
esac
