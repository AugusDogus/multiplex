#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
user_dir="$app_dir/.flycast-user"
pid_file="$user_dir/flycast.pid"
log_file="$user_dir/flycast.log"
elf=${1:-"$app_dir/multiplex-dreamcast.elf"}
flycast="$app_dir/.flycast/squashfs-root/AppRun"

if [ ! -s "$elf" ]; then
  echo "Missing $elf; run bun run dreamcast:build first." >&2
  exit 1
fi
if [ ! -x "$flycast" ]; then
  echo "Missing the pinned Flycast emulator; run bun run dreamcast:flycast:bootstrap first." >&2
  exit 1
fi

if [ -f "$pid_file" ]; then
  previous_pid=$(sed -n '1p' "$pid_file")
  case "$previous_pid" in
    *[!0-9]* | "") ;;
    *)
      previous_command=$(ps -p "$previous_pid" -o args= 2>/dev/null || true)
      case "$previous_command" in
        *"$app_dir/.flycast/squashfs-root/usr/bin/flycast"*) owned_pid=true ;;
        *) owned_pid=false ;;
      esac
      if [ "$owned_pid" = true ] && kill -0 "$previous_pid" 2>/dev/null; then
        kill -TERM "$previous_pid"
        attempt=0
        while kill -0 "$previous_pid" 2>/dev/null && [ "$attempt" -lt 30 ]; do
          sleep 0.1
          attempt=$((attempt + 1))
        done
        if kill -0 "$previous_pid" 2>/dev/null; then
          kill -KILL "$previous_pid"
        fi
      fi
      ;;
  esac
fi

mkdir -p "$user_dir/config" "$user_dir/data"
: >"$log_file"
echo "$$" >"$pid_file"

export XDG_CONFIG_HOME="$user_dir/config"
export XDG_DATA_HOME="$user_dir/data"
exec "$flycast" \
  -config config:aica.Volume=0,config:Debug.SerialConsoleEnabled=yes,config:Dreamcast.Cable=0,network:Enable=yes,network:EmulateBBA=yes,config:rend.LinearInterpolation=no,config:rend.ShowFPS=yes \
  "$elf" >>"$log_file" 2>&1
