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
pipe_open=0
cleanup() {
  if [ "$pipe_open" -eq 1 ]; then
    exec 3>&-
    pipe_open=0
  fi
  if [ -n "$launcher_pid" ] && kill -0 "$launcher_pid" 2>/dev/null; then
    kill -TERM "$launcher_pid" 2>/dev/null || true
    attempt=0
    while kill -0 "$launcher_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
      sleep 0.1
      attempt=$((attempt + 1))
    done
    if kill -0 "$launcher_pid" 2>/dev/null; then
      kill -KILL "$launcher_pid" 2>/dev/null || true
    fi
    wait "$launcher_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

sh "$script_dir/run-dolphin.sh" "$dol" >/dev/null 2>&1 &
launcher_pid=$!

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

wait_for_new "signature=fa6601eb" 0 120
wait_for_new "audio=ffmpeg-mplayer-ce codec=mp2 output=ai-dma" 0 120
exec 3>"$pipe"
pipe_open=1
sleep 0.5

home_count=$(line_count "signature=4dcbccff")
press A
wait_for_new "signature=4dcbccff" "$home_count" 120

focus_count=$(line_count "signature=683f174f")
press D_RIGHT
wait_for_new "signature=683f174f" "$focus_count" 80

details_count=$(line_count "signature=8e79132e")
press A
wait_for_new "signature=8e79132e" "$details_count" 120

details_focus_count=$(line_count "signature=c3a0002e")
press D_RIGHT
wait_for_new "signature=c3a0002e" "$details_focus_count" 80

player_count=$(line_count "signature=f3bd7219")
playing_count=$(line_count "playback=playing")
audio_playing_count=$(line_count "audio=playing")
press A
wait_for_new "signature=f3bd7219" "$player_count" 120
wait_for_new "playback=playing" "$playing_count" 80
wait_for_new "audio=playing" "$audio_playing_count" 80

decoder_count=$(line_count "decoder=60 frames/")
wait_for_new "decoder=60 frames/" "$decoder_count" 120

paused_count=$(line_count "signature=f3bd7219")
playback_paused_count=$(line_count "playback=paused")
press A
wait_for_new "signature=f3bd7219" "$paused_count" 80
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
echo "Dolphin player smoke passed: navigation, audio-mastered 720x480 MPEG-2/MP2 playback, 60 fps presentation, pause/resume, and clean memory log."
