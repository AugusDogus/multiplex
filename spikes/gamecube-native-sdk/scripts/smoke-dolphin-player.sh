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
cleanup() {
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
  (
    printf 'PRESS %s\n' "$button"
    sleep 8
  ) >"$pipe" &
  writer=$!
  wait_for_new "controller buttons" "$previous" 80
  kill "$writer" 2>/dev/null || true
  (
    printf 'RELEASE %s\n' "$button"
    sleep 0.2
  ) >"$pipe" &
}

wait_for_new "signature=fa6601eb" 0 120

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
press A
wait_for_new "signature=f3bd7219" "$player_count" 120

video_count=$(line_count "video=120 frames/")
wait_for_new "video=120 frames/" "$video_count" 80

paused_count=$(line_count "signature=f3bd7219")
press A
wait_for_new "signature=f3bd7219" "$paused_count" 80
video_count=$(line_count "video=120 frames/")
sleep 5
if [ "$(line_count "video=120 frames/")" -ne "$video_count" ]; then
  echo "Video producer advanced while playback was paused." >&2
  exit 1
fi

press A
wait_for_new "video=120 frames/" "$video_count" 80

sh "$script_dir/check-dolphin-log.sh"
echo "Dolphin player smoke passed: navigation, 30 fps media, pause, resume, and clean memory log."
