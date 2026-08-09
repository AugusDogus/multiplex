#ifndef MULTIPLEX_PLAYBACK_VIDEO_H
#define MULTIPLEX_PLAYBACK_VIDEO_H

#include "video_decoder.h"
#include "video_surface.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct PlaybackVideo PlaybackVideo;

typedef struct {
  VideoCodec codec;
  void *reader_context;
  MediaRead read;
  unsigned width;
  unsigned height;
  uint32_t rate_millihertz;
  size_t stream_size;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
} PlaybackVideoOpenRequest;

typedef struct {
  bool active;
  bool playing;
  uint64_t audio_samples;
} PlaybackVideoStepInput;

typedef struct {
  const MultiplexPlaybackVideoSurface *surface;
  bool frame_ready;
  bool failed;
  unsigned content_width;
  unsigned content_height;
  uint32_t decoder_fps_tenths;
  uint32_t codec_average_us;
  uint32_t codec_max_us;
  uint32_t upload_average_us;
} PlaybackVideoStepResult;

PlaybackVideo *playback_video_create(void);
void playback_video_destroy(PlaybackVideo **video);
bool playback_video_open(PlaybackVideo *video,
                         const PlaybackVideoOpenRequest *request,
                         int64_t *pts_offset_samples_out);
void playback_video_request_stop(PlaybackVideo *video);
void playback_video_stop(PlaybackVideo *video);
PlaybackVideoStepResult
playback_video_step(PlaybackVideo *video, const PlaybackVideoStepInput *input);
PlaybackVideoStepResult playback_video_snapshot(const PlaybackVideo *video);
bool playback_video_is_open(const PlaybackVideo *video);
bool playback_video_is_playing(const PlaybackVideo *video);

#endif
