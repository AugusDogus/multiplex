#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
user_dir="$app_dir/.dolphin-user"
pid_file="$user_dir/dolphin.pid"
dol="${1:-$app_dir/multiplex-gamecube-legacy.dol}"
case "$dol" in
  /*) ;;
  *) dol="$(CDPATH= cd -- "$(dirname -- "$dol")" && pwd)/$(basename -- "$dol")" ;;
esac
dolphin_emu="${DOLPHIN_EMU:-dolphin-emu}"
config_profile=${DOLPHIN_CONFIG_PROFILE:-"$app_dir/dolphin/Dolphin.ini"}
audio_emulation=${DOLPHIN_AUDIO_EMULATION:-LLE}
gdb_port=${DOLPHIN_GDB_PORT:--1}
gdb_socket=${DOLPHIN_GDB_SOCKET:-}
normal_scheduler_guard=${MULTIPLEX_DOLPHIN_NORMAL_SCHEDULER:-0}
capture_video=${GAMECUBE_DOLPHIN_CAPTURE_VIDEO:-0}
capture_path=${GAMECUBE_DOLPHIN_CAPTURE_PATH:-"$app_dir/.plex-cache/dolphin-capture.avi"}
qt_platform=${QT_QPA_PLATFORM:-xcb}

case "$capture_video" in
  0) capture_frames=False ;;
  1) capture_frames=True ;;
  *)
    echo "GAMECUBE_DOLPHIN_CAPTURE_VIDEO must be 0 or 1." >&2
    exit 1
    ;;
esac

dolphin_target_exists() {
  dolphin_existing_target=$1
  case "$dolphin_existing_target" in
    -*)
      dolphin_existing_group=${dolphin_existing_target#-}
      ps -eo pgid= | awk -v pgid="$dolphin_existing_group" '
        $1 == pgid { found = 1 }
        END { exit found ? 0 : 1 }
      '
      ;;
    *) ps -p "$dolphin_existing_target" -o pid= >/dev/null 2>&1 ;;
  esac
}

signal_dolphin_target() {
  dolphin_signal=$1
  dolphin_signal_target=$2
  if /bin/kill "$dolphin_signal" -- "$dolphin_signal_target" 2>/dev/null; then
    return 0
  fi
  if ! dolphin_target_exists "$dolphin_signal_target"; then
    return 0
  fi
  echo "Failed to send $dolphin_signal to previous Dolphin target $dolphin_signal_target." >&2
  return 1
}

# T3 Code intentionally runs agent commands with SCHED_IDLE. Dolphin inherits
# that policy and can take a minute of wall time to emulate two seconds even
# while its guest reports 60 fps. A transient user service is spawned by the
# normal-scheduled user manager, needs no privileges, and is stopped with this
# launcher. Ordinary terminal launches already use SCHED_OTHER and skip this.
current_scheduler=
if command -v chrt >/dev/null 2>&1; then
  current_scheduler=$(chrt -p 0 2>/dev/null | sed -n 's/.*policy: //p' | sed -n '1p')
fi
if [ "$normal_scheduler_guard" -ne 1 ] &&
  [ "$current_scheduler" = "SCHED_IDLE" ] &&
  command -v systemctl >/dev/null 2>&1 &&
  command -v systemd-run >/dev/null 2>&1; then
  unit=multiplex-gamecube-dolphin.service
  if systemctl --user --quiet is-active "$unit"; then
    systemctl --user stop "$unit"
  fi
  stop_service() {
    systemctl --user stop "$unit" >/dev/null 2>&1 || true
  }
  trap stop_service EXIT HUP INT TERM
  systemd-run --user --collect \
    --unit="$unit" \
    --property=CPUSchedulingPolicy=other \
    --setenv=MULTIPLEX_DOLPHIN_NORMAL_SCHEDULER=1 \
    --setenv="DOLPHIN_EMU=$dolphin_emu" \
    --setenv="DOLPHIN_CONFIG_PROFILE=$config_profile" \
    --setenv="DOLPHIN_AUDIO_EMULATION=$audio_emulation" \
    --setenv="DOLPHIN_GDB_PORT=$gdb_port" \
    --setenv="DOLPHIN_GDB_SOCKET=$gdb_socket" \
    --setenv="DOLPHIN_EMU_REAL=${DOLPHIN_EMU_REAL:-}" \
    --setenv="GAMECUBE_PASTA_BIN=${GAMECUBE_PASTA_BIN:-}" \
    --setenv="GAMECUBE_PASTA_OUTBOUND_INTERFACE=${GAMECUBE_PASTA_OUTBOUND_INTERFACE:-}" \
    --setenv="GAMECUBE_PASTA_DEBUG=${GAMECUBE_PASTA_DEBUG:-0}" \
    --setenv="GAMECUBE_PASTA_CAPTURE=${GAMECUBE_PASTA_CAPTURE:-0}" \
    --setenv="GAMECUBE_DOLPHIN_CAPTURE_VIDEO=$capture_video" \
    --setenv="GAMECUBE_DOLPHIN_CAPTURE_PATH=$capture_path" \
    --setenv="QT_QPA_PLATFORM=$qt_platform" \
    --setenv="DISPLAY=${DISPLAY:-}" \
    --setenv="XAUTHORITY=${XAUTHORITY:-}" \
    /bin/sh "$script_dir/run-dolphin.sh" "$dol"
  while :; do
    service_state=$(systemctl --user show "$unit" --property=ActiveState \
      --value 2>/dev/null || true)
    case "$service_state" in
      active | activating | reloading | deactivating) sleep 1 ;;
      *) break ;;
    esac
  done
  exit 0
fi

if [ ! -s "$dol" ]; then
  echo "Missing $dol; run bun run gamecube:legacy:dol first." >&2
  exit 1
fi
if [ ! -s "$config_profile" ]; then
  echo "Missing Dolphin config profile at $config_profile." >&2
  exit 1
fi

if [ -f "$pid_file" ]; then
  previous_pid=$(sed -n '1p' "$pid_file")
  case "$previous_pid" in
    *[!0-9]* | "") ;;
    *)
      previous_command=$(ps -p "$previous_pid" -o args= 2>/dev/null || true)
      case "$previous_command" in
        *"$user_dir"*) owned_pid=true ;;
        *) owned_pid=false ;;
      esac
      if [ "$owned_pid" = true ] &&
        kill -0 "$previous_pid" 2>/dev/null; then
        previous_pgid=$(ps -p "$previous_pid" -o pgid= 2>/dev/null | tr -d ' ' || true)
        if [ "$previous_pgid" = "$previous_pid" ]; then
          previous_target="-$previous_pgid"
        else
          previous_target=$previous_pid
        fi
        # dash's kill builtin rejects negative process-group targets even
        # after --, and under set -eu that aborts the takeover launch.
        signal_dolphin_target -TERM "$previous_target"
        attempt=0
        while /bin/kill -0 -- "$previous_target" 2>/dev/null &&
          [ "$attempt" -lt 30 ]; do
          sleep 0.1
          attempt=$((attempt + 1))
        done
        if /bin/kill -0 -- "$previous_target" 2>/dev/null; then
          signal_dolphin_target -KILL "$previous_target"
          attempt=0
          while /bin/kill -0 -- "$previous_target" 2>/dev/null &&
            [ "$attempt" -lt 30 ]; do
            sleep 0.1
            attempt=$((attempt + 1))
          done
        fi
      fi
      ;;
  esac
fi

mkdir -p "$user_dir/Config" "$user_dir/Pipes"
cp "$config_profile" "$user_dir/Config/Dolphin.ini"
cp "$app_dir/dolphin/GCPadNew.ini" "$user_dir/Config/GCPadNew.ini"
cp "$app_dir/dolphin/WiimoteNew.ini" "$user_dir/Config/WiimoteNew.ini"
cp "$app_dir/dolphin/GFX.ini" "$user_dir/Config/GFX.ini"
cp "$app_dir/dolphin/Logger.ini" "$user_dir/Config/Logger.ini"
cp "$app_dir/dolphin/Hotkeys.ini" "$user_dir/Config/Hotkeys.ini"
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
if [ ! -p "$user_dir/Pipes/multiplex-wii1" ]; then
  if [ -e "$user_dir/Pipes/multiplex-wii1" ]; then
    echo "$user_dir/Pipes/multiplex-wii1 exists but is not a named pipe." >&2
    exit 1
  fi
  mkfifo "$user_dir/Pipes/multiplex-wii1"
fi
if [ ! -p "$user_dir/Pipes/multiplex-hotkeys" ]; then
  if [ -e "$user_dir/Pipes/multiplex-hotkeys" ]; then
    echo "$user_dir/Pipes/multiplex-hotkeys exists but is not a named pipe." >&2
    exit 1
  fi
  mkfifo "$user_dir/Pipes/multiplex-hotkeys"
fi
echo "$$" >"$pid_file"
export QT_QPA_PLATFORM="$qt_platform"

exec "$dolphin_emu" --batch \
  --user="$user_dir" \
  --audio_emulation="$audio_emulation" \
  --config=Interface.ConfirmStop=False \
  --config=Dolphin.General.GDBPort="$gdb_port" \
  --config=Dolphin.General.GDBSocket="$gdb_socket" \
  --config=Dolphin.Core.MMU=True \
  --config=SYSCONF.IPL.PGS=True \
  --config=SYSCONF.IPL.AR=0 \
  --config=Graphics.Hacks.SafeTextureCacheColorSamples=0 \
  --config=Graphics.Hacks.EFBToTextureEnable=False \
  --config=Graphics.Hacks.XFBToTextureEnable=False \
  --config=Graphics.Hacks.BBoxEnable=True \
  --config=Dolphin.Movie.DumpFrames="$capture_frames" \
  --config=Dolphin.Movie.DumpFramesSilent=True \
  --config=Graphics.Settings.DumpFramesAsImages=False \
  --config=Graphics.Settings.DumpPath="$capture_path" \
  --config=Graphics.Settings.BitrateKbps=4000 \
  --exec="$dol"
