#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
port=${GAMECUBE_HTTP_FIXTURE_PORT:-18991}
fixture_url=
server_pid=
http_build=0
downloaded_fixture=

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [ "$http_build" -eq 1 ]; then
    GAMECUBE_MEDIA_URL= sh "$script_dir/build-native-reference-dol.sh" \
      >/dev/null
  fi
  if [ -n "$downloaded_fixture" ]; then
    rm -f "$downloaded_fixture"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

for command in curl ffmpeg ffprobe ip python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the local HTTP playback smoke." >&2
    exit 1
  fi
done

fixture_ip=${GAMECUBE_HTTP_FIXTURE_IP:-}
if [ -z "$fixture_ip" ]; then
  fixture_ip=$(
    ip -4 -o addr show tailscale0 2>/dev/null |
      sed -n 's/.* inet \([^/]*\)\/.*/\1/p' |
      sed -n '1p'
  )
fi

rootless_tap=${GAMECUBE_DOLPHIN_ROOTLESS_TAP:-0}
if [ "$rootless_tap" -eq 1 ]; then
  fixture_ip=$(
    ip -4 route show default |
      sed -n 's/^default via \([^ ]*\).*/\1/p' |
      sed -n '1p'
  )
  if [ -z "$fixture_ip" ]; then
    echo "Could not determine the pasta host gateway for the TAP smoke." >&2
    exit 1
  fi
fi
if [ -z "$fixture_ip" ]; then
  echo "Set GAMECUBE_HTTP_FIXTURE_IP to a host address reachable from Dolphin's BBA." >&2
  exit 1
fi

python3 "$script_dir/serve-http-fixture.py" "$port" \
  "$app_dir/assets/multiplex-dvd-demo.mpg" \
  >"$app_dir/.http-fixture.log" 2>&1 &
server_pid=$!
fixture_url="http://$fixture_ip:$port/multiplex-dvd-demo.mpg"
local_fixture_url=$fixture_url
if [ "$rootless_tap" -eq 1 ]; then
  local_fixture_url="http://127.0.0.1:$port/multiplex-dvd-demo.mpg"
fi

attempt=0
while ! curl --noproxy '*' --fail --silent --output /dev/null "$local_fixture_url"; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Local HTTP fixture exited before becoming ready." >&2
    sed -n '1,80p' "$app_dir/.http-fixture.log" >&2 || true
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "Timed out waiting for local HTTP fixture at $fixture_url." >&2
    exit 1
  fi
  sleep 0.1
done

downloaded_fixture=$(mktemp)
curl --noproxy '*' --fail --silent --show-error \
  --output "$downloaded_fixture" "$local_fixture_url"
if ! cmp -s "$downloaded_fixture" \
  "$app_dir/assets/multiplex-dvd-demo.mpg"; then
  echo "Downloaded HTTP fixture does not match the source media." >&2
  exit 1
fi
ffprobe -v error -show_entries stream=codec_name \
  -of default=noprint_wrappers=1 "$downloaded_fixture" >/dev/null
ffmpeg -v error -i "$downloaded_fixture" -f null - </dev/null

http_build=1
GAMECUBE_MEDIA_URL="$fixture_url" \
  sh "$script_dir/build-native-reference-dol.sh"
if [ "$rootless_tap" -eq 1 ]; then
  sh "$script_dir/bootstrap-rootless-tap.sh"
  dolphin_config_profile="$app_dir/dolphin/Dolphin.tap.ini"
  dolphin_emu="$script_dir/run-dolphin-rootless-tap.sh"
  gamecube_pasta_bin="$app_dir/.passt/pasta"
else
  dolphin_config_profile="$app_dir/dolphin/Dolphin.bba.ini"
  dolphin_emu=${DOLPHIN_EMU:-dolphin-emu}
  gamecube_pasta_bin=${GAMECUBE_PASTA_BIN:-pasta}
fi

DOLPHIN_CONFIG_PROFILE="$dolphin_config_profile" DOLPHIN_EMU="$dolphin_emu" \
  GAMECUBE_PASTA_BIN="$gamecube_pasta_bin" \
  GAMECUBE_EXPECT_MEDIA_BYTES=155648 GAMECUBE_EXPECT_MEDIA_SOURCE=http \
  sh "$script_dir/smoke-dolphin-player.sh"

echo "Dolphin HTTP player smoke passed against $fixture_url."
