#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
ui_dir="$repo_dir/packages/console-ui"

if [ "${MULTIPLEX_GAMECUBE_UV_ACTIVE:-0}" != 1 ]; then
  exec sh "$script_dir/run-with-tooling.sh" sh "$0" "$@"
fi

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

required_shellcheck_py_version=$(
  sed -n 's/^[[:space:]]*"shellcheck-py==\([0-9.]*\)",[[:space:]]*$/\1/p' \
    "$app_dir/pyproject.toml"
)
required_shellcheck_version=${required_shellcheck_py_version%.*}
if [ -z "$required_shellcheck_version" ] ||
  [ "$required_shellcheck_version" = "$required_shellcheck_py_version" ]; then
  echo "Missing an exact shellcheck-py version in $app_dir/pyproject.toml." >&2
  exit 1
fi
actual_shellcheck_version=$(
  "$shellcheck" --version | awk '/^version:/ { print $2 }'
)
if [ "$actual_shellcheck_version" != "$required_shellcheck_version" ]; then
  echo "ShellCheck $required_shellcheck_version is required; found $actual_shellcheck_version." >&2
  echo "Run 'bun run gamecube:setup' to restore the locked toolchain." >&2
  exit 1
fi

find \
  "$app_dir/host" \
  "$app_dir/host-bba-diagnostics" \
  "$app_dir/host-raylib" \
  "$app_dir/host-reference-gx" \
  "$ui_dir/include" \
  "$ui_dir/reference-frame" \
  "$ui_dir/tests" \
  "$app_dir/tests" \
  -type f \( -name '*.c' -o -name '*.h' \) \
  -exec "$clang_format" --style=file --dry-run --Werror {} +

"$zig" fmt --check \
  "$ui_dir/build.zig" \
  "$ui_dir/src/console_ui.zig"

find "$script_dir" -maxdepth 1 -type f -name '*.sh' \
  -exec "$shellcheck" \
  -e SC1007,SC1112,SC2016,SC2119,SC2120,SC2317,SC2329 {} +

"$ruff" check "$script_dir"
"$ruff" format --check "$script_dir"

echo "GameCube native lint passed."
