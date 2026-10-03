#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if [ "${MULTIPLEX_CXBX_HEADLESS:-0}" != "1" ]; then
  exec env MULTIPLEX_CXBX_HEADLESS=1 xvfb-run -a "$0" "$@"
fi

log_path="$app_dir/cxbx-smoke.log"
screenshot_path="$app_dir/cxbx-smoke.png"
rm -f "$log_path" "$screenshot_path"

"$script_dir/run-cxbx.sh" >"$log_path" 2>&1 &
emulator_pid=$!

cleanup() {
  kill "$emulator_pid" 2>/dev/null || true
  wait "$emulator_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

window_id=""
for _ in $(seq 1 300); do
  while read -r candidate_id; do
    [ -n "$candidate_id" ] || continue
    geometry=$(xdotool getwindowgeometry --shell "$candidate_id" 2>/dev/null || true)
    width=$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')
    height=$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')
    if [ -n "$width" ] && [ -n "$height" ] && [ "$width" -ge 600 ] && [ "$height" -ge 400 ]; then
      window_id=$candidate_id
      break
    fi
    xdotool windowactivate --sync "$candidate_id" key Return 2>/dev/null || true
  done < <(xdotool search --onlyvisible --name 'Cxbx|Multiplex' 2>/dev/null || true)
  [ -z "$window_id" ] || break
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "Cxbx-Reloaded exited before opening the Multiplex window. See $log_path." >&2
    exit 1
  fi
  sleep 0.1
done

if [ -z "$window_id" ]; then
  echo "Cxbx-Reloaded did not open a console-sized window within 30 seconds. See $log_path." >&2
  exit 1
fi

sleep 15
import -silent -window "$window_id" "$screenshot_path"
test -s "$screenshot_path"

read -r content_mean content_variation < <(
  magick "$screenshot_path" -gravity center -crop '80%x70%+0+20' \
    -format '%[fx:mean] %[fx:standard_deviation]\n' info:
)
if ! awk -v mean="$content_mean" -v variation="$content_variation" \
  'BEGIN { exit !(mean > 0.01 && variation > 0.01) }'; then
  echo "Cxbx-Reloaded produced a blank console viewport. See $screenshot_path and $log_path." >&2
  exit 1
fi

dimensions=$(identify -format '%wx%h' "$screenshot_path")
echo "Cxbx-Reloaded rendered a non-uniform $dimensions frame at $screenshot_path."
