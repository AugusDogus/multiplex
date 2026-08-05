#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
program_output=${1:-"$app_dir/assets/multiplex-dvd-demo.mpg"}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to regenerate the DVD-resolution demo asset." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$program_output")"
program_temporary="$program_output.tmp"
trap 'rm -f "$program_temporary"' EXIT INT TERM

# A one-second MPEG-2 Program Stream is small enough to embed in the DOL while
# exercising the same PES/PTS, MPEG-2/YUV420P, and MP2 path as DVD media.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=720x480:rate=30000/1001:duration=1" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=1" \
  -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=1" \
  -filter_complex \
  "[1:a]volume=0.035[left];[2:a]volume=0.025[right];[left][right]join=inputs=2:channel_layout=stereo[audio]" \
  -map 0:v:0 -map "[audio]" -frames:v 30 \
  -c:v mpeg2video -pix_fmt yuv420p \
  -g 15 -bf 2 -b:v 2500k -maxrate 6000k -bufsize 1835k \
  -c:a mp2 -b:a 192k -ar 48000 -ac 2 \
  -f vob -y "$program_temporary"

dimensions=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt \
  -of default=noprint_wrappers=1:nokey=1 "$program_temporary" | tr '\n' ' ')
case "$dimensions" in
  "mpeg2video 720 480 yuv420p "*) ;;
  *)
    echo "Unexpected generated stream metadata: $dimensions" >&2
    exit 1
    ;;
esac

audio_metadata=$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_name,sample_rate,channels,sample_fmt \
  -of default=noprint_wrappers=1:nokey=1 "$program_temporary" | tr '\n' ' ')
case "$audio_metadata" in
  "mp2 fltp 48000 2 " | "mp2 s16p 48000 2 " | "mp2 s16 48000 2 "*) ;;
  *)
    echo "Unexpected generated audio metadata: $audio_metadata" >&2
    exit 1
    ;;
esac

video_pts=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=start_pts \
  -of default=noprint_wrappers=1:nokey=1 "$program_temporary")
audio_pts=$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=start_pts \
  -of default=noprint_wrappers=1:nokey=1 "$program_temporary")
if [ "$video_pts" != "48003" ] || [ "$audio_pts" != "47101" ]; then
  echo "Unexpected generated PTS epoch: video=$video_pts audio=$audio_pts" >&2
  exit 1
fi

mv "$program_temporary" "$program_output"
trap - EXIT INT TERM

echo "Generated $program_output: MPEG-2 Program Stream, 720x480 YUV420P video, 48 kHz stereo MP2, 902-tick initial PTS delta."
