#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
user_dir="$spike_dir/.dolphin-user"
pid_file="$user_dir/dolphin.pid"
dol="${1:-$spike_dir/multiplex-gamecube-spike.dol}"

if [ ! -s "$dol" ]; then
  echo "Missing $dol; run bun run spike:gamecube:dol first." >&2
  exit 1
fi

if [ -f "$pid_file" ]; then
  previous_pid=$(sed -n '1p' "$pid_file")
  case "$previous_pid" in
    *[!0-9]* | "") ;;
    *)
      if kill -0 "$previous_pid" 2>/dev/null; then
        kill -TERM "$previous_pid"
        attempt=0
        while kill -0 "$previous_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
          sleep 0.1
          attempt=$((attempt + 1))
        done
        if kill -0 "$previous_pid" 2>/dev/null; then
          kill -KILL "$previous_pid"
          attempt=0
          while kill -0 "$previous_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
            sleep 0.1
            attempt=$((attempt + 1))
          done
        fi
      fi
      ;;
  esac
fi

mkdir -p "$user_dir/Config" "$user_dir/Pipes"
cp "$spike_dir/dolphin/Dolphin.ini" "$user_dir/Config/Dolphin.ini"
cp "$spike_dir/dolphin/GCPadNew.ini" "$user_dir/Config/GCPadNew.ini"
cp "$spike_dir/dolphin/GFX.ini" "$user_dir/Config/GFX.ini"
cp "$spike_dir/dolphin/Logger.ini" "$user_dir/Config/Logger.ini"
if [ -f "$user_dir/Logs/dolphin.log" ]; then
  mv -f "$user_dir/Logs/dolphin.log" "$user_dir/Logs/dolphin.previous.log"
fi
if [ ! -p "$user_dir/Pipes/multiplex1" ]; then
  if [ -e "$user_dir/Pipes/multiplex1" ]; then
    echo "$user_dir/Pipes/multiplex1 exists but is not a named pipe." >&2
    exit 1
  fi
  mkfifo "$user_dir/Pipes/multiplex1"
fi
echo "$$" >"$pid_file"

exec dolphin-emu --batch \
  --user="$user_dir" \
  --audio_emulation=HLE \
  --config=SYSCONF.IPL.PGS=True \
  --config=GFX.Hacks.SafeTextureCacheColorSamples=0 \
  --config=GFX.Hacks.EFBToTextureEnable=False \
  --config=GFX.Hacks.XFBToTextureEnable=False \
  --config=GFX.Hacks.BBoxEnable=True \
  --exec="$dol"
