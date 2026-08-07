#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if [ "$#" -eq 0 ]; then
  echo "usage: run-with-tooling.sh command [argument ...]" >&2
  exit 2
fi

if [ "${MULTIPLEX_GAMECUBE_UV_ACTIVE:-0}" = 1 ]; then
  exec "$@"
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Run 'bun run gamecube:setup' from the repository root." >&2
  exit 1
fi

exec env MULTIPLEX_GAMECUBE_UV_ACTIVE=1 \
  uv run --project "$app_dir" --locked -- "$@"
