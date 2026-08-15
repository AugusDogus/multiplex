#!/bin/sh
set -eu

output=$1
media_url=${GAMECUBE_MEDIA_URL:-}
gateway_url=${GAMECUBE_GATEWAY_URL:-}
multiplex_base_url=${MULTIPLEX_BASE_URL:-}
plex_base_url=${GAMECUBE_PLEX_BASE_URL:-}
plex_video_resolution=${GAMECUBE_PLEX_VIDEO_RESOLUTION:-320x180}
plex_max_video_bitrate=${GAMECUBE_PLEX_MAX_VIDEO_BITRATE:-700}
playback_start_offset_ms=${GAMECUBE_PLEX_START_OFFSET_MS:-0}
video_bytes=${GAMECUBE_MEDIA_VIDEO_BYTES:-0}
audio_bytes=${GAMECUBE_MEDIA_AUDIO_BYTES:-0}
video_packets=${GAMECUBE_MEDIA_VIDEO_PACKETS:-0}
audio_packets=${GAMECUBE_MEDIA_AUDIO_PACKETS:-0}
video_pts=${GAMECUBE_MEDIA_VIDEO_PTS90K:--1}
audio_pts=${GAMECUBE_MEDIA_AUDIO_PTS90K:--1}
emulator_host_ip=${MULTIPLEX_EMULATOR_HOST_IP:-}

if [ -n "$media_url" ] &&
  printf '%s' "$media_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "GAMECUBE_MEDIA_URL contains unsupported characters." >&2
  exit 1
fi
if [ -n "$gateway_url" ] &&
  printf '%s' "$gateway_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "GAMECUBE_GATEWAY_URL contains unsupported characters." >&2
  exit 1
fi
if [ -n "$multiplex_base_url" ] &&
  printf '%s' "$multiplex_base_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "MULTIPLEX_BASE_URL contains unsupported characters." >&2
  exit 1
fi
if [ -n "$plex_base_url" ] &&
  printf '%s' "$plex_base_url" | LC_ALL=C grep -q '[^A-Za-z0-9:/?&=._%+~-]'; then
  echo "GAMECUBE_PLEX_BASE_URL contains unsupported characters." >&2
  exit 1
fi
if [ -n "$emulator_host_ip" ] &&
  ! printf '%s' "$emulator_host_ip" | LC_ALL=C grep -Eq \
    '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  echo "MULTIPLEX_EMULATOR_HOST_IP must be an IPv4 address." >&2
  exit 1
fi
if ! printf '%s' "$plex_video_resolution" |
  LC_ALL=C grep -Eq '^[1-9][0-9]*x[1-9][0-9]*$'; then
  echo "GAMECUBE_PLEX_VIDEO_RESOLUTION must look like 640x360." >&2
  exit 1
fi
case "$plex_max_video_bitrate" in
  '' | *[!0-9]*)
    echo "GAMECUBE_PLEX_MAX_VIDEO_BITRATE must be an unsigned integer." >&2
    exit 1
    ;;
esac
case "$playback_start_offset_ms" in
  '' | *[!0-9]*)
    echo "GAMECUBE_PLEX_START_OFFSET_MS must be an unsigned integer." >&2
    exit 1
    ;;
esac

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
pairing_enabled=0
if [ -n "$multiplex_base_url" ]; then
  pairing_enabled=1
fi

temporary="$output.tmp"
trap 'rm -f "$temporary"' EXIT INT TERM
{
  printf '%s\n' '#ifndef MULTIPLEX_MEDIA_SOURCE_H'
  printf '%s\n' '#define MULTIPLEX_MEDIA_SOURCE_H'
  printf '#define MULTIPLEX_MEDIA_URL "%s"\n' "$media_url"
  printf '#define MULTIPLEX_GATEWAY_URL "%s"\n' "$gateway_url"
  printf '#define MULTIPLEX_BASE_URL "%s"\n' "$multiplex_base_url"
  printf '#define MULTIPLEX_PLEX_BASE_URL "%s"\n' "$plex_base_url"
  printf '#define MULTIPLEX_EMULATOR_HOST_IP "%s"\n' "$emulator_host_ip"
  printf '#define MULTIPLEX_PLEX_VIDEO_RESOLUTION "%s"\n' "$plex_video_resolution"
  printf '#define MULTIPLEX_PLEX_MAX_VIDEO_BITRATE "%s"\n' "$plex_max_video_bitrate"
  printf '#define MULTIPLEX_PLAYBACK_START_OFFSET_MS %su\n' "$playback_start_offset_ms"
  printf '#define MULTIPLEX_PAIRING_ENABLED %s\n' "$pairing_enabled"
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
