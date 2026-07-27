#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
output=${1:-"$spike_dir/assets/multiplex-dvd-demo.m2v"}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to regenerate the DVD-resolution demo asset." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$output")"
temporary="$output.tmp"
trap 'rm -f "$temporary"' EXIT INT TERM

# A one-second NTSC DVD-resolution elementary stream is small enough to embed in
# the DOL while still exercising the same MPEG-2/YUV420P path as DVD video.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=720x480:rate=30000/1001:duration=1" \
  -frames:v 30 -an -c:v mpeg2video -pix_fmt yuv420p \
  -g 15 -bf 2 -b:v 2500k -maxrate 6000k -bufsize 1835k \
  -f mpeg2video -y "$temporary"

dimensions=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt \
  -of default=noprint_wrappers=1:nokey=1 "$temporary" | tr '\n' ' ')
case "$dimensions" in
  "mpeg2video 720 480 yuv420p "*) ;;
  *)
    echo "Unexpected generated stream metadata: $dimensions" >&2
    exit 1
    ;;
esac

mv "$temporary" "$output"
trap - EXIT INT TERM

echo "Generated $output: MPEG-2, 720x480 YUV420P, 30000/1001 fps, 30 frames."
