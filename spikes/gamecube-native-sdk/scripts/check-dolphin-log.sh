#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
log="$spike_dir/.dolphin-user/Logs/dolphin.log"

if [ ! -s "$log" ]; then
  echo "Missing Dolphin log at $log; launch the reference DOL first." >&2
  exit 1
fi

failures=$(
  rg -n -i \
    'invalid (read|write)|buffer guard overwritten|reference render failed|texture allocation failed|decoder failure|decoder initialization failed|MPEG-2 decode failed|MPEG-2 decoder made no input progress|MPEG-2 decoder exceeded progress limit|unexpected MPEG-2 frame|YUV texture allocation failed' \
    "$log" || true
)
if [ -n "$failures" ]; then
  echo "$failures" >&2
  echo "Dolphin memory/render log check failed." >&2
  exit 1
fi

if ! rg -q 'REFERENCE GX: commands=' "$log"; then
  echo "Dolphin has not completed a reference frame yet." >&2
  exit 1
fi

echo "Dolphin reference log is clean (no invalid accesses, guard failures, render failures, or decoder failures)."
