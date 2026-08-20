#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
fixture_port=${MULTIPLEX_XBOX_FIXTURE_PORT:-39001}
fixture_log="$app_dir/xemu-catalog-fixture.log"
rm -f "$fixture_log"

env MULTIPLEX_XBOX_FIXTURE_PORT="$fixture_port" \
  bun "$script_dir/catalog-fixture.ts" >"$fixture_log" 2>&1 &
fixture_pid=$!
cleanup() {
  kill "$fixture_pid" 2>/dev/null || true
  wait "$fixture_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 100); do
  curl --fail --silent "http://127.0.0.1:$fixture_port/health" >/dev/null && break
  kill -0 "$fixture_pid" 2>/dev/null
  sleep 0.1
done
curl --fail --silent "http://127.0.0.1:$fixture_port/health" >/dev/null

MULTIPLEX_XBOX_BASE_URL="http://10.0.2.2:$fixture_port" \
MULTIPLEX_XBOX_EXPECT_CATALOG=1 \
MULTIPLEX_XBOX_CATALOG_FIXTURE_LOG="$fixture_log" \
  "$script_dir/smoke-xemu.sh"
