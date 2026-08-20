#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: run-pcsx2-headless.sh ELF LOG" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
elf=$1
log=$2

if [ ! -s "$elf" ]; then
  echo "PS2 ELF is missing: $elf" >&2
  exit 1
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "xvfb-run is required for isolated PCSX2 execution." >&2
  exit 1
fi

binary=$(sh "$script_dir/create-pcsx2-profile.sh")
timeout_seconds=${MULTIPLEX_PS2_EMULATOR_TIMEOUT:-30}

if env -u WAYLAND_DISPLAY QT_QPA_PLATFORM=xcb \
  timeout "$timeout_seconds" xvfb-run -a "$binary" \
    -portable -nogui -fastboot -elf "$elf" -logfile "$log" -earlyconsolelog; then
  status=0
else
  status=$?
fi
if [ "$status" -ne 0 ] && [ "$status" -ne 124 ]; then
  echo "PCSX2 exited with status $status. See $log." >&2
  exit "$status"
fi
