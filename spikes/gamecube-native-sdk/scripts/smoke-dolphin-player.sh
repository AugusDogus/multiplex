#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
dol="$spike_dir/multiplex-gamecube-native-reference.dol"
user_dir="$spike_dir/.dolphin-user"
log="$user_dir/Logs/dolphin.log"
pipe="$user_dir/Pipes/multiplex1"

if [ ! -s "$dol" ]; then
  echo "Missing $dol; run bun run spike:gamecube:reference:dol first." >&2
  exit 1
fi

launcher_pid=
mute_pid=
pipe_open=0
stop_launcher() {
  signal=$1
  if command -v setsid >/dev/null 2>&1; then
    /bin/kill "-$signal" -- "-$launcher_pid" 2>/dev/null || true
  else
    kill "-$signal" "$launcher_pid" 2>/dev/null || true
  fi
}

cleanup() {
  if [ "$pipe_open" -eq 1 ]; then
    exec 3>&-
    pipe_open=0
  fi
  if [ -n "$mute_pid" ] && kill -0 "$mute_pid" 2>/dev/null; then
    kill -TERM "$mute_pid" 2>/dev/null || true
    wait "$mute_pid" 2>/dev/null || true
  fi
  if [ -n "$launcher_pid" ] && kill -0 "$launcher_pid" 2>/dev/null; then
    stop_launcher TERM
    attempt=0
    while kill -0 "$launcher_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
    if kill -0 "$launcher_pid" 2>/dev/null; then
      stop_launcher KILL
    fi
    wait "$launcher_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mute_dolphin_host_audio() {
  attempt=0
  while [ "$attempt" -lt 200 ]; do
    sink_inputs=$(
      pactl -f json list sink-inputs 2>/dev/null |
        jq -r '.[] | select(.properties["application.process.binary"] == "dolphin-emu") | .index' 2>/dev/null || true
    )
    if [ -n "$sink_inputs" ]; then
      for sink_input in $sink_inputs; do
        pactl set-sink-input-mute "$sink_input" 1 2>/dev/null || true
      done
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
}

# Clear the current-run path before the asynchronous launcher starts. Without
# this handoff, the first wait can briefly match a completed run immediately
# before run-dolphin.sh archives that same log.
if [ -f "$log" ]; then
  mv -f "$log" "$user_dir/Logs/dolphin.previous.log"
fi

if command -v setsid >/dev/null 2>&1; then
  setsid sh "$script_dir/run-dolphin.sh" "$dol" >/dev/null 2>&1 &
else
  sh "$script_dir/run-dolphin.sh" "$dol" >/dev/null 2>&1 &
fi
launcher_pid=$!
if command -v pactl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  mute_dolphin_host_audio &
  mute_pid=$!
fi

line_count() {
  if [ ! -f "$log" ]; then
    echo 0
    return
  fi
  grep -c "$1" "$log" 2>/dev/null || true
}

wait_for_new() {
  pattern=$1
  previous=$2
  attempts=${3:-120}
  attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    current=$(line_count "$pattern")
    if [ "$current" -gt "$previous" ]; then
      return
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done
  echo "Timed out waiting for Dolphin log pattern: $pattern" >&2
  tail -80 "$log" >&2 || true
  exit 1
}

press() {
  button=$1
  previous=$(line_count "controller buttons")
  attempt=0
  while [ "$attempt" -lt 16 ]; do
    printf 'RELEASE %s\n' "$button" >&3
    sleep 0.05
    printf 'PRESS %s\n' "$button" >&3
    poll=0
    while [ "$poll" -lt 5 ]; do
      if [ "$(line_count "controller buttons")" -gt "$previous" ]; then
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
  tail -80 "$log" >&2 || true
  exit 1
}

expected_media_source=${GAMECUBE_EXPECT_MEDIA_SOURCE:-embedded}
expected_media_bytes=${GAMECUBE_EXPECT_MEDIA_BYTES:-155648}
case "$expected_media_source" in
  embedded)
    media_attempts=120
    decoder_attempts=120
    playback_attempts=80
    expected_pts_delta=902
    expected_pts_offset_samples=481
    ;;
  http)
    media_attempts=${GAMECUBE_MEDIA_ATTEMPTS:-1200}
    decoder_attempts=300
    playback_attempts=200
    expected_pts_delta=902
    expected_pts_offset_samples=481
    ;;
  *)
    echo "Unsupported GAMECUBE_EXPECT_MEDIA_SOURCE: $expected_media_source" >&2
    exit 1
    ;;
esac
wait_for_new "media-source=$expected_media_source" 0 "$media_attempts"
if ! rg -q "media-source=$expected_media_source .*bytes=$expected_media_bytes" "$log"; then
  echo "Unexpected $expected_media_source media payload." >&2
  rg 'media-source=' "$log" >&2 || true
  exit 1
fi
wait_for_new "signature=" 0 120
wait_for_new "demux=mpeg-ps" 0 120
if ! rg -q "demux=mpeg-ps .*pts-delta=$expected_pts_delta" "$log"; then
  echo "MPEG-PS demux did not preserve the expected initial PTS delta." >&2
  rg 'demux=mpeg-ps' "$log" >&2 || true
  exit 1
fi
wait_for_new "audio=ffmpeg-mplayer-ce codec=mp2 output=ai-dma" 0 120
exec 3>"$pipe"
pipe_open=1
sleep 0.5

home_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$home_count" 120

focus_count=$(line_count "signature=")
press D_RIGHT
wait_for_new "signature=" "$focus_count" 80

details_count=$(line_count "signature=")
press A
wait_for_new "signature=" "$details_count" 120

details_focus_count=$(line_count "signature=")
press D_RIGHT
wait_for_new "signature=" "$details_focus_count" 80

player_count=$(line_count "signature=")
playing_count=$(line_count "playback=playing")
audio_playing_count=$(line_count "audio=playing")
press A
wait_for_new "signature=" "$player_count" 120
wait_for_new "playback=playing" "$playing_count" "$playback_attempts"
wait_for_new "audio=playing" "$audio_playing_count" "$playback_attempts"
if ! rg -q "playback=playing .*pts-offset-samples=$expected_pts_offset_samples" "$log"; then
  echo "Video scheduler did not apply the MPEG-PS timestamp offset." >&2
  exit 1
fi

decoder_count=$(line_count "decoder=60 frames/")
wait_for_new "decoder=60 frames/" "$decoder_count" "$decoder_attempts"

paused_count=$(line_count "signature=")
playback_paused_count=$(line_count "playback=paused")
press A
wait_for_new "signature=" "$paused_count" 80
wait_for_new "playback=paused" "$playback_paused_count" 80
decoder_count=$(line_count "decoder=60 frames/")
sleep 5
if [ "$(line_count "decoder=60 frames/")" -ne "$decoder_count" ]; then
  echo "Video decoder advanced while playback was paused." >&2
  exit 1
fi

playing_count=$(line_count "playback=playing")
audio_playing_count=$(line_count "audio=playing")
presentation_count=$(line_count "presentation=120 frames/1985316us (60.4 fps)")
press A
wait_for_new "playback=playing" "$playing_count" 80
wait_for_new "audio=playing" "$audio_playing_count" 80
wait_for_new "decoder=60 frames/" "$decoder_count" 140
wait_for_new "presentation=120 frames/1985316us (60.4 fps)" \
  "$presentation_count" 100

decoder_fps_tenths=$(
  rg 'decoder=60 frames/' "$log" |
    tail -1 |
    sed -n 's/.*(\([0-9][0-9]*\)\.\([0-9]\) fps).*/\1\2/p'
)
if [ -z "$decoder_fps_tenths" ] ||
  [ "$decoder_fps_tenths" -lt 295 ] ||
  [ "$decoder_fps_tenths" -gt 305 ]; then
  echo "DVD-resolution decoder missed its 29.97 fps clock: ${decoder_fps_tenths:-missing} tenths." >&2
  exit 1
fi

paused_audio_samples=$(
  rg 'audio=paused samples=' "$log" |
    tail -1 |
    sed -n 's/.*samples=\([0-9][0-9]*\).*/\1/p'
)
resumed_audio_samples=$(
  rg 'audio=playing samples=' "$log" |
    tail -1 |
    sed -n 's/.*samples=\([0-9][0-9]*\).*/\1/p'
)
if [ -z "$paused_audio_samples" ] ||
  [ "$paused_audio_samples" != "$resumed_audio_samples" ]; then
  echo "AI DMA audio advanced while paused: paused=${paused_audio_samples:-missing} resumed=${resumed_audio_samples:-missing}." >&2
  exit 1
fi
if rg -q 'underruns=[1-9][0-9]*' "$log"; then
  echo "AI DMA audio buffer underrun detected." >&2
  rg 'audio.*underruns=' "$log" >&2
  exit 1
fi
if [ "$(line_count "playback=playing clock=audio")" -lt 2 ]; then
  echo "Video playback did not use the AI DMA sample clock across resume." >&2
  exit 1
fi

sh "$script_dir/check-dolphin-log.sh"
echo "Dolphin player smoke passed with $expected_media_source media: navigation, timestamped MPEG-PS playback, 60 fps presentation, pause/resume, and clean memory log."
