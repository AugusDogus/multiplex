#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
project_file="$app_dir/pyproject.toml"

required_uv_version=$(
  sed -n 's/^required-version = "==\([^"]*\)"$/\1/p' "$project_file"
)
if [ -z "$required_uv_version" ]; then
  echo "Missing an exact uv required-version in $project_file." >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "uv $required_uv_version is required for GameCube tooling." >&2
  echo "Install it from https://docs.astral.sh/uv/getting-started/installation/ and rerun this command." >&2
  exit 1
fi

actual_uv_version=$(uv --version | awk '{ print $2 }')
if [ "$actual_uv_version" != "$required_uv_version" ]; then
  echo "uv $required_uv_version is required; found $actual_uv_version." >&2
  echo "Install the pinned version and rerun this command. No project files were changed." >&2
  exit 1
fi

exec uv sync --project "$app_dir" --locked --all-groups
