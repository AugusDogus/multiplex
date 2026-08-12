#ifndef MULTIPLEX_PLAYBACK_FRAME_H
#define MULTIPLEX_PLAYBACK_FRAME_H

#include "video_surface.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  MULTIPLEX_PLAYBACK_STREAM_NONE = 0,
  MULTIPLEX_PLAYBACK_STREAM_PROGRAM = 1,
  MULTIPLEX_PLAYBACK_STREAM_HLS = 2,
} MultiplexPlaybackStream;

typedef struct {
  MultiplexPlaybackStream stream;
  uint32_t decoder_fps_tenths;
  uint32_t codec_average_us;
  uint32_t codec_max_us;
  uint32_t upload_average_us;
  uint32_t network_kib_per_second;
  uint32_t queued_video_bytes;
  uint32_t queued_audio_bytes;
  uint32_t audio_ready_buffers;
  uint32_t audio_underruns;
  uint32_t stream_video_bytes;
  uint32_t stream_audio_bytes;
  uint32_t producer_units;
} MultiplexPlaybackMetrics;

typedef struct {
  const MultiplexPlaybackVideoSurface *surface;
  bool frame_ready;
  bool playback_ready;
  bool playback_failed;
  bool playing;
  bool prefetch_active;
  uint32_t content_width;
  uint32_t content_height;
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  uint32_t segment_start_ms;
  uint32_t segment_duration_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
  MultiplexPlaybackMetrics metrics;
} MultiplexPlaybackSnapshot;

#endif
