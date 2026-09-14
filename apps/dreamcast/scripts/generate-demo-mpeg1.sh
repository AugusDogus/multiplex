#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
output=${1:-"$app_dir/generated/dreamcast-demo.mpg"}

for command in ffmpeg ffprobe; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required to generate the Dreamcast playback fixture." >&2
    exit 1
  fi
done

mkdir -p "$(dirname -- "$output")"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'testsrc2=size=320x240:rate=30:duration=2' \
  -f lavfi -i 'sine=frequency=440:sample_rate=32000:duration=2' \
  -map 0:v:0 -map 1:a:0 -shortest \
  -c:v mpeg1video -pix_fmt yuv420p \
  -b:v 742k -minrate 742k -maxrate 742k -bufsize 742k -g 12 -bf 0 \
  -c:a mp2 -b:a 64k -ar 32000 -ac 1 \
  -muxpreload 0.5 -muxdelay 0.7 -f mpeg -y "$output"

video_codec=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name -of default=nw=1:nk=1 "$output")
audio_layout=$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_name,sample_rate,channels \
  -of csv=p=0 "$output")
test "$video_codec" = mpeg1video
test "$audio_layout" = 'mp2,32000,1'
echo "Dreamcast MPEG-1 fixture is ready at $output ($(wc -c <"$output") bytes)"
