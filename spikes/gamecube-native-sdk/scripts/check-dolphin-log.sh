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
    'invalid (read|write)|buffer guard overwritten|reference render failed|texture allocation failed|poster JPEG decoder .*failed|decoder failure|decoder initialization failed|decode failed|MPEG-PS demux scan failed|MPEG-PS demux extraction failed|MPEG-PS demux initialization failed|MPEG-TS rejected|HLS media producer failure|Plex HLS playlist retry limit reached|MPEG-2 decoder made no input progress|MPEG-2 decoder exceeded progress limit|unexpected MPEG-2 frame|YUV texture allocation failed|audio initialization failed|audio decoder failure|MP2 parser failed|MP2 parser reset failed|MP2 parser initialization failed|MP2 decoder consumed|MP2 decoder exceeded progress limit|unexpected MP2 frame|incorrect frame size|audio buffer allocation failed|audio decoder thread creation failed|timeline report allocation failed|HTTP network initialization failed|HTTP URL parse failed|HTTP connect failed|HTTP request write failed|HTTP response header failed|HTTP response body failed|HTTP media initialization failed|media startup recovery (exhausted|failed)|underruns=[1-9][0-9]*|Unknown ucode|forcing AX|incompatible with DSP HLE' \
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
