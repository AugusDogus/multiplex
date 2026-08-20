#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

XEMU_MCPX_PATH=${XEMU_MCPX_PATH:-$app_dir/.xemu/firmware/mcpx_1.0.bin}
XEMU_BIOS_PATH=${XEMU_BIOS_PATH:-$app_dir/.xemu/firmware/Complex_4627.bin}
export XEMU_MCPX_PATH XEMU_BIOS_PATH

: "${XEMU_MCPX_PATH:?Set XEMU_MCPX_PATH to a legal MCPX dump from your Xbox.}"
: "${XEMU_BIOS_PATH:?Set XEMU_BIOS_PATH to a legal debug or modded BIOS dump from your Xbox.}"

if [ "${MULTIPLEX_XEMU_HEADLESS:-0}" != "1" ]; then
  status_path="$app_dir/.xemu/headless-smoke.status"
  rm -f "$status_path"
  gamescope --backend headless \
    --output-width 640 --output-height 480 \
    --nested-width 640 --nested-height 480 \
    -- env MULTIPLEX_XEMU_HEADLESS=1 \
    bash -c '"$1"; status=$?; printf "%s\n" "$status" >"$2"; exit "$status"' \
    _ "$0" "$status_path" "$@"
  if [ ! -s "$status_path" ]; then
    echo "Headless gamescope exited without an xemu smoke result." >&2
    exit 1
  fi
  read -r smoke_status <"$status_path"
  exit "$smoke_status"
fi

log_path="$app_dir/xemu-smoke.log"
screenshot_path="$app_dir/xemu-smoke.png"
rm -f "$log_path" "$screenshot_path"

xemu_args=()
if [ -n "${XEMU_MONITOR_PATH:-}" ]; then
  rm -f "$XEMU_MONITOR_PATH"
  xemu_args=(-monitor "unix:$XEMU_MONITOR_PATH,server=on,wait=off")
fi

setsid env -u WAYLAND_DISPLAY \
  APPIMAGE_EXTRACT_AND_RUN=1 \
  SDL_VIDEODRIVER=x11 \
  "$script_dir/run-xemu.sh" "${xemu_args[@]}" >"$log_path" 2>&1 &
emulator_pid=$!

cleanup() {
  kill -TERM -- "-$emulator_pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$emulator_pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL -- "-$emulator_pid" 2>/dev/null || true
  wait "$emulator_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

window_id=""
for _ in $(seq 1 600); do
  window_id=$(xdotool search --onlyvisible --name 'xemu' 2>/dev/null | tail -n 1 || true)
  [ -z "$window_id" ] || break
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "xemu exited before opening its display. See $log_path." >&2
    exit 1
  fi
  sleep 0.1
done

if [ -z "$window_id" ]; then
  echo "xemu did not open a window within 60 seconds. See $log_path." >&2
  exit 1
fi

frame_ready=0
app_ready=0
catalog_ready=0
catalog_seen_attempt=0
for attempt in $(seq 1 120); do
  window_id=$(xdotool search --onlyvisible --name 'xemu' 2>/dev/null | tail -n 1 || true)
  if [ -n "$window_id" ] && \
    timeout 2s import -silent -window "$window_id" "$screenshot_path" \
      2>/dev/null; then
    read -r content_mean content_variation < <(
      magick "$screenshot_path" -gravity center -crop '80%x70%+0+20' \
        -format '%[fx:mean] %[fx:standard_deviation]\n' info:
    )
    if awk -v mean="$content_mean" -v variation="$content_variation" \
      'BEGIN { exit !(mean > 0.01 && variation > 0.01) }'; then
      frame_ready=1
    fi
    read -r header_mean header_variation < <(
      magick "$screenshot_path" -crop '300x45+12+25' \
        -format '%[fx:mean] %[fx:standard_deviation]\n' info:
    )
    read -r rule_mean rule_variation < <(
      magick "$screenshot_path" -crop '350x2+20+60' \
        -format '%[fx:mean] %[fx:standard_deviation]\n' info:
    )
    if [ "$attempt" -ge 15 ] && \
      awk -v header_mean="$header_mean" \
        -v header_variation="$header_variation" -v rule_mean="$rule_mean" \
        -v rule_variation="$rule_variation" \
        'BEGIN { exit !(header_mean > 0.03 && header_variation > 0.05 && rule_mean > 0.03 && rule_mean < 0.06 && rule_variation < 0.005) }'; then
      app_ready=1
      if [ "${MULTIPLEX_XBOX_EXPECT_CATALOG:-0}" = "1" ]; then
        if [ -n "${MULTIPLEX_XBOX_CATALOG_FIXTURE_LOG:-}" ] && \
          grep -q '^catalog served$' "$MULTIPLEX_XBOX_CATALOG_FIXTURE_LOG"; then
          if [ "$catalog_seen_attempt" -eq 0 ]; then
            catalog_seen_attempt=$attempt
          elif [ "$attempt" -ge $((catalog_seen_attempt + 2)) ]; then
            catalog_ready=1
          fi
        fi
      else
        catalog_ready=1
      fi
      if [ "$frame_ready" = "1" ] && [ "$catalog_ready" = "1" ]; then
        break
      fi
    fi
  fi
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "xemu exited before rendering Multiplex. See $log_path." >&2
    exit 1
  fi
  sleep 1
done

if [ "$frame_ready" != "1" ]; then
  echo "xemu produced a blank console viewport. See $screenshot_path and $log_path." >&2
  exit 1
fi

if [ "$app_ready" != "1" ]; then
  echo "xemu did not render the Multiplex launch screen. See $screenshot_path and $log_path." >&2
  exit 1
fi

if [ "$catalog_ready" != "1" ]; then
  echo "xemu did not load the catalog fixture. See $screenshot_path, $log_path, and $MULTIPLEX_XBOX_CATALOG_FIXTURE_LOG." >&2
  exit 1
fi

dimensions=$(identify -format '%wx%h' "$screenshot_path")
echo "xemu rendered Multiplex headlessly at $dimensions. Screenshot: $screenshot_path"
