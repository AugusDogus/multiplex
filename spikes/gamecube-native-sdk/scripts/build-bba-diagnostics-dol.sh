#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

# shellcheck disable=SC1091
. "$spike_dir/PINS.env"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required to run the pinned devkitPPC toolchain." >&2
  exit 1
fi

libogc2_stage_name=${LIBOGC2_STAGE_NAME:-.libogc2-stage}
case "$libogc2_stage_name" in
  .libogc2-stage | .libogc2-clean-stage) ;;
  *)
    echo "Unsupported libogc2 stage: $libogc2_stage_name" >&2
    exit 1
    ;;
esac

if [ ! -s "$spike_dir/$libogc2_stage_name/opt/devkitpro/libogc2/gamecube/lib/libogc.a" ]; then
  echo "Missing the pinned libogc2 runtime; run bun run spike:gamecube:bootstrap first." >&2
  exit 1
fi

podman run --rm \
  --volume "$spike_dir:/workspace:Z" \
  --workdir /workspace \
  --env LIBOGC2_STAGE_NAME="$libogc2_stage_name" \
  "$DEVKITPPC_IMAGE" \
  sh -c 'export DEVKITPRO="/workspace/$LIBOGC2_STAGE_NAME/opt/devkitpro"; export DEVKITPPC="/opt/devkitpro/devkitPPC"; export PATH="/opt/devkitpro/devkitPPC/bin:/opt/devkitpro/tools/bin:$PATH"; make -f Makefile.bba-diagnostics.gamecube clean; make -f Makefile.bba-diagnostics.gamecube'

test -s "$spike_dir/multiplex-gamecube-bba-diagnostics.dol"
dol_size=$(wc -c <"$spike_dir/multiplex-gamecube-bba-diagnostics.dol")
echo "BBA diagnostic DOL is ready at $spike_dir/multiplex-gamecube-bba-diagnostics.dol ($dol_size bytes)"
