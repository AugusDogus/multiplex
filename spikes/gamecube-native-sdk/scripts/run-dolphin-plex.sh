#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
cache_dir="$spike_dir/.plex-cache"
media="$cache_dir/media.mpg"
metadata="$cache_dir/media.json"
port=${GAMECUBE_PLEX_PORT:-18992}
offset=${GAMECUBE_PLEX_OFFSET:-60}
duration=${GAMECUBE_PLEX_DURATION:-120}
rating_key=${GAMECUBE_PLEX_RATING_KEY:-}
plex_base_url=${PLEX_BASE_URL:-}
server_pid=
launcher_pid=
mute_pid=
pipe_open=0
mute_marker="$cache_dir/audio-muted"

for command in curl ffmpeg ffprobe ip jq python3 setsid; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for Plex playback in Dolphin." >&2
    exit 1
  fi
done

if [ -z "$plex_base_url" ]; then
  for address in $(ip neigh show | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $1}'); do
    if curl --noproxy '*' --connect-timeout 0.3 --max-time 0.7 --fail --silent \
      "http://$address:32400/identity" | grep -q '<MediaContainer'; then
      plex_base_url="http://$address:32400"
      break
    fi
  done
fi
if [ -z "$plex_base_url" ]; then
  echo "No Plex server was discovered; set PLEX_BASE_URL." >&2
  exit 1
fi

mkdir -p "$cache_dir"
if [ -n "$rating_key" ]; then
  python3 "$script_dir/prepare-plex-media.py" "$plex_base_url" "$media" \
    --offset "$offset" --duration "$duration" \
    --rating-key "$rating_key" >"$metadata"
else
  python3 "$script_dir/prepare-plex-media.py" "$plex_base_url" "$media" \
    --offset "$offset" --duration "$duration" >"$metadata"
fi

title=$(jq -r '.title' "$metadata")
container_bytes=$(jq -r '.container_bytes' "$metadata")

cleanup() {
  if [ "$pipe_open" -eq 1 ]; then
    exec 3>&-
    pipe_open=0
  fi
  if [ -n "$mute_pid" ]; then
    kill -TERM "$mute_pid" 2>/dev/null || true
    wait "$mute_pid" 2>/dev/null || true
  fi
  if [ -n "$launcher_pid" ] && kill -0 "$launcher_pid" 2>/dev/null; then
    /bin/kill -TERM -- "-$launcher_pid" 2>/dev/null || true
    sleep 0.3
    /bin/kill -KILL -- "-$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
  fi
  if [ -n "$server_pid" ]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ -n "${PLEX_TOKEN:-}" ]; then
  python3 "$script_dir/plex-gateway.py" "$port" "$media" \
    --plex-base-url "$plex_base_url" --token "$PLEX_TOKEN" \
    --media-metadata "$metadata" \
    >"$cache_dir/http.log" 2>&1 &
else
  python3 "$script_dir/plex-gateway.py" "$port" "$media" \
    --plex-base-url "$plex_base_url" --media-metadata "$metadata" \
    >"$cache_dir/http.log" 2>&1 &
fi
server_pid=$!
attempt=0
while ! curl --noproxy '*' --fail --silent --output /dev/null \
  "http://127.0.0.1:$port/v1/health"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "Timed out starting the local GameCube media gateway." >&2
    exit 1
  fi
  sleep 0.1
done

gateway=$(ip -4 route show default | sed -n 's/^default via \([^ ]*\).*/\1/p' | sed -n '1p')
if [ -z "$gateway" ]; then
  echo "Could not determine the rootless TAP host gateway." >&2
  exit 1
fi
gateway_url="http://$gateway:$port"
GAMECUBE_GATEWAY_URL="$gateway_url" \
  sh "$script_dir/build-native-reference-dol.sh"

user_dir="$spike_dir/.dolphin-user"
log="$user_dir/Logs/dolphin.log"
pipe="$user_dir/Pipes/multiplex1"
if [ -f "$log" ]; then
  mv -f "$log" "$user_dir/Logs/dolphin.previous.log"
fi
setsid env \
  DOLPHIN_CONFIG_PROFILE="$spike_dir/dolphin/Dolphin.tap.ini" \
  DOLPHIN_EMU="$script_dir/run-dolphin-rootless-tap.sh" \
  GAMECUBE_PASTA_BIN="$spike_dir/.passt/pasta" \
  sh "$script_dir/run-dolphin.sh" \
    "$spike_dir/multiplex-gamecube-native-reference.dol" >/dev/null 2>&1 &
launcher_pid=$!

rm -f "$mute_marker"
if command -v pactl >/dev/null 2>&1; then
  (
    attempt=0
    while [ "$attempt" -lt 200 ]; do
      sink_inputs=$(pactl -f json list sink-inputs 2>/dev/null | jq -r \
        '.[] | select(.properties["application.process.binary"] == "dolphin-emu") | .index' 2>/dev/null || true)
      if [ -n "$sink_inputs" ]; then
        for sink_input in $sink_inputs; do
          pactl set-sink-input-mute "$sink_input" 1 2>/dev/null || true
        done
        : >"$mute_marker"
        exit 0
      fi
      sleep 0.1
      attempt=$((attempt + 1))
    done
  ) &
  mute_pid=$!
fi

wait_log() {
  pattern=$1
  attempts=${2:-300}
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    if [ -f "$log" ] && grep -q "$pattern" "$log"; then
      return
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      echo "Dolphin exited before reaching: $pattern" >&2
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for Dolphin log pattern: $pattern" >&2
  tail -60 "$log" >&2 || true
  exit 1
}

line_count() {
  grep -c "$1" "$log" 2>/dev/null || true
}

wait_for_new() {
  pattern=$1
  previous=$2
  attempts=${3:-1200}
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    current=$(line_count "$pattern")
    if [ "$current" -gt "$previous" ]; then
      return
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null; then
      echo "Dolphin exited before producing another: $pattern" >&2
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for another Dolphin log pattern: $pattern" >&2
  tail -60 "$log" >&2 || true
  exit 1
}

press() {
  button=$1
  previous=$(grep -c "controller buttons" "$log" 2>/dev/null || true)
  attempt=0
  while [ "$attempt" -lt 16 ]; do
    printf 'RELEASE %s\n' "$button" >&3
    sleep 0.05
    printf 'PRESS %s\n' "$button" >&3
    poll=0
    while [ "$poll" -lt 5 ]; do
      current=$(grep -c "controller buttons" "$log" 2>/dev/null || true)
      if [ "$current" -gt "$previous" ]; then
        printf 'RELEASE %s\n' "$button" >&3
        sleep 0.2
        return
      fi
      sleep 0.1
      poll=$((poll + 1))
    done
    attempt=$((attempt + 1))
  done
  printf 'RELEASE %s\n' "$button" >&3
  echo "Timed out waiting for Dolphin to sample controller button: $button" >&2
  exit 1
}

wait_log "gateway-catalog version=3" 600
wait_log "gateway-artwork .*loaded=1" 1200
wait_log "signature=" 600
exec 3>"$pipe"
pipe_open=1
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"

# Search is fully controller-authored. Type FRESH on the 9-column keyboard:
# Z opens it, A enters the focused letter, and R submits the query.
signature_count=$(line_count "signature=")
press Z
wait_for_new "signature=" "$signature_count"
for move in 1 2 3 4 5 6; do
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
done
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
press D_DOWN
wait_for_new "signature=" "$signature_count"
for move in 1 2 3; do
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
done
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
press D_UP
wait_for_new "signature=" "$signature_count"
for move in 1 2 3 4; do
  signature_count=$(line_count "signature=")
  press D_LEFT
  wait_for_new "signature=" "$signature_count"
done
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
for move in 1 2; do
  signature_count=$(line_count "signature=")
  press D_DOWN
  wait_for_new "signature=" "$signature_count"
done
for move in 1 2 3 4; do
  signature_count=$(line_count "signature=")
  press D_LEFT
  wait_for_new "signature=" "$signature_count"
done
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
for move in 1 2; do
  signature_count=$(line_count "signature=")
  press D_UP
  wait_for_new "signature=" "$signature_count"
done
for move in 1 2 3 4 5 6 7; do
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
done
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
search_count=$(line_count "search-page ready query=FRESH")
signature_count=$(line_count "signature=")
press R
wait_for_new "search-page ready query=FRESH" "$search_count" 1200
wait_for_new "signature=" "$signature_count"

# Open the top result to prove search-detail origin, then unwind to Home.
signature_count=$(line_count "signature=")
press D_RIGHT
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
details_count=$(line_count "details-page ready")
press A
wait_for_new "details-page ready" "$details_count" 1200
wait_for_new "signature=" "$signature_count"
for back in 1 2 3; do
  signature_count=$(line_count "signature=")
  press B
  wait_for_new "signature=" "$signature_count"
done

# Y is the console-native shortcut to the real Plex library picker.
signature_count=$(line_count "signature=")
press Y
wait_for_new "signature=" "$signature_count"

# The picker starts on Back, followed by Search, then the real libraries.
for move in 1 2; do
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
done
first_browse_count=$(line_count "browse-page ready")
signature_count=$(line_count "signature=")
press A
wait_for_new "browse-page ready" "$first_browse_count" 1200
wait_for_new "signature=" "$signature_count"

# R pages forward directly, matching a console media browser and avoiding a
# focus walk through every poster during the automated smoke path.
second_browse_count=$(line_count "browse-page ready")
signature_count=$(line_count "signature=")
press R
wait_for_new "browse-page ready" "$second_browse_count" 1200
wait_for_new "signature=" "$signature_count"

# Back to the library picker, then Home.
signature_count=$(line_count "signature=")
press B
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
press B
wait_for_new "signature=" "$signature_count"

# X cycles to the next hub row; its first item is the same Fresh item prepared
# above by the gateway runner.
signature_count=$(line_count "signature=")
press X
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$signature_count"
signature_count=$(line_count "signature=")
press D_RIGHT
wait_for_new "signature=" "$signature_count"
playing_count=$(line_count "playback=playing")
paused_count=$(line_count "playback=paused")
press A
wait_for_new "playback=playing" "$playing_count" 1200
sleep 1
if [ "$(line_count "playback=paused")" -gt "$paused_count" ]; then
  playing_count=$(line_count "playback=playing")
  press A
  wait_for_new "playback=playing" "$playing_count" 120
fi

echo "Playing Plex item '$title' in Dolphin ($container_bytes-byte GameCube stream)."
if [ -n "$mute_pid" ]; then
  wait "$mute_pid" 2>/dev/null || true
  mute_pid=
fi
if [ -f "$mute_marker" ]; then
  echo "Dolphin host audio is muted; emulated AI DMA remains active for timing tests."
else
  echo "Dolphin host audio could not be muted; emulated playback remains active."
fi
wait "$launcher_pid"
