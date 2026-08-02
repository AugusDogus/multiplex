#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
cache_dir="$spike_dir/.plex-cache"
auth_state=${GAMECUBE_PLEX_AUTH_STATE:-"$cache_dir/auth.json"}
media="$cache_dir/media.mpg"
metadata="$cache_dir/media.json"
port=${GAMECUBE_PLEX_PORT:-18992}
offset=${GAMECUBE_PLEX_OFFSET:-60}
duration=${GAMECUBE_PLEX_DURATION:-120}
segment_duration=${GAMECUBE_PLEX_SEGMENT_DURATION:-$duration}
expect_continuation=${GAMECUBE_PLEX_EXPECT_CONTINUATION:-0}
direct_plex=${GAMECUBE_DIRECT_PLEX:-0}
wait_artwork=${GAMECUBE_PLEX_WAIT_ARTWORK:-1}
sustain_seconds=${GAMECUBE_PLEX_SUSTAIN_SECONDS:-45}
keep_open=${GAMECUBE_PLEX_KEEP_OPEN:-1}
interactive=${GAMECUBE_PLEX_INTERACTIVE:-0}
plex_video_resolution=${GAMECUBE_PLEX_VIDEO_RESOLUTION:-480x270}
plex_max_video_bitrate=${GAMECUBE_PLEX_MAX_VIDEO_BITRATE:-700}
watch_together=${GAMECUBE_PLEX_WATCH_TOGETHER:-0}
watch_together_invitee_id=${GAMECUBE_WATCH_TOGETHER_INVITEE_ID:-}
watch_together_browser_guest=${GAMECUBE_WATCH_TOGETHER_BROWSER_GUEST:-0}
rating_key=${GAMECUBE_PLEX_RATING_KEY:-}
search_query=${GAMECUBE_PLEX_SEARCH_QUERY:-FRESH}
search_result_index=${GAMECUBE_PLEX_SEARCH_RESULT_INDEX:-0}
tv_hierarchy=${GAMECUBE_PLEX_TV_HIERARCHY:-0}
tv_season_index=${GAMECUBE_PLEX_TV_SEASON_INDEX:-0}
tv_episode_page=${GAMECUBE_PLEX_TV_EPISODE_PAGE:-0}
tv_episode_index=${GAMECUBE_PLEX_TV_EPISODE_INDEX:-0}
focus_audit=${GAMECUBE_PLEX_FOCUS_AUDIT:-0}
start_offset_ms=${GAMECUBE_PLEX_START_OFFSET_MS:-0}
expect_autoplay_next=${GAMECUBE_PLEX_EXPECT_AUTOPLAY_NEXT:-0}
expected_autoplay_rating_key=${GAMECUBE_PLEX_AUTOPLAY_RATING_KEY:-}
test_subtitle_cycle=${GAMECUBE_PLEX_TEST_SUBTITLE_CYCLE:-0}
plex_base_url=${PLEX_BASE_URL:-}
multiplex_base_url=${MULTIPLEX_BASE_URL:-}
console_name=${MULTIPLEX_CONSOLE_NAME:-GameCube}
reference_dol=${MULTIPLEX_REFERENCE_DOL:-"$spike_dir/multiplex-gamecube-native-reference.dol"}
reference_build_script=${MULTIPLEX_REFERENCE_BUILD_SCRIPT:-build-native-reference-dol.sh}
controller_pipe_name=${MULTIPLEX_CONTROLLER_PIPE:-multiplex1}
dolphin_network=${MULTIPLEX_DOLPHIN_NETWORK:-rootless-tap}
server_pid=
launcher_pid=
mute_pid=
lobby_pid=
created_room_id=
disbanded_room_id=
cleanup_started=0
browser_guest_log="$cache_dir/watch-together-browser-guest.log"
browser_guest_control="$cache_dir/watch-together-browser-guest.control"
launcher_log="$cache_dir/dolphin-launcher.log"
pipe_open=0
mute_marker="$cache_dir/audio-muted"

for command in curl ip jq python3 setsid; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for Plex playback in Dolphin." >&2
    exit 1
  fi
done
if [ "$direct_plex" -ne 1 ]; then
  for command in ffmpeg ffprobe; do
    if ! command -v "$command" >/dev/null 2>&1; then
      echo "$command is required for gateway-transcoded Plex playback in Dolphin." >&2
      exit 1
    fi
  done
fi

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
if [ "$direct_plex" -eq 1 ] && [ -z "$multiplex_base_url" ]; then
  echo "GAMECUBE_DIRECT_PLEX=1 requires MULTIPLEX_BASE_URL for saved device credentials." >&2
  exit 1
fi
if [ "$direct_plex" -eq 1 ] && [ "$expect_continuation" -eq 1 ]; then
  echo "Direct Plex HLS is continuous; GAMECUBE_PLEX_EXPECT_CONTINUATION only applies to gateway segments." >&2
  exit 1
fi
case "$sustain_seconds" in
  '' | *[!0-9]*)
    echo "GAMECUBE_PLEX_SUSTAIN_SECONDS must be an unsigned integer." >&2
    exit 1
    ;;
esac
case "$watch_together" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_WATCH_TOGETHER must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$test_subtitle_cycle" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_TEST_SUBTITLE_CYCLE must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$watch_together_browser_guest" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_WATCH_TOGETHER_BROWSER_GUEST must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$keep_open" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_KEEP_OPEN must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$interactive" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_INTERACTIVE must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$search_query" in
  '' | *[!A-Z]*)
    echo "GAMECUBE_PLEX_SEARCH_QUERY must contain 1-24 uppercase A-Z characters." >&2
    exit 1
    ;;
esac
if [ "${#search_query}" -gt 24 ]; then
  echo "GAMECUBE_PLEX_SEARCH_QUERY must contain 1-24 uppercase A-Z characters." >&2
  exit 1
fi
for value_name in search_result_index tv_season_index tv_episode_index; do
  eval "value=\${$value_name}"
  case "$value" in
    0 | 1 | 2 | 3) ;;
    *)
      echo "$value_name must be an integer from 0 through 3." >&2
      exit 1
      ;;
  esac
done
case "$tv_episode_page" in
  '' | *[!0-9]*)
    echo "GAMECUBE_PLEX_TV_EPISODE_PAGE must be an unsigned integer." >&2
    exit 1
    ;;
esac
case "$tv_hierarchy" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_TV_HIERARCHY must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$focus_audit" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_FOCUS_AUDIT must be 0 or 1." >&2
    exit 1
    ;;
esac
case "$start_offset_ms" in
  '' | *[!0-9]*)
    echo "GAMECUBE_PLEX_START_OFFSET_MS must be an unsigned integer." >&2
    exit 1
    ;;
esac
case "$expect_autoplay_next" in
  0 | 1) ;;
  *)
    echo "GAMECUBE_PLEX_EXPECT_AUTOPLAY_NEXT must be 0 or 1." >&2
    exit 1
    ;;
esac
if [ "$expect_autoplay_next" -eq 1 ]; then
  case "$expected_autoplay_rating_key" in
    '' | *[!0-9]*)
      echo "Autoplay testing requires a numeric GAMECUBE_PLEX_AUTOPLAY_RATING_KEY." >&2
      exit 1
      ;;
  esac
  if [ "$direct_plex" -ne 1 ] || [ "$start_offset_ms" -eq 0 ]; then
    echo "Autoplay testing requires direct Plex and a nonzero start offset." >&2
    exit 1
  fi
  if [ "$watch_together" -eq 1 ] && [ "$watch_together_browser_guest" -ne 1 ]; then
    echo "Watch Together autoplay testing requires the browser guest." >&2
    exit 1
  fi
fi
if [ "$watch_together" -eq 1 ] && [ "$direct_plex" -ne 1 ]; then
  echo "Watch Together smoke testing requires GAMECUBE_DIRECT_PLEX=1." >&2
  exit 1
fi
if [ "$watch_together" -eq 1 ]; then
  case "$watch_together_invitee_id" in
    '' | *[!0-9]*)
      echo "Watch Together smoke testing requires a numeric GAMECUBE_WATCH_TOGETHER_INVITEE_ID." >&2
      exit 1
      ;;
  esac
fi
case "$dolphin_network" in
  rootless-tap | native) ;;
  *)
    echo "MULTIPLEX_DOLPHIN_NETWORK must be rootless-tap or native." >&2
    exit 1
    ;;
esac
if [ "$dolphin_network" = native ] && [ "$direct_plex" -ne 1 ]; then
  echo "$console_name native Dolphin networking currently requires GAMECUBE_DIRECT_PLEX=1." >&2
  exit 1
fi
if [ "$dolphin_network" = native ]; then
  MULTIPLEX_EMULATOR_HOST_IP=${MULTIPLEX_EMULATOR_HOST_IP:-127.0.0.1}
  export MULTIPLEX_EMULATOR_HOST_IP
fi

mkdir -p "$cache_dir"
if [ -z "${PLEX_TOKEN:-}" ] && [ -f "$auth_state" ]; then
  PLEX_TOKEN=$(python3 "$script_dir/plex-pair.py" server-token \
    "$auth_state" "$plex_base_url")
  export PLEX_TOKEN
  echo "Loaded the approved access token for the selected Plex server."
fi
if [ "$direct_plex" -eq 1 ]; then
  title=
  container_bytes=
else
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
fi

cleanup() {
  if [ "$cleanup_started" -eq 1 ]; then
    return
  fi
  cleanup_started=1
  if [ "$pipe_open" -eq 1 ]; then
    exec 3>&-
    pipe_open=0
  fi
  if [ -n "$mute_pid" ]; then
    kill -TERM "$mute_pid" 2>/dev/null || true
    wait "$mute_pid" 2>/dev/null || true
  fi
  if [ -n "$lobby_pid" ]; then
    kill -TERM "$lobby_pid" 2>/dev/null || true
    wait "$lobby_pid" 2>/dev/null || true
  fi
  rm -f "$browser_guest_control"
  for test_room_id in "$created_room_id"; do
    if [ -n "$test_room_id" ] &&
      ! bun "$script_dir/syncplay-room-control.ts" delete-room \
        "$test_room_id" >/dev/null 2>&1; then
      echo "Could not delete test Watch Together room $test_room_id; it remains available for manual cleanup." >&2
    fi
  done
  if [ -n "$launcher_pid" ] && kill -0 "$launcher_pid" 2>/dev/null; then
    /bin/kill -TERM -- "-$launcher_pid" 2>/dev/null || true
    sleep 0.3
    /bin/kill -KILL -- "-$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
  fi
  if [ "$direct_plex" -eq 1 ] && \
    ! bun "$script_dir/syncplay-room-control.ts" stop-pms-session \
      >/dev/null 2>&1; then
    echo "Could not stop the Dolphin client's PMS session; it may remain active until Plex expires it." >&2
  fi
  if [ -n "$server_pid" ]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

gateway_url=
if [ "$direct_plex" -ne 1 ]; then
  set -- "$port" "$media" \
    --plex-base-url "$plex_base_url" \
    --media-metadata "$metadata" \
    --segment-duration "$segment_duration"
  if [ -n "$multiplex_base_url" ]; then
    set -- "$@" \
      --multiplex-base-url "$multiplex_base_url" \
      --multiplex-state "$cache_dir/multiplex-device.json"
  fi
  python3 "$script_dir/plex-gateway.py" "$@" >"$cache_dir/http.log" 2>&1 &
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
fi
if [ "$direct_plex" -eq 1 ]; then
  GAMECUBE_GATEWAY_URL= \
    GAMECUBE_PLEX_BASE_URL="$plex_base_url" \
    GAMECUBE_PLEX_VIDEO_RESOLUTION="$plex_video_resolution" \
    GAMECUBE_PLEX_MAX_VIDEO_BITRATE="$plex_max_video_bitrate" \
    GAMECUBE_PLEX_START_OFFSET_MS="$start_offset_ms" \
    MULTIPLEX_BASE_URL="$multiplex_base_url" \
    sh "$script_dir/$reference_build_script"
else
  GAMECUBE_GATEWAY_URL="$gateway_url" \
    sh "$script_dir/$reference_build_script"
fi

user_dir="$spike_dir/.dolphin-user"
log="$user_dir/Logs/dolphin.log"
pipe="$user_dir/Pipes/$controller_pipe_name"
if [ -f "$log" ]; then
  mv -f "$log" "$user_dir/Logs/dolphin.previous.log"
fi
if [ "$dolphin_network" = rootless-tap ]; then
  dolphin_config_profile="$spike_dir/dolphin/Dolphin.tap.ini"
  dolphin_emu="$script_dir/run-dolphin-rootless-tap.sh"
else
  dolphin_config_profile="$spike_dir/dolphin/Dolphin.ini"
  dolphin_emu=${DOLPHIN_EMU:-dolphin-emu}
fi
setsid env \
  DOLPHIN_CONFIG_PROFILE="$dolphin_config_profile" \
  DOLPHIN_EMU="$dolphin_emu" \
  GAMECUBE_PASTA_BIN="${GAMECUBE_PASTA_BIN:-$spike_dir/.passt/pasta}" \
  sh "$script_dir/run-dolphin.sh" \
    "$reference_dol" >"$launcher_log" 2>&1 &
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

browser_guest_line_count() {
  grep -c "$1" "$browser_guest_log" 2>/dev/null || true
}

wait_for_browser_guest() {
  pattern=$1
  previous=${2:-0}
  attempts=${3:-1200}
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    current=$(browser_guest_line_count "$pattern")
    if [ "$current" -gt "$previous" ]; then
      return
    fi
    if [ -z "$lobby_pid" ] || ! kill -0 "$lobby_pid" 2>/dev/null; then
      echo "Browser guest exited before producing: $pattern" >&2
      tail -60 "$browser_guest_log" >&2 || true
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for browser guest log pattern: $pattern" >&2
  tail -60 "$browser_guest_log" >&2 || true
  exit 1
}

start_browser_guest() {
  rm -f "$browser_guest_control"
  : >"$browser_guest_log"
  MULTIPLEX_BROWSER_BASE_URL="$multiplex_base_url" \
    bun "$script_dir/watch-together-browser-guest.ts" \
      "$created_room_id" "$browser_guest_control" \
      >"$browser_guest_log" 2>&1 &
  lobby_pid=$!
}

wait_for_browser_guest_seek() {
  minimum=$1
  maximum=$2
  attempts=${3:-1200}
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    browser_seek_offset=$(sed -n \
      's/.*Browser guest advancing offset-ms=\([0-9][0-9]*\).*/\1/p' \
      "$browser_guest_log" 2>/dev/null | tail -1)
    if [ -n "$browser_seek_offset" ] && \
      [ "$browser_seek_offset" -ge "$minimum" ] && \
      [ "$browser_seek_offset" -le "$maximum" ]; then
      return
    fi
    if [ -z "$lobby_pid" ] || ! kill -0 "$lobby_pid" 2>/dev/null; then
      echo "Browser guest exited before following the GameCube seek." >&2
      tail -60 "$browser_guest_log" >&2 || true
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Browser guest did not follow the GameCube seek to $minimum..$maximum ms; its latest offset was ${browser_seek_offset:-unknown}." >&2
  tail -60 "$browser_guest_log" >&2 || true
  exit 1
}

wait_for_synced_playback_state() {
  expected=$1
  attempts=${2:-1200}
  stable=0
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    gamecube_state=$(sed -n \
      's/.*REFERENCE GX: playback=\(playing\|paused\).*/\1/p' \
      "$log" 2>/dev/null | tail -1)
    browser_state=$(sed -n \
      's/.*Browser guest playback=\(playing\|paused\).*/\1/p' \
      "$browser_guest_log" 2>/dev/null | tail -1)
    if [ "$gamecube_state" = "$expected" ] && \
      [ "$browser_state" = "$expected" ]; then
      stable=$((stable + 1))
      if [ "$stable" -ge 20 ]; then
        return
      fi
    else
      stable=0
    fi
    if ! kill -0 "$launcher_pid" 2>/dev/null || \
      [ -z "$lobby_pid" ] || ! kill -0 "$lobby_pid" 2>/dev/null; then
      echo "A Watch Together client exited before both reached $expected." >&2
      exit 1
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Watch Together clients did not remain $expected; GameCube=$gamecube_state browser=$browser_state." >&2
  exit 1
}

navigate() {
  direction=$1
  case "$direction" in
    D_LEFT) axis_x=0.0; axis_y=0.5; action=0 ;;
    D_RIGHT) axis_x=1.0; axis_y=0.5; action=1 ;;
    D_UP) axis_x=0.5; axis_y=1.0; action=8 ;;
    D_DOWN) axis_x=0.5; axis_y=0.0; action=9 ;;
    *) echo "Unsupported analog navigation direction: $direction" >&2; exit 1 ;;
  esac
  previous=$(line_count "input action=$action")
  max_attempts=${GAMECUBE_CONTROLLER_ATTEMPTS:-60}
  attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    printf 'SET MAIN 0.5 0.5\n' >&3
    sleep 0.3
    printf 'SET MAIN %s %s\n' "$axis_x" "$axis_y" >&3
    poll=0
    while [ "$poll" -lt 8 ]; do
      current=$(line_count "input action=$action")
      if [ "$current" -gt "$previous" ]; then
        printf 'SET MAIN 0.5 0.5\n' >&3
        sleep 0.3
        return
      fi
      if ! kill -0 "$launcher_pid" 2>/dev/null; then
        printf 'SET MAIN 0.5 0.5\n' >&3
        echo "Dolphin exited while waiting to sample analog navigation: $direction" >&2
        exit 1
      fi
      sleep 0.1
      poll=$((poll + 1))
    done
    attempt=$((attempt + 1))
  done
  printf 'SET MAIN 0.5 0.5\n' >&3
  echo "Timed out waiting for Dolphin to sample analog navigation: $direction" >&2
  exit 1
}

press() {
  button=$1
  case "$button" in
    D_LEFT | D_RIGHT | D_UP | D_DOWN)
      navigate "$button"
      return
      ;;
  esac
  previous=$(grep -c "controller buttons" "$log" 2>/dev/null || true)
  max_attempts=${GAMECUBE_CONTROLLER_ATTEMPTS:-60}
  attempt=0
  while [ "$attempt" -lt "$max_attempts" ]; do
    printf 'RELEASE %s\n' "$button" >&3
    sleep 0.5
    printf 'PRESS %s\n' "$button" >&3
    poll=0
    while [ "$poll" -lt 5 ]; do
      current=$(grep -c "controller buttons" "$log" 2>/dev/null || true)
      if [ "$current" -gt "$previous" ]; then
        printf 'RELEASE %s\n' "$button" >&3
        sleep 0.5
        return
      fi
      if ! kill -0 "$launcher_pid" 2>/dev/null; then
        printf 'RELEASE %s\n' "$button" >&3
        echo "Dolphin exited while waiting to sample controller button: $button" >&2
        exit 1
      fi
      sleep 0.1
      poll=$((poll + 1))
    done
    attempt=$((attempt + 1))
  done
  printf 'RELEASE %s\n' "$button" >&3
  echo "Timed out after $max_attempts attempts waiting for Dolphin to sample controller button: $button" >&2
  tail -60 "$log" >&2 || true
  exit 1
}

audit_focus_cycle() {
  input_count=$(line_count "input action=1")
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "input action=1" "$input_count"
  wait_for_new "signature=" "$signature_count"
  focus_count=$(sed -n \
    's/.*input action=1 focus=[0-9][0-9]* count=\([0-9][0-9]*\).*/\1/p' \
    "$log" | tail -1)
  case "$focus_count" in
    '' | 0 | *[!0-9]*)
      echo "Could not determine the current screen's focus target count." >&2
      exit 1
      ;;
  esac
  remaining=$((focus_count - 1))
  while [ "$remaining" -gt 0 ]; do
    input_count=$(line_count "input action=1")
    signature_count=$(line_count "signature=")
    press D_RIGHT
    wait_for_new "input action=1" "$input_count"
    wait_for_new "signature=" "$signature_count"
    remaining=$((remaining - 1))
  done
}

type_search_query() {
  query=$1
  # Search focuses Q when opened. The enabled focus order is the three header
  # controls followed by the 26 QWERTY keys.
  focus=3
  for code in $(printf '%s' "$query" | od -An -tu1); do
    case "$code" in
      81) target=3 ;;  87) target=4 ;;  69) target=5 ;;  82) target=6 ;;
      84) target=7 ;;  89) target=8 ;;  85) target=9 ;;  73) target=10 ;;
      79) target=11 ;; 80) target=12 ;; 65) target=13 ;; 83) target=14 ;;
      68) target=15 ;; 70) target=16 ;; 71) target=17 ;; 72) target=18 ;;
      74) target=19 ;; 75) target=20 ;; 76) target=21 ;; 90) target=22 ;;
      88) target=23 ;; 67) target=24 ;; 86) target=25 ;; 66) target=26 ;;
      78) target=27 ;; 77) target=28 ;;
      *) echo "Unsupported search character code: $code" >&2; exit 1 ;;
    esac
    right_distance=$(((target - focus + 29) % 29))
    left_distance=$(((focus - target + 29) % 29))
    if [ "$right_distance" -le "$left_distance" ]; then
      moves=$right_distance
      direction=D_RIGHT
    else
      moves=$left_distance
      direction=D_LEFT
    fi
    while [ "$moves" -gt 0 ]; do
      signature_count=$(line_count "signature=")
      press "$direction"
      wait_for_new "signature=" "$signature_count"
      moves=$((moves - 1))
    done
    signature_count=$(line_count "signature=")
    press A
    wait_for_new "signature=" "$signature_count"
    focus=$target
  done
}

ensure_playback_playing() {
  attempt=0
  while [ "$attempt" -lt 5 ]; do
    playback_state=$(sed -n \
      's/.*REFERENCE GX: playback=\(playing\|paused\).*/\1/p' \
      "$log" 2>/dev/null | tail -1)
    if [ "$playback_state" = "playing" ]; then
      return
    fi
    press A
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "Could not establish playing state after $attempt controller attempts; latest state was ${playback_state:-unknown}." >&2
  exit 1
}

if [ "$direct_plex" -eq 1 ]; then
  wait_log "auth restored" 600
  wait_log "direct Plex catalog rows=" 1200
  if [ "$wait_artwork" -eq 1 ]; then
    wait_log "direct Plex posters decoded=" 1200
  fi
else
  wait_log "gateway-catalog version=3" 600
  wait_log "gateway-artwork .*loaded=1" 1200
fi
wait_log "signature=" 600
exec 3>"$pipe"
pipe_open=1
signature_count=$(line_count "signature=")
if [ -n "$multiplex_base_url" ]; then
  if grep -q "auth restored" "$log"; then
    wait_log "background account data ready" 1200
  elif ! grep -q "gateway-pairing status=2" "$log"; then
    wait_log "gateway-pairing status=1" 600
    wait_for_new "gateway-pairing status=2" 0 3600
    wait_for_new "signature=" "$signature_count"
  fi
else
  press A
  wait_for_new "signature=" "$signature_count"
fi

if [ "$interactive" -eq 1 ]; then
  echo "$console_name interactive Plex QA is ready."
  wait "$launcher_pid"
  exit 0
fi

if [ "$focus_audit" -eq 1 ]; then
  audit_focus_cycle

  # Y opens Libraries from Home without coupling the audit to catalog size.
  signature_count=$(line_count "signature=")
  press Y
  wait_for_new "signature=" "$signature_count"
  audit_focus_cycle

  # Libraries focus starts at Home, followed by real Plex libraries.
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
  browse_count=$(line_count "browse-page ready")
  signature_count=$(line_count "signature=")
  press A
  wait_for_new "browse-page ready" "$browse_count" 1200
  wait_for_new "signature=" "$signature_count"
  audit_focus_cycle

  signature_count=$(line_count "signature=")
  press B
  wait_for_new "signature=" "$signature_count"
  signature_count=$(line_count "signature=")
  press B
  wait_for_new "signature=" "$signature_count"
fi

# Search is fully controller-authored. Z opens it, A enters each focused
# letter, and R submits the query.
signature_count=$(line_count "signature=")
press Z
wait_for_new "signature=" "$signature_count"
if [ "$focus_audit" -eq 1 ]; then
  audit_focus_cycle
fi
type_search_query "$search_query"
search_count=$(line_count "search-page ready query=$search_query")
signature_count=$(line_count "signature=")
press R
wait_for_new "search-page ready query=$search_query" "$search_count" 1200
wait_for_new "signature=" "$signature_count"
if [ "$focus_audit" -eq 1 ]; then
  audit_focus_cycle
fi

# Open the selected real search result and exercise playback from that origin. The
# browse paging route has its own committed coverage; keeping it out of this
# player smoke avoids unrelated poster transfers before every seek test.
result_focus=0
while [ "$result_focus" -lt "$search_result_index" ]; do
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
  result_focus=$((result_focus + 1))
done
signature_count=$(line_count "signature=")
details_count=$(line_count "details-page ready")
if [ "$tv_hierarchy" -eq 1 ]; then
  children_count=$(line_count "details children ready")
fi
press A
wait_for_new "details-page ready" "$details_count" 1200
wait_for_new "signature=" "$signature_count"
if [ "$tv_hierarchy" -eq 1 ]; then
  wait_for_new "details children ready" "$children_count" 1200
  if [ "$focus_audit" -eq 1 ]; then
    audit_focus_cycle
  fi
  season_focus=0
  while [ "$season_focus" -lt "$tv_season_index" ]; do
    signature_count=$(line_count "signature=")
    press D_RIGHT
    wait_for_new "signature=" "$signature_count"
    season_focus=$((season_focus + 1))
  done
  details_count=$(line_count "details-page ready")
  children_count=$(line_count "details children ready")
  signature_count=$(line_count "signature=")
  press A
  wait_for_new "details-page ready" "$details_count" 1200
  wait_for_new "details children ready" "$children_count" 1200
  wait_for_new "signature=" "$signature_count"
  if [ "$focus_audit" -eq 1 ]; then
    audit_focus_cycle
  fi
  current_episode_page=0
  while [ "$current_episode_page" -lt "$tv_episode_page" ]; do
    children_count=$(line_count "details children ready")
    signature_count=$(line_count "signature=")
    press R
    wait_for_new "details children ready" "$children_count" 1200
    wait_for_new "signature=" "$signature_count"
    current_episode_page=$((current_episode_page + 1))
  done
  episode_focus=0
  while [ "$episode_focus" -lt "$tv_episode_index" ]; do
    signature_count=$(line_count "signature=")
    press D_RIGHT
    wait_for_new "signature=" "$signature_count"
    episode_focus=$((episode_focus + 1))
  done
  details_count=$(line_count "details-page ready")
  signature_count=$(line_count "signature=")
  press A
  wait_for_new "details-page ready" "$details_count" 1200
  wait_for_new "signature=" "$signature_count"
fi
if [ "$focus_audit" -eq 1 ]; then
  audit_focus_cycle
fi
if [ "$watch_together" -eq 1 ]; then
  # Watch Together creation lives in the Start menu, matching Plex's More
  # actions flow. START opens it with its primary action focused.
  signature_count=$(line_count "signature=")
  press START
  wait_for_new "signature=" "$signature_count"
fi
playing_count=$(line_count "playback=playing")
paused_count=$(line_count "playback=paused")
if [ "$direct_plex" -eq 1 ]; then
  playback_ready_pattern="direct playback ready"
  playback_activation_pattern="direct playback activated"
  playback_switch_pattern="direct playback activated"
  timeline_pattern="direct Plex timeline"
else
  playback_ready_pattern="playback-session ready"
  playback_activation_pattern="playback-session activated"
  playback_switch_pattern="playback-session .*switch"
  timeline_pattern="gateway-timeline"
fi
playback_session_count=$(line_count "$playback_ready_pattern")
playback_activation_count=$(line_count "$playback_activation_pattern")
if [ "$watch_together" -eq 1 ]; then
  created_count=$(line_count "Watch Together room created")
  invitee_index=$(
    bun "$script_dir/syncplay-room-control.ts" list-invitees |
      awk -v id="$watch_together_invitee_id" '$1 == id { print NR - 1; exit }'
  )
  case "$invitee_index" in
    '' | *[!0-9]*)
      echo "Plex user $watch_together_invitee_id is not available in the GameCube invite list." >&2
      exit 1
      ;;
  esac
  invitee_page=$((invitee_index / 4))
  invitee_index_on_page=$((invitee_index % 4))
  # Open the invite picker. Back is the first focusable control, followed by
  # the Plex invitees in API order.
  signature_count=$(line_count "signature=")
  press A
  wait_for_new "signature=" "$signature_count"
  current_invitee_page=0
  while [ "$current_invitee_page" -lt "$invitee_page" ]; do
    # Page one has Back, four invitees, then Next.
    page_focus=0
    while [ "$page_focus" -lt 5 ]; do
      signature_count=$(line_count "signature=")
      press D_RIGHT
      wait_for_new "signature=" "$signature_count"
      page_focus=$((page_focus + 1))
    done
    signature_count=$(line_count "signature=")
    press A
    wait_for_new "signature=" "$signature_count"
    current_invitee_page=$((current_invitee_page + 1))
  done
  invitee_focus=0
  while [ "$invitee_focus" -le "$invitee_index_on_page" ]; do
    signature_count=$(line_count "signature=")
    press D_RIGHT
    wait_for_new "signature=" "$signature_count"
    invitee_focus=$((invitee_focus + 1))
  done
  press A
  wait_for_new "Watch Together room created" "$created_count" 1200
  created_room_id=$(sed -n \
    's/.*Watch Together room created id=\([A-Za-z0-9][A-Za-z0-9]*\).*/\1/p' \
    "$log" | tail -1)
  if [ -z "$created_room_id" ]; then
    echo "The GameCube-created Watch Together room id was not found in the Dolphin log." >&2
    exit 1
  fi
  signature_count=$(line_count "signature=")
  press D_RIGHT
  wait_for_new "signature=" "$signature_count"
  join_count=$(line_count "Watch Together lobby room=0 connected=1 invited=2")
  press A
  wait_for_new "Watch Together lobby room=0 connected=1 invited=2" \
    "$join_count" 3600
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    start_browser_guest
  else
    MULTIPLEX_WATCH_TOGETHER_ROOM_ID="$created_room_id" \
      bun "$script_dir/syncplay-room-control.ts" join-lobby \
        "$watch_together_invitee_id" >"$cache_dir/syncplay-lobby.log" 2>&1 &
    lobby_pid=$!
  fi
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    wait_for_browser_guest "Browser guest joined room=$created_room_id" 0 600
  fi
else
  press A
fi
wait_for_new "$playback_activation_pattern" "$playback_activation_count" 3600
wait_for_new "$playback_ready_pattern" "$playback_session_count" 1200
sleep 1
ensure_playback_playing
if [ "$test_subtitle_cycle" -eq 1 ]; then
  if ! grep -q "$playback_activation_pattern .*subtitles=burn" "$log"; then
    echo "Subtitle cycling requires a server-selected indexed subtitle track." >&2
    exit 1
  fi
  initial_subtitle_mode=$(sed -n \
    "s/.*$playback_activation_pattern .*subtitles=\([^ ]*\) index=\([0-9][0-9]*\).*/\1:\2/p" \
    "$log" | tail -1)
  subtitle_switch_count=$(line_count "$playback_switch_pattern")
  subtitle_focus=0
  while [ "$subtitle_focus" -lt 3 ]; do
    signature_count=$(line_count "signature=")
    press D_RIGHT
    wait_for_new "signature=" "$signature_count"
    subtitle_focus=$((subtitle_focus + 1))
  done
  press A
  wait_for_new "$playback_switch_pattern" "$subtitle_switch_count" 3600
  selected_subtitle_mode=$(sed -n \
    "s/.*$playback_activation_pattern .*subtitles=\([^ ]*\) index=\([0-9][0-9]*\).*/\1:\2/p" \
    "$log" | tail -1)
  if [ -z "$selected_subtitle_mode" ] || \
    [ "$selected_subtitle_mode" = "$initial_subtitle_mode" ]; then
    echo "The subtitle control did not restart playback with a different track." >&2
    exit 1
  fi
  ensure_playback_playing
  echo "Cycled the Plex subtitle selection from $initial_subtitle_mode to $selected_subtitle_mode through the Native SDK player control."
fi
if [ "$watch_together_browser_guest" -eq 1 ]; then
  wait_for_browser_guest "Browser guest advancing room=$created_room_id" 0 1200
fi

if [ "$expect_autoplay_next" -eq 1 ]; then
  selected_rating_key=$(sed -n \
    "s/.*$playback_ready_pattern rating-key=\([0-9][0-9]*\).*/\1/p" \
    "$log" | head -1)
  if [ "$watch_together" -eq 1 ]; then
    autoplay_pattern="Watch Together autoplay-next"
  else
    autoplay_pattern="direct autoplay-next"
  fi
  wait_log "$autoplay_pattern previous=$selected_rating_key active=$expected_autoplay_rating_key" 3600
  if [ "$watch_together" -eq 1 ]; then
    rotated_room_id=$(sed -n \
      "s/.*$autoplay_pattern previous=[0-9][0-9]* active=[0-9][0-9]* room=\([A-Za-z0-9][A-Za-z0-9]*\).*/\1/p" \
      "$log" | tail -1)
    if [ -z "$rotated_room_id" ]; then
      echo "The rotated Watch Together room id was not found in the Dolphin log." >&2
      exit 1
    fi
    created_room_id=$rotated_room_id
  fi
  wait_log "direct playback ready rating-key=$expected_autoplay_rating_key offset=0" 3600
  wait_for_new "playback=playing" "$((playing_count + 1))" 1200
  if [ "$watch_together" -eq 1 ]; then
    wait_for_browser_guest "Browser guest rating-key=$expected_autoplay_rating_key" 0 1200
    wait_for_browser_guest "Browser guest advancing .*rating-key=$expected_autoplay_rating_key" 0 1200
  fi
  wait_log "direct Plex timeline rating-key=$selected_rating_key .*state=stopped reported=1" 600
  sleep "$sustain_seconds"
  sh "$script_dir/check-dolphin-log.sh" "$log"
  if grep -Eq 'layout-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
    echo "Native SDK layout audit found damage during autoplay." >&2
    exit 1
  fi
  if grep -Eq 'poster-inset-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
    echo "Poster cards contain unintended image padding during autoplay." >&2
    exit 1
  fi
  if ! grep -q 'video-surface x=0 y=0 width=640 height=480' "$log"; then
    echo "The autoplayed episode did not retain fullscreen video." >&2
    exit 1
  fi
  if [ "$watch_together" -eq 1 ]; then
    echo "Automatically advanced Plex episode $selected_rating_key to $expected_autoplay_rating_key across Dolphin and the browser guest."
  else
    echo "Automatically advanced Plex episode $selected_rating_key to $expected_autoplay_rating_key in Dolphin."
  fi
  if [ -n "$mute_pid" ]; then
    wait "$mute_pid" 2>/dev/null || true
    mute_pid=
  fi
  if [ -f "$mute_marker" ]; then
    echo "Dolphin host audio is muted; emulated AI DMA remains active for timing tests."
  fi
  if [ "$keep_open" -eq 1 ]; then
    wait "$launcher_pid"
  fi
  exit 0
fi

selected_rating_key=$(sed -n "s/.*$playback_ready_pattern rating-key=\\([0-9][0-9]*\\).*/\\1/p" "$log" | tail -1)
initial_offset=$(sed -n "s/.*$playback_ready_pattern rating-key=[0-9][0-9]* offset=\\([0-9][0-9]*\\).*/\\1/p" "$log" | tail -1)
switch_count=$(line_count "$playback_switch_pattern")
playing_count=$(line_count "playback=playing")
press R
wait_for_new "$playback_switch_pattern" "$switch_count" 3600
wait_for_new "playback=playing" "$playing_count" 1200
seek_offset=$(sed -n "s/.*$playback_ready_pattern rating-key=$selected_rating_key offset=\\([0-9][0-9]*\\).*/\\1/p" "$log" | tail -1)
minimum_seek_offset=$((initial_offset + 30000))
maximum_seek_offset=$((minimum_seek_offset + 3000))
if [ "$seek_offset" -lt "$minimum_seek_offset" ] || \
   [ "$seek_offset" -gt "$maximum_seek_offset" ]; then
  echo "Selected Plex seek activated unexpected offset $seek_offset (wanted $minimum_seek_offset..$maximum_seek_offset)." >&2
  exit 1
fi
if [ "$focus_audit" -eq 1 ]; then
  audit_focus_cycle
fi
if [ "$watch_together_browser_guest" -eq 1 ]; then
  browser_minimum_seek_offset=$((seek_offset - 3000))
  browser_maximum_seek_offset=$((seek_offset + 3000))
  wait_for_browser_guest_seek \
    "$browser_minimum_seek_offset" "$browser_maximum_seek_offset" 1200
fi

if [ "$expect_continuation" -eq 1 ]; then
  continuation_count=$(line_count "playback-continuation requested")
  switch_count=$(line_count "playback-session .*switch")
  playing_count=$(line_count "playback=playing")
  wait_for_new "playback-continuation requested" "$continuation_count" 1200
  wait_for_new "playback-session .*switch" "$switch_count" 3600
  wait_for_new "playback=playing" "$playing_count" 1200
  continuation_offset=$(sed -n 's/.*playback-continuation requested rating-key=[0-9][0-9]* offset=\([0-9][0-9]*\).*/\1/p' "$log" | tail -1)
  if ! grep -q "playback-session ready rating-key=$selected_rating_key offset=$continuation_offset" "$log"; then
    echo "Automatic Plex continuation did not activate offset $continuation_offset." >&2
    exit 1
  fi
  echo "Automatically continued selected Plex item $selected_rating_key from ${seek_offset}ms to ${continuation_offset}ms."
fi

# The web Syncplay controller deliberately ignores remote pauses for five
# seconds after connecting so the room's paused lobby baseline cannot defeat
# autoplay. Let that grace period expire before testing a deliberate GameCube
# pause, otherwise a fast run can race the intended startup behavior.
if [ "$watch_together_browser_guest" -eq 1 ]; then
  sleep 6
fi

# Prove deliberate player state edges reach Plex as well as periodic progress.
paused_count=$(line_count "playback=paused")
paused_timeline_count=$(line_count "$timeline_pattern .*state=paused reported=1")
press A
if [ "$(line_count "playback=paused")" -le "$paused_count" ]; then
  # An idle player consumes the first A to reveal its hidden controls.
  press A
fi
wait_for_new "playback=paused" "$paused_count" 120
wait_for_new "$timeline_pattern .*state=paused reported=1" "$paused_timeline_count" 600
if [ "$watch_together_browser_guest" -eq 1 ]; then
  wait_for_synced_playback_state paused 1200
fi
playing_count=$(line_count "playback=playing")
playing_timeline_count=$(line_count "$timeline_pattern .*state=playing reported=1")
decoder_count=$(line_count "decoder=60 frames/")
press A
wait_for_new "playback=playing" "$playing_count" 120
wait_for_new "$timeline_pattern .*state=playing reported=1" "$playing_timeline_count" 600
wait_for_new "decoder=60 frames/" "$decoder_count" 1200
if [ "$watch_together_browser_guest" -eq 1 ]; then
  wait_for_synced_playback_state playing 1200
fi
if [ "$watch_together" -eq 1 ]; then
  remote_pause_count=$(line_count "Syncplay remote playback paused=1")
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    printf 'pause\n' >"$browser_guest_control"
    wait_for_browser_guest "Browser guest command=pause" 0 300
  else
    MULTIPLEX_WATCH_TOGETHER_ROOM_ID="$created_room_id" \
      bun "$script_dir/syncplay-room-control.ts" pause
  fi
  wait_for_new "Syncplay remote playback paused=1" "$remote_pause_count" 600
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    wait_for_synced_playback_state paused 1200
  fi
  remote_resume_count=$(line_count "Syncplay remote playback paused=0")
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    printf 'resume\n' >"$browser_guest_control"
    wait_for_browser_guest "Browser guest command=resume" 0 300
  else
    MULTIPLEX_WATCH_TOGETHER_ROOM_ID="$created_room_id" \
      bun "$script_dir/syncplay-room-control.ts" resume
  fi
  wait_for_new "Syncplay remote playback paused=0" "$remote_resume_count" 600
  if [ "$watch_together_browser_guest" -eq 1 ]; then
    wait_for_synced_playback_state playing 1200
    remote_seek_count=$(line_count "Syncplay remote playback .*seek=1")
    playback_ready_count=$(line_count "$playback_ready_pattern")
    printf 'seek-10-percent\n' >"$browser_guest_control"
    wait_for_browser_guest "Browser guest command=seek-10-percent" 0 300
    wait_for_new "Syncplay remote playback .*seek=1" "$remote_seek_count" 1200
    wait_for_new "$playback_ready_pattern" "$playback_ready_count" 3600
    browser_seek_offset=$(sed -n \
      "s/.*$playback_ready_pattern rating-key=[0-9][0-9]* offset=\\([0-9][0-9]*\\).*/\\1/p" \
      "$log" | tail -1)
    case "$browser_seek_offset" in
      '' | *[!0-9]*)
        echo "The GameCube remote-seek offset was not found in the Dolphin log." >&2
        exit 1
        ;;
    esac
    browser_minimum_seek_offset=$((browser_seek_offset - 5000))
    browser_maximum_seek_offset=$((browser_seek_offset + 5000))
    wait_for_browser_guest_seek \
      "$browser_minimum_seek_offset" "$browser_maximum_seek_offset" 1200
    wait_for_synced_playback_state playing 1200

    participant_left_count=$(line_count "Syncplay participants=1")
    printf 'disconnect\n' >"$browser_guest_control"
    wait_for_browser_guest "Browser guest command=disconnect" 0 300
    wait "$lobby_pid"
    lobby_pid=
    wait_for_new "Syncplay participants=1" "$participant_left_count" 600

    participant_rejoined_count=$(line_count "Syncplay participants=2")
    start_browser_guest
    wait_for_browser_guest "Browser guest joined room=$created_room_id" 0 600
    wait_for_new "Syncplay participants=2" "$participant_rejoined_count" 600
    browser_reconnect_minimum_offset=$((browser_seek_offset - 5000))
    browser_reconnect_maximum_offset=$((browser_seek_offset + 30000))
    wait_for_browser_guest_seek \
      "$browser_reconnect_minimum_offset" "$browser_reconnect_maximum_offset" 1200
    wait_for_synced_playback_state playing 1200
    rejoined_participants=$(sed -n \
      's/.*REFERENCE GX: Syncplay participants=\([0-9][0-9]*\).*/\1/p' \
      "$log" | tail -1)
    if [ "$rejoined_participants" != "2" ]; then
      echo "The recovered room did not retain both participants; latest count was ${rejoined_participants:-unknown}." >&2
      exit 1
    fi
  fi
fi
sleep "$sustain_seconds"
if grep -Eq 'underruns=[1-9][0-9]*' "$log"; then
  echo "Selected Plex seek produced an audio underrun." >&2
  exit 1
fi
wait_log "$timeline_pattern rating-key=$selected_rating_key .*state=playing reported=1" 600
if [ "$watch_together_browser_guest" -eq 1 ]; then
  reconnect_requested_count=$(line_count "Syncplay reconnect requested room=")
  reconnected_count=$(line_count "Syncplay reconnected room=")
  reconnect_participants_count=$(line_count "Syncplay participants=2")
  press D_RIGHT
  press D_RIGHT
  press A
  wait_for_new "Syncplay reconnect requested room=" \
    "$reconnect_requested_count" 600
  wait_for_new "Syncplay reconnected room=" "$reconnected_count" 600
  wait_for_new "Syncplay participants=2" "$reconnect_participants_count" 600
  wait_for_synced_playback_state playing 1200

  disbanded_room_count=$(line_count "Watch Together disbanded room=")
  stopped_timeline_count=$(line_count "$timeline_pattern .*state=stopped reported=1")
  press D_RIGHT
  press D_RIGHT
  press D_RIGHT
  press A
  wait_for_new "Watch Together disbanded room=$created_room_id deleted=1" \
    "$disbanded_room_count" 600
  wait_for_new "$timeline_pattern .*state=stopped reported=1" \
    "$stopped_timeline_count" 600
  rooms_after_disband=$(bun "$script_dir/syncplay-room-control.ts" list-rooms)
  if printf '%s\n' "$rooms_after_disband" | awk -v id="$created_room_id" \
    '$1 == id { found = 1 } END { exit found ? 0 : 1 }'; then
    echo "GameCube reported disbanding room $created_room_id, but Multiplex still lists it." >&2
    exit 1
  fi
  disbanded_room_id=$created_room_id
  created_room_id=
fi
sh "$script_dir/check-dolphin-log.sh" "$log"
if grep -Eq 'layout-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
  echo "Native SDK layout audit found overflow, overlap, escape, or hit-target damage." >&2
  grep 'layout-audit findings=' "$log" >&2
  exit 1
fi
if grep -Eq 'poster-inset-audit findings=([1-9][0-9]*|4294967295)' "$log"; then
  echo "Poster cards contain unintended image padding." >&2
  grep 'poster-inset-audit findings=' "$log" >&2
  exit 1
fi
if ! grep -q 'video-surface x=0 y=0 width=640 height=480' "$log"; then
  echo "The native video surface did not fill the 640x480 GameCube viewport." >&2
  grep 'video-surface' "$log" >&2 || true
  exit 1
fi

if [ "$direct_plex" -eq 1 ]; then
  if [ "$watch_together" -eq 1 ]; then
    if [ "$watch_together_browser_guest" -eq 1 ]; then
      echo "Completed playback, synchronization, recovery, reconnect, and disband checks for Plex item $selected_rating_key in Watch Together room $disbanded_room_id."
    else
      echo "Playing selected Plex item $selected_rating_key in Watch Together room $created_room_id directly from PMS at ${seek_offset}ms in Dolphin."
    fi
  else
    echo "Playing selected Plex item $selected_rating_key directly from PMS at ${seek_offset}ms in Dolphin."
  fi
else
  echo "Playing selected Plex item $selected_rating_key at ${seek_offset}ms in Dolphin (startup fixture '$title' is $container_bytes bytes)."
fi
if [ -n "$mute_pid" ]; then
  wait "$mute_pid" 2>/dev/null || true
  mute_pid=
fi
if [ -f "$mute_marker" ]; then
  echo "Dolphin host audio is muted; emulated AI DMA remains active for timing tests."
else
  echo "Dolphin host audio could not be muted; emulated playback remains active."
fi
if [ "$keep_open" -eq 1 ]; then
  wait "$launcher_pid"
fi
