#!/bin/sh
set -eu

output=$1
media_url=${GAMECUBE_MEDIA_URL:-}
video_bytes=${GAMECUBE_MEDIA_VIDEO_BYTES:-0}
audio_bytes=${GAMECUBE_MEDIA_AUDIO_BYTES:-0}
video_packets=${GAMECUBE_MEDIA_VIDEO_PACKETS:-0}
audio_packets=${GAMECUBE_MEDIA_AUDIO_PACKETS:-0}
video_pts=${GAMECUBE_MEDIA_VIDEO_PTS90K:--1}
audio_pts=${GAMECUBE_MEDIA_AUDIO_PTS90K:--1}

if [ -n "$media_url" ] &&
  printf '%s' "$media_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "GAMECUBE_MEDIA_URL contains unsupported characters." >&2
  exit 1
fi

for value in "$video_bytes" "$audio_bytes" "$video_packets" "$audio_packets"; do
  case "$value" in
    '' | *[!0-9]*)
      echo "GameCube media byte and packet metadata must be unsigned integers." >&2
      exit 1
      ;;
  esac
done
for value in "$video_pts" "$audio_pts"; do
  case "$value" in
    -[0-9]* | [0-9]*) ;;
    *)
      echo "GameCube media PTS metadata must be integers." >&2
      exit 1
      ;;
  esac
done

has_info=0
if [ "$video_bytes" -gt 0 ] && [ "$audio_bytes" -gt 0 ] &&
  [ "$video_pts" -ge 0 ] && [ "$audio_pts" -ge 0 ]; then
  has_info=1
fi

temporary="$output.tmp"
trap 'rm -f "$temporary"' EXIT INT TERM
{
  printf '%s\n' '#ifndef MULTIPLEX_MEDIA_SOURCE_H'
  printf '%s\n' '#define MULTIPLEX_MEDIA_SOURCE_H'
  printf '#define MULTIPLEX_MEDIA_URL "%s"\n' "$media_url"
  printf '#define MULTIPLEX_MEDIA_HAS_INFO %s\n' "$has_info"
  printf '#define MULTIPLEX_MEDIA_VIDEO_BYTES %su\n' "$video_bytes"
  printf '#define MULTIPLEX_MEDIA_AUDIO_BYTES %su\n' "$audio_bytes"
  printf '#define MULTIPLEX_MEDIA_VIDEO_PACKETS %su\n' "$video_packets"
  printf '#define MULTIPLEX_MEDIA_AUDIO_PACKETS %su\n' "$audio_packets"
  printf '#define MULTIPLEX_MEDIA_VIDEO_PTS90K %sll\n' "$video_pts"
  printf '#define MULTIPLEX_MEDIA_AUDIO_PTS90K %sll\n' "$audio_pts"
  printf '%s\n' '#endif'
} >"$temporary"

if [ -f "$output" ] && cmp -s "$temporary" "$output"; then
  rm "$temporary"
else
  mv "$temporary" "$output"
fi
trap - EXIT INT TERM
