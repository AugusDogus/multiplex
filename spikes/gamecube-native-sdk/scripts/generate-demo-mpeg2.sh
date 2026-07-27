#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
spike_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
video_output=${1:-"$spike_dir/assets/multiplex-dvd-demo.m2v"}
audio_output=${2:-"$spike_dir/assets/multiplex-dvd-demo.mp2"}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to regenerate the DVD-resolution demo asset." >&2
  exit 1
fi

mkdir -p "$(dirname -- "$video_output")" "$(dirname -- "$audio_output")"
video_temporary="$video_output.tmp"
audio_temporary="$audio_output.tmp"
trap 'rm -f "$video_temporary" "$audio_temporary"' EXIT INT TERM

# A one-second NTSC DVD-resolution elementary stream is small enough to embed in
# the DOL while still exercising the same MPEG-2/YUV420P path as DVD video.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=720x480:rate=30000/1001:duration=1" \
  -frames:v 30 -an -c:v mpeg2video -pix_fmt yuv420p \
  -g 15 -bf 2 -b:v 2500k -maxrate 6000k -bufsize 1835k \
  -f mpeg2video -y "$video_temporary"

# Keep the tones quiet and different in each channel so stereo output is
# obvious without being abrasive when the one-second sample loops.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=1" \
  -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=1" \
  -filter_complex \
  "[0:a]volume=0.035[left];[1:a]volume=0.025[right];[left][right]join=inputs=2:channel_layout=stereo[audio]" \
  -map "[audio]" -c:a mp2 -b:a 192k -ar 48000 -ac 2 \
  -f mp2 -y "$audio_temporary"

dimensions=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt \
  -of default=noprint_wrappers=1:nokey=1 "$video_temporary" | tr '\n' ' ')
case "$dimensions" in
  "mpeg2video 720 480 yuv420p "*) ;;
  *)
    echo "Unexpected generated stream metadata: $dimensions" >&2
    exit 1
    ;;
esac

audio_metadata=$(ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_name,sample_rate,channels,sample_fmt \
  -of default=noprint_wrappers=1:nokey=1 "$audio_temporary" | tr '\n' ' ')
case "$audio_metadata" in
  "mp2 fltp 48000 2 " | "mp2 s16p 48000 2 " | "mp2 s16 48000 2 "*) ;;
  *)
    echo "Unexpected generated audio metadata: $audio_metadata" >&2
    exit 1
    ;;
esac

mv "$video_temporary" "$video_output"
mv "$audio_temporary" "$audio_output"
trap - EXIT INT TERM

echo "Generated $video_output: MPEG-2, 720x480 YUV420P, 30000/1001 fps, 30 frames."
echo "Generated $audio_output: MP2, 48 kHz stereo, 192 kbps, one second."
