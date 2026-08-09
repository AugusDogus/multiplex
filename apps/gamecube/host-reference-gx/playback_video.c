#include "playback_video.h"

#include <gccore.h>
#include <ogc/cond.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/mutex.h>
#include <stdlib.h>

#define PLAYBACK_DECODER_STACK_SIZE (256u * 1024u)
#define AUDIO_SAMPLE_RATE 48000u
#define MPEG_PTS_RATE 90000u
#define VIDEO_PROFILE_FRAMES 60u

struct PlaybackVideo {
  VideoDecoder *decoder;
  MultiplexPlaybackVideoSurface *surface;
  lwp_t thread;
  void *stack;
  mutex_t mutex;
  cond_t condition;
  bool mutex_ready;
  bool condition_ready;
  bool decode_requested;
  bool decode_running;
  bool decode_ready;
  bool decode_failed;
  bool stopping;
  uint32_t decode_ready_us;
  uint32_t codec_ready_us;
  uint32_t upload_ready_us;
  uint32_t request_count;
  uint32_t completion_count;
  bool texture_ready;
  bool playing;
  unsigned content_width;
  unsigned content_height;
  uint32_t rate_millihertz;
  uint32_t frame_count;
  uint32_t decode_total_us;
  uint32_t decode_max_us;
  uint32_t codec_total_us;
  uint32_t codec_max_us;
  uint32_t upload_total_us;
  uint32_t upload_max_us;
  uint32_t diagnostic_decoder_fps_tenths;
  uint32_t diagnostic_codec_average_us;
  uint32_t diagnostic_codec_max_us;
  uint32_t diagnostic_upload_average_us;
  uint32_t frame_started;
  uint64_t audio_start_samples;
  uint32_t audio_start_completions;
  bool audio_clock_started;
  int64_t pts_offset_samples;
};

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

static int64_t pts_offset_samples(const PlaybackVideoOpenRequest *request) {
  const int64_t delta =
      request->first_video_pts90k - request->first_audio_pts90k;
  if (delta >= 0) {
    return (delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE;
  }
  return -((-delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE);
}

static void reset_state(PlaybackVideo *video) {
  video->decode_requested = false;
  video->decode_running = false;
  video->decode_ready = false;
  video->decode_failed = false;
  video->stopping = false;
  video->decode_ready_us = 0;
  video->codec_ready_us = 0;
  video->upload_ready_us = 0;
  video->request_count = 0;
  video->completion_count = 0;
  video->texture_ready = false;
  video->playing = false;
  video->frame_count = 0;
  video->frame_started = 0;
  video->audio_start_samples = 0;
  video->audio_start_completions = 0;
  video->audio_clock_started = false;
  video->pts_offset_samples = 0;
  video->decode_total_us = 0;
  video->decode_max_us = 0;
  video->codec_total_us = 0;
  video->codec_max_us = 0;
  video->upload_total_us = 0;
  video->upload_max_us = 0;
}

static void reset_profile(PlaybackVideo *video) {
  video->frame_count = 0;
  video->decode_total_us = 0;
  video->decode_max_us = 0;
  video->codec_total_us = 0;
  video->codec_max_us = 0;
  video->upload_total_us = 0;
  video->upload_max_us = 0;
}

static void profile_frame(PlaybackVideo *video, uint32_t decode_us,
                          uint32_t codec_us, uint32_t upload_us) {
  video->decode_total_us += decode_us;
  if (decode_us > video->decode_max_us) {
    video->decode_max_us = decode_us;
  }
  video->codec_total_us += codec_us;
  if (codec_us > video->codec_max_us) {
    video->codec_max_us = codec_us;
  }
  video->upload_total_us += upload_us;
  if (upload_us > video->upload_max_us) {
    video->upload_max_us = upload_us;
  }
  if (video->frame_count == 0) {
    video->frame_started = gettick();
  }
  video->frame_count += 1;
  if (video->frame_count != VIDEO_PROFILE_FRAMES) {
    return;
  }

  const uint32_t measured_us = elapsed_us(video->frame_started);
  video->diagnostic_decoder_fps_tenths =
      measured_us == 0
          ? 0
          : (uint32_t)(((VIDEO_PROFILE_FRAMES - 1u) * 10000000ull) /
                       measured_us);
  video->diagnostic_codec_average_us =
      video->codec_total_us / VIDEO_PROFILE_FRAMES;
  video->diagnostic_codec_max_us = video->codec_max_us;
  video->diagnostic_upload_average_us =
      video->upload_total_us / VIDEO_PROFILE_FRAMES;
  SYS_Report("REFERENCE GX: decoder=%u frames/%uus (%u.%u fps) "
             "bytes=%llu work=%u avg/%u max us codec=%u/%u upload=%u/%u\n",
             VIDEO_PROFILE_FRAMES, measured_us,
             video->diagnostic_decoder_fps_tenths / 10u,
             video->diagnostic_decoder_fps_tenths % 10u,
             video_decoder_stream_offset(video->decoder),
             video->decode_total_us / VIDEO_PROFILE_FRAMES,
             video->decode_max_us, video->codec_total_us / VIDEO_PROFILE_FRAMES,
             video->codec_max_us, video->upload_total_us / VIDEO_PROFILE_FRAMES,
             video->upload_max_us);
  reset_profile(video);
}

static void *run_decoder(void *context) {
  PlaybackVideo *video = context;
  LWP_MutexLock(video->mutex);
  while (!video->stopping) {
    while (!video->decode_requested && !video->stopping) {
      LWP_CondWait(video->condition, video->mutex);
    }
    if (video->stopping) {
      break;
    }
    video->decode_requested = false;
    LWP_MutexUnlock(video->mutex);
    const uint32_t started = gettick();
    VideoFrame frame;
    const bool frame_decoded = video_decoder_next_frame(video->decoder, &frame);
    const uint32_t codec_us = elapsed_us(started);
    const uint32_t upload_started = gettick();
    const bool decoded =
        frame_decoded && multiplex_video_surface_upload(
                             video->surface, frame.planes, frame.strides,
                             frame.width, frame.height);
    const uint32_t upload_us = elapsed_us(upload_started);
    const uint32_t decode_us = elapsed_us(started);
    LWP_MutexLock(video->mutex);
    video->decode_running = false;
    if (video->stopping) {
      continue;
    }
    if (decoded) {
      video->decode_ready = true;
      video->decode_ready_us = decode_us;
      video->codec_ready_us = codec_us;
      video->upload_ready_us = upload_us;
      ++video->completion_count;
    } else {
      video->decode_failed = true;
    }
  }
  LWP_MutexUnlock(video->mutex);
  return NULL;
}

PlaybackVideo *playback_video_create(void) {
  PlaybackVideo *video = calloc(1, sizeof(*video));
  if (video == NULL) {
    return NULL;
  }
  video->thread = LWP_THREAD_NULL;
  video->surface = multiplex_video_surface_create();
  if (video->surface == NULL) {
    free(video);
    return NULL;
  }
  return video;
}

void playback_video_destroy(PlaybackVideo **video) {
  if (video == NULL || *video == NULL) {
    return;
  }
  playback_video_stop(*video);
  multiplex_video_surface_destroy(&(*video)->surface);
  free(*video);
  *video = NULL;
}

bool playback_video_open(PlaybackVideo *video,
                         const PlaybackVideoOpenRequest *request,
                         int64_t *pts_offset_samples_out) {
  if (video == NULL || request == NULL || request->read == NULL ||
      request->width == 0 || request->height == 0 || request->width > 1024 ||
      request->height > 1024 || request->rate_millihertz == 0) {
    return false;
  }
  playback_video_stop(video);
  reset_state(video);
  video->pts_offset_samples = pts_offset_samples(request);
  video->decoder = video_decoder_create(request->codec, request->reader_context,
                                        request->read);
  if (video->decoder == NULL) {
    SYS_Report("REFERENCE GX: decoder initialization failed\n");
    return false;
  }
  const unsigned texture_width = (request->width + 15u) & ~15u;
  const unsigned texture_height = (request->height + 7u) & ~7u;
  if (!multiplex_video_surface_configure(video->surface, texture_width,
                                         texture_height)) {
    SYS_Report("REFERENCE GX: YUV texture allocation failed\n");
    playback_video_stop(video);
    return false;
  }
  if (LWP_MutexInit(&video->mutex, false) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: mutex init\n");
    playback_video_stop(video);
    return false;
  }
  video->mutex_ready = true;
  if (LWP_CondInit(&video->condition) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: condition init\n");
    playback_video_stop(video);
    return false;
  }
  video->condition_ready = true;
  video->content_width = request->width;
  video->content_height = request->height;
  video->rate_millihertz = request->rate_millihertz;
  video->stack = malloc(PLAYBACK_DECODER_STACK_SIZE);
  if (video->stack == NULL) {
    SYS_Report("REFERENCE GX: decoder failure: stack allocation\n");
    playback_video_stop(video);
    return false;
  }
  if (LWP_CreateThread(&video->thread, run_decoder, video, video->stack,
                       PLAYBACK_DECODER_STACK_SIZE, LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: thread creation\n");
    playback_video_stop(video);
    return false;
  }
  if (pts_offset_samples_out != NULL) {
    *pts_offset_samples_out = video->pts_offset_samples;
  }
  SYS_Report(
      "REFERENCE GX: decoder=ffmpeg-mplayer-ce codec=%s input=%ux%u "
      "texture=%ux%u pixel-format=yuv420p rate=%u.%03u fps size=%u bytes\n",
      video_codec_name(request->codec), request->width, request->height,
      texture_width, texture_height, request->rate_millihertz / 1000u,
      request->rate_millihertz % 1000u, (unsigned)request->stream_size);
  return true;
}

void playback_video_request_stop(PlaybackVideo *video) {
  if (video == NULL || video->thread == LWP_THREAD_NULL ||
      !video->mutex_ready || !video->condition_ready) {
    return;
  }
  LWP_MutexLock(video->mutex);
  video->stopping = true;
  LWP_CondSignal(video->condition);
  LWP_MutexUnlock(video->mutex);
}

void playback_video_stop(PlaybackVideo *video) {
  if (video == NULL) {
    return;
  }
  if (video->thread != LWP_THREAD_NULL) {
    playback_video_request_stop(video);
    LWP_JoinThread(video->thread, NULL);
    video->thread = LWP_THREAD_NULL;
  }
  free(video->stack);
  video->stack = NULL;
  if (video->condition_ready) {
    LWP_CondDestroy(video->condition);
    video->condition_ready = false;
  }
  if (video->mutex_ready) {
    LWP_MutexDestroy(video->mutex);
    video->mutex_ready = false;
  }
  multiplex_video_surface_reset(video->surface);
  video_decoder_destroy(video->decoder);
  video->decoder = NULL;
  video->stopping = false;
  video->texture_ready = false;
  video->playing = false;
  video->content_width = 0;
  video->content_height = 0;
}

static PlaybackVideoStepResult step_result(const PlaybackVideo *video) {
  return (PlaybackVideoStepResult){
      .surface = video->surface,
      .frame_ready = video->texture_ready && !video->decode_failed,
      .failed = video->decode_failed,
      .content_width = video->content_width,
      .content_height = video->content_height,
      .decoder_fps_tenths = video->diagnostic_decoder_fps_tenths,
      .codec_average_us = video->diagnostic_codec_average_us,
      .codec_max_us = video->diagnostic_codec_max_us,
      .upload_average_us = video->diagnostic_upload_average_us,
  };
}

PlaybackVideoStepResult
playback_video_step(PlaybackVideo *video, const PlaybackVideoStepInput *input) {
  if (video == NULL || input == NULL) {
    return (PlaybackVideoStepResult){0};
  }
  if (!input->active) {
    video->audio_clock_started = false;
    video->playing = false;
    PlaybackVideoStepResult result = step_result(video);
    result.frame_ready = false;
    return result;
  }

  const bool playback_changed = input->playing != video->playing;
  if (playback_changed) {
    reset_profile(video);
    video->playing = input->playing;
  }

  bool texture_changed = false;
  uint32_t completed_decode_us = 0;
  uint32_t completed_codec_us = 0;
  uint32_t completed_upload_us = 0;
  LWP_MutexLock(video->mutex);
  if (video->decode_ready) {
    completed_decode_us = video->decode_ready_us;
    completed_codec_us = video->codec_ready_us;
    completed_upload_us = video->upload_ready_us;
    video->decode_ready = false;
    video->texture_ready = true;
    texture_changed = true;
  }
  LWP_MutexUnlock(video->mutex);

  if (texture_changed) {
    multiplex_video_surface_swap(video->surface);
    profile_frame(video, completed_decode_us, completed_codec_us,
                  completed_upload_us);
  }

  if (input->playing && !video->audio_clock_started) {
    video->audio_start_samples = input->audio_samples;
    video->audio_start_completions = video->completion_count;
    video->audio_clock_started = true;
  }

  LWP_MutexLock(video->mutex);
  uint32_t desired_completions = video->completion_count;
  int64_t media_elapsed_samples = -video->pts_offset_samples;
  if (video->audio_clock_started) {
    media_elapsed_samples +=
        (int64_t)(input->audio_samples - video->audio_start_samples);
  }
  if (input->playing && media_elapsed_samples >= 0) {
    desired_completions =
        video->audio_start_completions + 1u +
        (uint32_t)(((uint64_t)media_elapsed_samples * video->rate_millihertz) /
                   (AUDIO_SAMPLE_RATE * 1000u));
  }
  const bool cadence_due =
      (!video->texture_ready &&
       (!input->playing || media_elapsed_samples >= 0)) ||
      (input->playing && video->completion_count < desired_completions);
  if (cadence_due && !video->decode_running && !video->decode_ready &&
      !video->decode_failed) {
    video->decode_running = true;
    video->decode_requested = true;
    video->request_count += 1;
    LWP_CondSignal(video->condition);
  }
  if (playback_changed) {
    SYS_Report("REFERENCE GX: playback=%s clock=audio samples=%llu "
               "pts-offset-samples=%lld target=%u decoder requests=%u "
               "completed=%u running=%u ready=%u\n",
               input->playing ? "playing" : "paused", input->audio_samples,
               video->pts_offset_samples, desired_completions,
               video->request_count, video->completion_count,
               video->decode_running, video->decode_ready);
  }
  LWP_MutexUnlock(video->mutex);

  return step_result(video);
}

PlaybackVideoStepResult playback_video_snapshot(const PlaybackVideo *video) {
  if (video == NULL) {
    return (PlaybackVideoStepResult){0};
  }
  return step_result(video);
}

bool playback_video_is_open(const PlaybackVideo *video) {
  return video != NULL && video->decoder != NULL;
}

bool playback_video_is_playing(const PlaybackVideo *video) {
  return video != NULL && video->playing;
}
