#!/bin/sh
set -eu

pasta_bin=${GAMECUBE_PASTA_BIN:-pasta}
if ! command -v "$pasta_bin" >/dev/null 2>&1 && [ ! -x "$pasta_bin" ]; then
  echo "pasta is required for the rootless Dolphin TAP network." >&2
  exit 1
fi
for command in ip tc; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required for the rootless Dolphin TAP network." >&2
    exit 1
  fi
done

dolphin_emu=${DOLPHIN_EMU_REAL:-dolphin-emu}

proxy_mac=02:00:00:00:00:01
pasta_logging=--quiet
if [ "${GAMECUBE_PASTA_DEBUG:-0}" -eq 1 ]; then
  pasta_logging="--trace --log-file /tmp/multiplex-pasta.log --pcap /tmp/multiplex-pasta.pcap"
fi

# pasta_logging is an intentional list of fixed command-line arguments.
# shellcheck disable=SC2086
exec "$pasta_bin" $pasta_logging --config-net --ipv4-only --mtu 1500 \
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
      while [ "$attempt" -lt 300 ]; do
        for tap in Dolphin0 Dolphin1 Dolphin2 Dolphin3; do
          if ip link show "$tap" >/dev/null 2>&1; then
            ip link set "$tap" master "$bridge"
            ip link set "$tap" up
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
  ' sh "$dolphin_emu" "$@"
