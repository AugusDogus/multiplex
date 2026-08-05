#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

pasta_bin=${GAMECUBE_PASTA_BIN:-pasta}
if ! command -v "$pasta_bin" >/dev/null 2>&1 && [ ! -x "$pasta_bin" ]; then
  echo "pasta is required for the rootless Dolphin TAP network." >&2
  exit 1
fi
for command in ip pgrep tc; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the rootless Dolphin TAP network." >&2
    exit 1
  fi
done

custom_dolphin="$app_dir/.dolphin-source-2606/build/Binaries/dolphin-emu"
dolphin_emu=${DOLPHIN_EMU_REAL:-}
if [ -z "$dolphin_emu" ] && [ -x "$custom_dolphin" ]; then
  dolphin_emu=$custom_dolphin
fi
dolphin_emu=${dolphin_emu:-dolphin-emu}

proxy_mac=02:00:00:00:00:01
pasta_logging=--quiet
if [ "${GAMECUBE_PASTA_DEBUG:-0}" -eq 1 ]; then
  pasta_logging="--trace --log-file /tmp/multiplex-pasta.log --pcap /tmp/multiplex-pasta.pcap"
elif [ "${GAMECUBE_PASTA_CAPTURE:-0}" -eq 1 ]; then
  # Packet capture alone has negligible overhead compared with --trace and is
  # suitable for measuring timing-sensitive BBA transfers.
  pasta_logging="--pcap /tmp/multiplex-pasta.pcap"
fi

pasta_pid=
stop_namespace() {
  if [ -z "$pasta_pid" ]; then
    return
  fi
  child_pids=$(pgrep -P "$pasta_pid" 2>/dev/null || true)
  for child_pid in $child_pids; do
    kill -TERM "$child_pid" 2>/dev/null || true
  done
  attempt=0
  while [ -n "$child_pids" ] && [ "$attempt" -lt 10 ]; do
    running_children=
    for child_pid in $child_pids; do
      if kill -0 "$child_pid" 2>/dev/null; then
        running_children="$running_children $child_pid"
      fi
    done
    child_pids=$running_children
    [ -z "$child_pids" ] || sleep 0.1
    attempt=$((attempt + 1))
  done
  for child_pid in $child_pids; do
    kill -KILL "$child_pid" 2>/dev/null || true
  done
  kill -TERM "$pasta_pid" 2>/dev/null || true
}
trap stop_namespace HUP INT TERM

# pasta_logging is an intentional list of fixed command-line arguments.
# shellcheck disable=SC2086
"$pasta_bin" $pasta_logging --foreground --config-net --ipv4-only --mtu 1500 \
  --ns-mac-addr "$proxy_mac" \
  --ns-ifname multiplex0 -- \
  sh -eu -c '
    bridge=multiplex-br0
    uplink=multiplex0
    bba_mac=00:09:bf:00:00:01
    proxy_mac=02:00:00:00:00:01

    # pasta configures this interface for an ordinary namespace process, but
    # here it is only an Ethernet uplink. Leaving the copied host address on it
    # makes the namespace kernel answer the BBA client’s duplicate-address
    # probe for the same lease that pasta just offered.
    ip -4 addr flush dev "$uplink"
    ip -4 route flush dev "$uplink"
    # pasta accepts traffic from the MAC assigned to its namespace interface,
    # while Dolphin must expose Nintendo’s BBA MAC to the guest. Translate only
    # the outer Ethernet header at the uplink boundary; ARP/IP payloads remain
    # exactly what the GameCube emitted.
    tc qdisc add dev "$uplink" clsact
    tc filter add dev "$uplink" egress protocol all flower \
      src_mac "$bba_mac" \
      action pedit ex munge eth src set "$proxy_mac"
    tc filter add dev "$uplink" ingress protocol all flower \
      dst_mac "$proxy_mac" \
      action pedit ex munge eth dst set "$bba_mac"
    ip link add "$bridge" type bridge
    ip link set "$bridge" up
    ip link set "$uplink" master "$bridge"
    ip link set "$uplink" up

    (
      attempt=0
      while [ "$attempt" -lt 3000 ]; do
        for tap in Dolphin0 Dolphin1 Dolphin2 Dolphin3; do
          if ip link show "$tap" >/dev/null 2>&1; then
            ip link set "$tap" master "$bridge"
            ip link set "$tap" up
            # Libogc advertises a two-frame TCP receive window and configures
            # the BBA to interrupt after two packets. Upstream pasta emits one
            # TCP frame per TAP flush in namespace mode, so no additional
            # host-side pacing is needed.
            exit 0
          fi
        done
        attempt=$((attempt + 1))
        sleep 0.01
      done
      echo "Timed out waiting for Dolphin to create its TAP interface." >&2
      exit 1
    ) &

    exec "$@"
  ' sh "$dolphin_emu" "$@" &
pasta_pid=$!

set +e
wait "$pasta_pid"
status=$?
set -e
trap - HUP INT TERM
exit "$status"
