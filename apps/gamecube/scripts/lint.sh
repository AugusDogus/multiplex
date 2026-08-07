#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

clang_format=${CLANG_FORMAT:-clang-format}
zig=${ZIG:-zig}
shellcheck=${SHELLCHECK:-shellcheck}
ruff=${RUFF:-ruff}

for command_path in "$clang_format" "$zig" "$shellcheck" "$ruff"; do
  if ! command -v "$command_path" >/dev/null 2>&1; then
    echo "$command_path is required for GameCube linting." >&2
    exit 1
  fi
done

actual_shellcheck_version=$(
  "$shellcheck" --version | awk '/^version:/ { print $2 }'
)
if [ "$actual_shellcheck_version" != "$SHELLCHECK_VERSION" ]; then
  echo "ShellCheck $SHELLCHECK_VERSION is required; found $actual_shellcheck_version." >&2
  echo "Install the pinned version from apps/gamecube/PINS.env and rerun this command." >&2
  exit 1
fi

find \
  "$app_dir/host" \
  "$app_dir/host-bba-diagnostics" \
  "$app_dir/host-raylib" \
  "$app_dir/host-reference" \
  "$app_dir/host-reference-gx" \
  "$app_dir/tests" \
  -type f \( -name '*.c' -o -name '*.h' \) \
  -exec "$clang_format" --style=file --dry-run --Werror {} +

"$zig" fmt --check \
  "$app_dir/build.zig" \
  "$app_dir/src/gamecube_probe.zig"

find "$script_dir" -maxdepth 1 -type f -name '*.sh' \
  -exec "$shellcheck" \
  -e SC1007,SC1112,SC2016,SC2119,SC2120,SC2317,SC2329 {} +

"$ruff" check "$script_dir"
"$ruff" format --check "$script_dir"

echo "GameCube native lint passed."
