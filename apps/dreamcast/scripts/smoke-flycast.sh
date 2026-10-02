#!/bin/sh
set -eu

if [ "${MULTIPLEX_DREAMCAST_XVFB:-0}" != 1 ]; then
  if ! command -v xvfb-run >/dev/null 2>&1; then
    echo "xvfb-run is required for deterministic Flycast input." >&2
    exit 1
  fi
  exec xvfb-run -a -s '-screen 0 800x600x24' \
    env MULTIPLEX_DREAMCAST_XVFB=1 sh "$0" "$@"
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
user_dir="$app_dir/.flycast-user"
log_file="$user_dir/flycast.log"
screenshot="$app_dir/generated/flycast-dreamcast-smoke.png"
fixture_media="$app_dir/generated/dreamcast-demo.mpg"
fixture_log="$app_dir/generated/flycast-gateway.log"
runner_pid=
server_pid=

for command in curl ffmpeg import ip python3 rg xdotool; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the Flycast app smoke test." >&2
    exit 1
  fi
done

cleanup() {
  if [ -n "$runner_pid" ] && kill -0 "$runner_pid" 2>/dev/null; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$app_dir/generated"
sh "$script_dir/generate-demo-mpeg1.sh" "$fixture_media"
port=$((30000 + ($$ % 20000)))
host_ip=$(ip -4 route get 1.1.1.1 |
  sed -n 's/.* src \([^ ]*\).*/\1/p' | sed -n '1p')
if [ -z "$host_ip" ]; then
  echo "Could not determine the host IPv4 address for Flycast BBA." >&2
  exit 1
fi
python3 "$app_dir/tests/flycast_gateway_fixture.py" \
  "$port" "$fixture_media" >"$fixture_log" 2>&1 &
server_pid=$!
attempt=0
while ! curl --fail --silent --output /dev/null \
  "http://127.0.0.1:$port/v3/catalog.bin"; do
  if ! kill -0 "$server_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    echo "The Dreamcast Flycast gateway did not start." >&2
    sed -n '1,240p' "$fixture_log" >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
DREAMCAST_GATEWAY_URL="http://$host_ip:$port" \
  bash "$script_dir/build-reference-elf.sh"
sh "$script_dir/run-flycast.sh" &
runner_pid=$!

window_id=
attempt=0
while [ "$attempt" -lt 300 ]; do
  window_id=$(xdotool search --onlyvisible \
    --name '^Flycast - multiplex-dreamcast$' 2>/dev/null |
    sed -n '1p')
  if [ -n "$window_id" ]; then
    break
  fi
  if ! kill -0 "$runner_pid" 2>/dev/null; then
    echo "Flycast exited before opening the Dreamcast app window." >&2
    sed -n '1,240p' "$log_file" >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
if [ -z "$window_id" ]; then
  echo "Flycast did not open the Dreamcast presentation window within 30 seconds." >&2
  exit 1
fi
xdotool windowfocus "$window_id"
sleep 0.25

attempt=0
while [ "$attempt" -lt 300 ]; do
  if rg -q 'MULTIPLEX DREAMCAST: app ready screen=pairing' "$log_file"; then
    break
  fi
  if ! kill -0 "$runner_pid" 2>/dev/null; then
    echo "Flycast exited before the Dreamcast ready marker was observed." >&2
    sed -n '1,240p' "$log_file" >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
if ! rg -q 'MULTIPLEX DREAMCAST: app ready screen=pairing' "$log_file"; then
  echo "The Dreamcast ELF opened, but its KallistiOS ready marker was not observed." >&2
  sed -n '1,240p' "$log_file" >&2
  exit 1
fi

# Flycast's default keyboard map uses X for Dreamcast A and the host arrow
# keys for the Dreamcast D-pad. The private X server keeps focus deterministic
# while these events travel through the emulated Maple controller.
window_id=$(xdotool search --onlyvisible \
  --name '^Flycast - multiplex-dreamcast$' 2>/dev/null | tail -n 1)
press_until() {
  press_key=$1
  press_marker=$2
  press_error=$3
  press_attempt=0
  while [ "$press_attempt" -lt 100 ]; do
    xdotool windowfocus "$window_id"
    sleep 0.1
    if [ "$(xdotool getwindowfocus)" = "$window_id" ]; then
      xdotool keydown "$press_key"
      sleep 0.1
      xdotool keyup "$press_key"
      sleep 0.1
    fi
    press_wait=0
    while [ "$press_wait" -lt 5 ]; do
      if rg -q "$press_marker" "$log_file"; then
        return 0
      fi
      sleep 0.1
      press_wait=$((press_wait + 1))
    done
    press_attempt=$((press_attempt + 1))
  done
  echo "$press_error" >&2
  sed -n '1,240p' "$log_file" >&2
  return 1
}

press_until x 'catalog loaded server=Flycast Plex items=2 first=41' \
  "Dreamcast A did not load the gateway catalog."
press_until Right 'input action=next screen=2 focus=1 rating_key=42' \
  "Dreamcast D-pad navigation did not move home focus."
press_until x 'input action=activate screen=3 focus=1 rating_key=42' \
  "Dreamcast A did not open the focused item's details."
press_until x 'playback segment rating_key=42 offset=0' \
  "Dreamcast did not download the selected MPEG-1 segment."

attempt=0
while [ "$attempt" -lt 600 ]; do
  if rg -q 'MULTIPLEX DREAMCAST: playback result=0' "$log_file"; then
    break
  fi
  if ! kill -0 "$runner_pid" 2>/dev/null; then
    echo "Flycast exited during Dreamcast MPEG-1 playback." >&2
    sed -n '1,260p' "$log_file" >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
if ! rg -q 'MULTIPLEX DREAMCAST: playback result=0' "$log_file"; then
  echo "Dreamcast MPEG-1 playback did not finish within 60 seconds." >&2
  sed -n '1,260p' "$log_file" >&2
  exit 1
fi

attempt=0
while [ "$attempt" -lt 100 ]; do
  if rg -q 'MULTIPLEX DREAMCAST: frames=120 fps=.* screen=3' "$log_file"; then
    break
  fi
  if ! kill -0 "$runner_pid" 2>/dev/null; then
    echo "Flycast exited before the Dreamcast app reached 120 frames." >&2
    sed -n '1,240p' "$log_file" >&2
    exit 1
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done
if ! rg -q 'MULTIPLEX DREAMCAST: frames=120 fps=.* screen=3' "$log_file"; then
  echo "The Dreamcast app did not sustain 120 frames within 10 seconds." >&2
  sed -n '1,240p' "$log_file" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$screenshot")"
import -window "$window_id" "$screenshot"
test -s "$screenshot"

if rg -ni 'invalid (read|write)|fatal|segmentation fault' "$log_file"; then
  echo "Flycast reported a fatal or invalid memory access." >&2
  exit 1
fi

echo "Flycast verified Dreamcast gateway catalog and MPEG-1 playback: $screenshot"
