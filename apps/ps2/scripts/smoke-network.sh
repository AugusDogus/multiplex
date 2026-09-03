#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
run_dir="$app_dir/build-network-probe/smoke"
server_log="$run_dir/server.log"
emulator_log="$run_dir/pcsx2.log"
screenshot="$run_dir/network-probe.png"
port=${MULTIPLEX_PS2_PROBE_PORT:-18194}
host=${MULTIPLEX_PS2_PROBE_HOST:-}

if [ -z "$host" ]; then
  host=$(ip route get 1.1.1.1 | awk '{for (field = 1; field <= NF; field++) if ($field == "src") {print $(field + 1); exit}}')
fi
if [ -z "$host" ]; then
  echo "Could not determine the host IPv4 address for the PCSX2 probe." >&2
  exit 1
fi

nonce=$(printf '%s:%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$$" | sha256sum | cut -c1-24)
mkdir -p "$run_dir"
: >"$server_log"

MULTIPLEX_PS2_PROBE_HOST=$host \
MULTIPLEX_PS2_PROBE_PORT=$port \
MULTIPLEX_PS2_PROBE_NONCE=$nonce \
  sh "$script_dir/build-network-probe-elf.sh"

python3 "$script_dir/network-probe-server.py" \
  --bind "$host" --port "$port" --nonce "$nonce" --log "$server_log" &
server_pid=$!
emulator_pid=
xvfb_pid=
cleanup() {
  if [ -n "$emulator_pid" ]; then kill "$emulator_pid" 2>/dev/null || true; fi
  if [ -n "$xvfb_pid" ]; then kill "$xvfb_pid" 2>/dev/null || true; fi
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

attempt=0
while ! curl -fsS "http://$host:$port/ready" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "The PS2 probe server did not become ready." >&2
    exit 1
  fi
  sleep 0.1
done

binary=$(sh "$script_dir/create-pcsx2-profile.sh")
display_number=$((120 + ($$ % 80)))
display=:$display_number
Xvfb "$display" -screen 0 1280x720x24 -nolisten tcp >"$run_dir/xvfb.log" 2>&1 &
xvfb_pid=$!
sleep 1
env -u WAYLAND_DISPLAY QT_QPA_PLATFORM=xcb DISPLAY="$display" \
  "$binary" -portable -nogui -fastboot \
    -elf "$app_dir/multiplex-ps2-network-probe.elf" \
    -logfile "$emulator_log" >"$run_dir/pcsx2.stdout" 2>&1 &
emulator_pid=$!

attempt=0
while ! rg -q "verified nonce=$nonce .*user_agent=Multiplex-PS2-Network-Probe/1" "$server_log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    echo "The emulated PS2 did not complete the HTTP probe within 30 seconds." >&2
    exit 1
  fi
  sleep 0.1
done

sleep 1
ffmpeg -hide_banner -loglevel error -y -f x11grab \
  -video_size 1280x720 -i "$display" -frames:v 1 "$screenshot"

rg -q 'ELF .*multiplex-ps2-network-probe.elf .* is executing' "$emulator_log"
rg -q "verified nonce=$nonce .*user_agent=Multiplex-PS2-Network-Probe/1" "$server_log"
test -s "$screenshot"

echo "MPS2-NET-VERIFIED nonce=$nonce host=$host:$port"
echo "Server proof: $server_log"
echo "Guest screen: $screenshot"
