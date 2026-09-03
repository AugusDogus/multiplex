#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_dir=$(CDPATH= cd -- "$app_dir/../.." && pwd)
build_dir="$app_dir/build-network-probe"

# shellcheck disable=SC1091
. "$app_dir/PINS.env"

probe_host=${MULTIPLEX_PS2_PROBE_HOST:-}
probe_port=${MULTIPLEX_PS2_PROBE_PORT:-18194}
probe_nonce=${MULTIPLEX_PS2_PROBE_NONCE:-}

case "$probe_host" in
  *[!0-9.]* | "")
    echo "MULTIPLEX_PS2_PROBE_HOST must be an IPv4 address." >&2
    exit 1
    ;;
esac
case "$probe_port" in
  *[!0-9]* | "")
    echo "MULTIPLEX_PS2_PROBE_PORT must be a decimal port." >&2
    exit 1
    ;;
esac
case "$probe_nonce" in
  *[!a-zA-Z0-9_-]* | "")
    echo "MULTIPLEX_PS2_PROBE_NONCE must be a nonempty URL-safe token." >&2
    exit 1
    ;;
esac

mkdir -p "$build_dir"
cat >"$build_dir/network_probe_config.h" <<EOF
#ifndef MULTIPLEX_PS2_NETWORK_PROBE_CONFIG_H
#define MULTIPLEX_PS2_NETWORK_PROBE_CONFIG_H
#define MULTIPLEX_PROBE_HOST "$probe_host"
#define MULTIPLEX_PROBE_PORT $probe_port
#define MULTIPLEX_PROBE_NONCE "$probe_nonce"
#endif
EOF

podman run --rm \
  --volume "$repo_dir:/workspace:Z" \
  --workdir /workspace/apps/ps2 \
  "$PS2DEV_IMAGE" \
  sh scripts/build-network-probe-in-container.sh

output="$app_dir/multiplex-ps2-network-probe.elf"
test -s "$output"
file "$output"
echo "PlayStation 2 network probe is ready at $output."
