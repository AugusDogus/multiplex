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
video_bytes=$(jq -r '.video_bytes' "$metadata")
audio_bytes=$(jq -r '.audio_bytes' "$metadata")
video_packets=$(jq -r '.video_packets' "$metadata")
audio_packets=$(jq -r '.audio_packets' "$metadata")
video_pts=$(jq -r '.video_pts90k' "$metadata")
audio_pts=$(jq -r '.audio_pts90k' "$metadata")

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

python3 "$script_dir/serve-http-fixture.py" "$port" "$media" \
  >"$cache_dir/http.log" 2>&1 &
server_pid=$!
attempt=0
while ! curl --noproxy '*' --fail --silent --output /dev/null \
  "http://127.0.0.1:$port/multiplex-dvd-demo.mpg"; do
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
media_url="http://$gateway:$port/multiplex-dvd-demo.mpg"
GAMECUBE_MEDIA_URL="$media_url" \
GAMECUBE_MEDIA_VIDEO_BYTES="$video_bytes" \
GAMECUBE_MEDIA_AUDIO_BYTES="$audio_bytes" \
GAMECUBE_MEDIA_VIDEO_PACKETS="$video_packets" \
GAMECUBE_MEDIA_AUDIO_PACKETS="$audio_packets" \
GAMECUBE_MEDIA_VIDEO_PTS90K="$video_pts" \
GAMECUBE_MEDIA_AUDIO_PTS90K="$audio_pts" \
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

press() {
  button=$1
  printf 'RELEASE %s\n' "$button" >&3
  sleep 0.1
  printf 'PRESS %s\n' "$button" >&3
  sleep 0.2
  printf 'RELEASE %s\n' "$button" >&3
  sleep 0.3
}

wait_log "signature=fa6601eb" 600
exec 3>"$pipe"
pipe_open=1
press A
wait_log "signature=4dcbccff" 120
press D_RIGHT
wait_log "signature=683f174f" 120
press A
wait_log "signature=8e79132e" 120
press D_RIGHT
wait_log "signature=c3a0002e" 120
press A
wait_log "playback=playing" 300

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
