#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
run_dir="$app_dir/build-scene-client/plex-smoke"
scene_server_log="$run_dir/scene-server.log"
emulator_log="$run_dir/pcsx2.log"
gateway_log="$run_dir/plex-gateway.log"
screenshot="$run_dir/plex-catalog.png"
gateway_port=${MULTIPLEX_PS2_PLEX_GATEWAY_PORT:-18993}
scene_port=${MULTIPLEX_PS2_SCENE_PORT:-18195}
scene_host=${MULTIPLEX_PS2_SCENE_HOST:-}
plex_base_url=${PLEX_BASE_URL:-}

for command in curl ffmpeg ip python3 rg Xvfb xdotool; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the PS2 Plex smoke test." >&2
    exit 1
  fi
done
if [ -z "${PLEX_TOKEN:-}" ]; then
  echo "PLEX_TOKEN is required for the PS2 Plex smoke test." >&2
  exit 1
fi
if [ -z "$scene_host" ]; then
  scene_host=$(ip route get 1.1.1.1 | awk '{for (field = 1; field <= NF; field++) if ($field == "src") {print $(field + 1); exit}}')
fi
if [ -z "$scene_host" ]; then
  echo "Could not determine the host IPv4 address for PCSX2." >&2
  exit 1
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
  echo "No Plex server was discovered. Set PLEX_BASE_URL." >&2
  exit 1
fi

mkdir -p "$run_dir"
: >"$scene_server_log"
: >"$run_dir/gateway-placeholder.mpg"

gateway_pid=
scene_pid=
emulator_pid=
xvfb_pid=
cleanup() {
  if [ -n "$emulator_pid" ]; then kill "$emulator_pid" 2>/dev/null || true; fi
  if [ -n "$scene_pid" ]; then kill "$scene_pid" 2>/dev/null || true; fi
  if [ -n "$xvfb_pid" ]; then kill "$xvfb_pid" 2>/dev/null || true; fi
  if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT HUP INT TERM

press_cross() {
  window=
  largest_area=0
  : >"$run_dir/windows.log"
  for candidate in $(DISPLAY="$display" xdotool search --onlyvisible --name '.' 2>/dev/null); do
    geometry=$(DISPLAY="$display" xdotool getwindowgeometry --shell "$candidate")
    width=$(printf '%s\n' "$geometry" | sed -n 's/^WIDTH=//p')
    height=$(printf '%s\n' "$geometry" | sed -n 's/^HEIGHT=//p')
    name=$(DISPLAY="$display" xdotool getwindowname "$candidate" 2>/dev/null || true)
    printf '%s\t%sx%s\t%s\n' "$candidate" "$width" "$height" "$name" \
      >>"$run_dir/windows.log"
    area=$((width * height))
    if [ "$area" -gt "$largest_area" ]; then
      largest_area=$area
      window=$candidate
    fi
  done
  if [ -z "$window" ]; then
    echo "PCSX2 has no visible render window in the isolated display." >&2
    exit 1
  fi
  DISPLAY="$display" xdotool windowfocus --sync "$window"
  DISPLAY="$display" xdotool keydown k
  sleep 0.2
  DISPLAY="$display" xdotool keyup k
}

python3 "$repo_dir/apps/gamecube/scripts/plex-gateway.py" \
  "$gateway_port" "$run_dir/gateway-placeholder.mpg" \
  --plex-base-url "$plex_base_url" --segment-duration 12 \
  >"$gateway_log" 2>&1 &
gateway_pid=$!

attempt=0
until curl -fsS --noproxy '*' "http://127.0.0.1:$gateway_port/v1/health" \
  >"$run_dir/health.json" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 80 ]; then
    echo "The Plex gateway did not become ready." >&2
    tail -40 "$gateway_log" >&2
    exit 1
  fi
  sleep 0.25
done

MULTIPLEX_PS2_SCENE_HOST=$scene_host \
MULTIPLEX_PS2_SCENE_PORT=$scene_port \
  sh "$script_dir/build-scene-client-elf.sh" >"$run_dir/build.log"
sh "$repo_dir/packages/console-ui/scripts/export-scene.sh" \
  "$run_dir/default.scene" >>"$run_dir/build.log"

python3 "$script_dir/scene-server.py" \
  --bind "$scene_host" --port "$scene_port" \
  --scene "$run_dir/default.scene" \
  --exporter "$repo_dir/packages/console-ui/zig-out/export-scene" \
  --catalog-url "http://127.0.0.1:$gateway_port/v3/catalog.bin" \
  --details-url-template \
    "http://127.0.0.1:$gateway_port/v3/details.bin?ratingKey={rating_key}" \
  --playback-url-template \
    "http://127.0.0.1:$gateway_port/v4/playback.bin?ratingKey={rating_key}&offsetMs=0" \
  --gateway-base-url "http://127.0.0.1:$gateway_port" \
  --media-cache "$run_dir/media" \
  --log "$scene_server_log" >"$run_dir/scene-server.stdout" 2>&1 &
scene_pid=$!

attempt=0
until curl -fsS "http://$scene_host:$scene_port/ready" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "The PS2 scene server did not become ready." >&2
    exit 1
  fi
  sleep 0.1
done

binary=$(sh "$script_dir/create-pcsx2-profile.sh")
display_number=$((120 + ($$ % 80)))
display=:$display_number
Xvfb "$display" -screen 0 1280x720x24 -nolisten tcp \
  >"$run_dir/xvfb.log" 2>&1 &
xvfb_pid=$!
sleep 1
env -u WAYLAND_DISPLAY QT_QPA_PLATFORM=xcb DISPLAY="$display" \
  "$binary" -portable -nogui -fastboot \
    -elf "$app_dir/multiplex-ps2-scene-client.elf" \
    -logfile "$emulator_log" >"$run_dir/pcsx2.stdout" 2>&1 &
emulator_pid=$!

attempt=0
until rg -q 'verified source=.*user_agent=Multiplex-PS2-Scene-Client/1' \
  "$scene_server_log"; do
  if rg -q 'validation_failed reason=' "$scene_server_log"; then
    echo "The emulated PS2 rejected the real Plex scene." >&2
    tail -1 "$scene_server_log" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 350 ]; then
    echo "The emulated PS2 did not validate the real Plex scene." >&2
    tail -80 "$emulator_log" >&2
    exit 1
  fi
  sleep 0.1
done

sleep 2
ffmpeg -hide_banner -loglevel error -y -f x11grab \
  -video_size 1280x720 -i "$display" -frames:v 1 "$screenshot"
rg -q 'ELF .*multiplex-ps2-scene-client.elf .* is executing' "$emulator_log"
rg -q 'scene bytes=.*user_agent=Multiplex-PS2-Scene-Client/1' "$scene_server_log"
test -s "$screenshot"

attempt=0
until rg -q 'Pad: DS2 Config Finished' "$emulator_log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    echo "PCSX2 did not finish configuring the virtual DualShock 2." >&2
    exit 1
  fi
  sleep 0.1
done
press_cross
attempt=0
until rg -q 'action value=2 ' "$scene_server_log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then
    echo "The emulated PS2 did not open the selected Plex item." >&2
    exit 1
  fi
  sleep 0.1
done
sleep 1
press_cross
attempt=0
until rg -q 'video rating_key=.*source=' "$scene_server_log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 2400 ]; then
    echo "The emulated PS2 did not request prepared Plex video." >&2
    tail -40 "$scene_server_log" >&2
    exit 1
  fi
  sleep 0.1
done
sleep 3
ffmpeg -hide_banner -loglevel error -y -f x11grab \
  -video_size 1280x720 -i "$display" -frames:v 1 \
  "$run_dir/plex-playback.png"
attempt=0
until rg -q 'played rating_key=.*source=' "$scene_server_log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 600 ]; then
    echo "The emulated PS2 did not finish the prepared Plex media segment." >&2
    tail -40 "$scene_server_log" >&2
    exit 1
  fi
  sleep 0.1
done

python3 - "$run_dir/health.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    health = json.load(source)
print(
    "MPS2-PLEX-CATALOG-VERIFIED "
    f"server={health['server']!r} rows={health['rows']} "
    f"items={health['items']} libraries={health['libraries']}"
)
PY
echo "Guest screen: $screenshot"
echo "Playback screen: $run_dir/plex-playback.png"
echo "Network proof: $scene_server_log"
