#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
state_test=$(mktemp "${TMPDIR:-/tmp}/multiplex-dreamcast-app-state.XXXXXX")
protocol_test=$(mktemp "${TMPDIR:-/tmp}/multiplex-dreamcast-protocol.XXXXXX")
http_test=$(mktemp "${TMPDIR:-/tmp}/multiplex-dreamcast-http.XXXXXX")
server_pid=

cleanup() {
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$state_test" "$protocol_test" "$http_test"
}
trap cleanup EXIT HUP INT TERM

${CC:-cc} -std=c17 -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/src" \
  "$app_dir/src/app_state.c" \
  "$app_dir/tests/app_state_test.c" \
  -o "$state_test"
"$state_test"

${CC:-cc} -std=c17 -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/src" \
  "$app_dir/src/gateway_protocol.c" \
  "$app_dir/tests/gateway_protocol_test.c" \
  -o "$protocol_test"
"$protocol_test"

${CC:-cc} -std=c17 -Wall -Wextra -Werror -pedantic \
  -I"$app_dir/src" \
  "$app_dir/src/http_client.c" \
  "$app_dir/tests/http_client_test.c" \
  -o "$http_test"
port=$((30000 + ($$ % 20000)))
python3 "$app_dir/tests/http_fixture.py" "$port" >/dev/null 2>&1 &
server_pid=$!
attempt=0
while ! curl --fail --silent --output /dev/null \
  "http://127.0.0.1:$port/body.bin"; do
  if ! kill -0 "$server_pid" 2>/dev/null || [ "$attempt" -ge 50 ]; then
    echo "Dreamcast HTTP fixture did not start." >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
"$http_test" "http://127.0.0.1:$port"
echo "Dreamcast app state tests passed."
