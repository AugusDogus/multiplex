#include "playback_session.h"

#include "audio_dma.h"
#include "http_client.h"
#include "mpeg_ps_demux.h"
#include "native_ui.h"
#include "playback_prefetch.h"
#include "playback_program_policy.h"
#include "playback_timeline.h"
#include "playback_video.h"
#include "plex_hls.h"
#include "plex_hls_demux.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define AUDIO_SAMPLE_RATE 48000u
#define VIDEO_PREBUFFER_BYTES (64u * 1024u)
#define AUDIO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_VIDEO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_AUDIO_PREBUFFER_BYTES (16u * 1024u)
#define HLS_READINESS_TIMEOUT_MS 60000u
#define VIDEO_WIDTH 720u
#define VIDEO_HEIGHT 480u
#define VIDEO_RATE_NUMERATOR 30000u
#define VIDEO_RATE_DENOMINATOR 1001u
#define MEDIA_STARTUP_STALL_TIMEOUT_US 5000000u
#define MEDIA_STARTUP_RESTART_LIMIT 2u
#define SEGMENT_PREFETCH_MARGIN_MS 8000u
#define SEGMENT_HANDOFF_MARGIN_MS 64u
#define DIRECT_PLAYBACK_END_MARGIN_MS 64u

typedef struct {
  HttpClient *client;
  MpegPsDemux *demux;
} PlaybackProgramSource;

typedef struct {
  PlexHlsDemux *demux;
} PlaybackHlsSource;

typedef enum {
  PLAYBACK_SOURCE_NONE = 0,
  PLAYBACK_SOURCE_PROGRAM = 1,
  PLAYBACK_SOURCE_HLS = 2,
} PlaybackSourceKind;

typedef struct {
  PlaybackSourceKind kind;
  union {
    PlaybackProgramSource program;
    PlaybackHlsSource hls;
  } value;
} PlaybackSource;

typedef struct {
  uint32_t rating_key;
  uint32_t segment_start_ms;
  uint32_t started_tick;
  uint32_t last_video_bytes;
  uint32_t last_audio_bytes;
  unsigned restart_count;
  bool timing;
  bool playback_started;
} PlaybackStartupWatchdog;

struct MultiplexPlaybackSession {
  PlaybackSource source;
  PlaybackTimelineRoute timeline_route;
  PlaybackVideo *video;
  AudioDma *audio;
  uint32_t diagnostic_network_kib_per_second;
  uint32_t diagnostic_network_last_bytes;
  uint32_t diagnostic_network_started;
  PlaybackPrefetch *prefetch;
  PlaybackTimeline *timeline;
  PlaybackStartupWatchdog startup_watchdog;
  MultiplexGatewayPlaybackManifest manifest;
  MultiplexPlaybackSnapshot snapshot;
  MultiplexPlaybackEvent pending_event;
  uint32_t frozen_position_ms;
  bool position_frozen;
};

_Static_assert(sizeof(MultiplexPlaybackSession) <= 64u * 1024u,
               "playback session exceeds its heap budget");
_Static_assert(AUDIO_PREBUFFER_BYTES < MPEG_PS_DEMUX_AUDIO_QUEUE_CAPACITY / 2u,
               "audio prebuffer must stay below half the MPEG-PS queue");

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

static uint32_t playback_position_ms(const MultiplexPlaybackSession *session) {
  if (session->manifest.rating_key == 0) {
    return 0;
  }
  if (session->audio == NULL) {
    if (session->position_frozen) {
      return session->frozen_position_ms;
    }
    return session->manifest.segment_start_ms;
  }
  uint64_t position =
      (uint64_t)session->manifest.segment_start_ms +
      (audio_dma_samples_played(session->audio) * 1000u) / AUDIO_SAMPLE_RATE;
  if (position > session->manifest.media_duration_ms) {
    position = session->manifest.media_duration_ms;
  }
  return (uint32_t)position;
}

static void freeze_playback_position(MultiplexPlaybackSession *session) {
  session->frozen_position_ms = playback_position_ms(session);
  session->position_frozen = true;
}

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size) {
  return http_client_read_at(context, offset, destination, size);
}

static void maintain_playback(MultiplexPlaybackSession *session, bool visible);

static bool start_program_pipeline(MultiplexPlaybackSession *session,
                                   MpegPsDemux *demux, uint32_t rating_key,
                                   bool start_demux) {
  const PlaybackVideoOpenRequest request = {
      .codec = VIDEO_CODEC_MPEG2,
      .reader_context = demux,
      .read = mpeg_ps_demux_read_video,
      .width = VIDEO_WIDTH,
      .height = VIDEO_HEIGHT,
      .rate_millihertz =
          (VIDEO_RATE_NUMERATOR * 1000u) / VIDEO_RATE_DENOMINATOR,
      .stream_size = mpeg_ps_demux_video_size(demux),
      .first_video_pts90k = mpeg_ps_demux_first_video_pts90k(demux),
      .first_audio_pts90k = mpeg_ps_demux_first_audio_pts90k(demux),
  };
  if (!playback_video_open(session->video, &request, NULL)) {
    return false;
  }
  session->audio =
      audio_dma_create(AUDIO_CODEC_MP2, demux, mpeg_ps_demux_read_audio);
  if (session->audio == NULL) {
    SYS_Report("REFERENCE GX: audio initialization failed rating-key=%u\n",
               rating_key);
    playback_video_stop(session->video);
    return false;
  }
  if (start_demux && !mpeg_ps_demux_start(demux)) {
    SYS_Report(
        "REFERENCE GX: media producer initialization failed rating-key=%u\n",
        rating_key);
    audio_dma_destroy(session->audio);
    session->audio = NULL;
    playback_video_stop(session->video);
    return false;
  }
  session->source.kind = PLAYBACK_SOURCE_PROGRAM;
  session->source.value.program.demux = demux;
  session->frozen_position_ms = 0;
  session->position_frozen = false;
  return true;
}

static bool adopt_program_candidate(MultiplexPlaybackSession *session,
                                    PlaybackProgramCandidate *candidate,
                                    bool start_demux) {
  if (session == NULL || candidate == NULL || candidate->client == NULL ||
      candidate->demux == NULL || candidate->manifest.rating_key == 0 ||
      !start_program_pipeline(session, candidate->demux,
                              candidate->manifest.rating_key, start_demux)) {
    return false;
  }
  session->source.value.program.client = candidate->client;
  session->manifest = candidate->manifest;
  playback_program_candidate_clear(candidate);
  return true;
}

static bool start_hls_pipeline(MultiplexPlaybackSession *session,
                               PlexHlsDemux *demux, uint32_t rating_key) {
  const int64_t pts_delta = plex_hls_demux_first_video_pts90k(demux) -
                            plex_hls_demux_first_audio_pts90k(demux);
  int64_t pts_offset_samples = 0;
  const PlaybackVideoOpenRequest request = {
      .codec = VIDEO_CODEC_H264,
      .reader_context = demux,
      .read = plex_hls_demux_read_video,
      .width = plex_hls_demux_width(demux),
      .height = plex_hls_demux_height(demux),
      .rate_millihertz = plex_hls_demux_frame_rate_millihertz(demux),
      .stream_size = 0,
      .first_video_pts90k = plex_hls_demux_first_video_pts90k(demux),
      .first_audio_pts90k = plex_hls_demux_first_audio_pts90k(demux),
  };
  if (!playback_video_open(session->video, &request, &pts_offset_samples)) {
    SYS_Report("REFERENCE GX: H.264 initialization failed rating-key=%u\n",
               rating_key);
    return false;
  }
  session->audio =
      audio_dma_create(AUDIO_CODEC_AAC, demux, plex_hls_demux_read_audio);
  if (session->audio == NULL) {
    SYS_Report("REFERENCE GX: AAC initialization failed rating-key=%u\n",
               rating_key);
    playback_video_stop(session->video);
    return false;
  }
  session->source.value.hls.demux = demux;
  session->source.kind = PLAYBACK_SOURCE_HLS;
  session->frozen_position_ms = 0;
  session->position_frozen = false;
  SYS_Report("REFERENCE GX: direct playback pipeline rating-key=%u "
             "pts-delta=%lld pts-offset-samples=%lld\n",
             rating_key, pts_delta, pts_offset_samples);
  return true;
}

MultiplexPlaybackSession *multiplex_playback_session_create(void) {
  MultiplexPlaybackSession *session = calloc(1, sizeof(*session));
  if (session == NULL) {
    return NULL;
  }
  session->prefetch = playback_prefetch_create();
  if (session->prefetch == NULL) {
    free(session);
    return NULL;
  }
  session->timeline = playback_timeline_create();
  if (session->timeline == NULL) {
    playback_prefetch_destroy(&session->prefetch);
    free(session);
    return NULL;
  }
  session->video = playback_video_create();
  if (session->video == NULL) {
    playback_timeline_destroy(&session->timeline);
    playback_prefetch_destroy(&session->prefetch);
    free(session);
    return NULL;
  }
  SYS_Report("REFERENCE GX: playback-session context=%u bytes\n",
             (unsigned)sizeof(*session));
  return session;
}

static void stop_active_source(MultiplexPlaybackSession *session) {
  if (session == NULL || session->source.kind == PLAYBACK_SOURCE_NONE) {
    return;
  }
  if (session->audio != NULL) {
    audio_dma_request_stop(session->audio);
  }
  playback_video_request_stop(session->video);
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM &&
      session->source.value.program.client != NULL) {
    http_client_request_stop(session->source.value.program.client);
  }
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM &&
      session->source.value.program.demux != NULL) {
    mpeg_ps_demux_stop(session->source.value.program.demux);
  }
  if (session->source.kind == PLAYBACK_SOURCE_HLS &&
      session->source.value.hls.demux != NULL) {
    plex_hls_demux_stop(session->source.value.hls.demux);
  }
  audio_dma_destroy(session->audio);
  session->audio = NULL;
  playback_video_stop(session->video);
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM &&
      session->source.value.program.demux != NULL) {
    SYS_Report("REFERENCE GX: media producer loops=%u\n",
               mpeg_ps_demux_loop_count(session->source.value.program.demux));
    mpeg_ps_demux_destroy(session->source.value.program.demux);
    session->source.value.program.demux = NULL;
  }
  if (session->source.kind == PLAYBACK_SOURCE_HLS &&
      session->source.value.hls.demux != NULL) {
    SYS_Report(
        "REFERENCE GX: HLS producer segments=%u video=%u audio=%u "
        "complete=%u failed=%u\n",
        plex_hls_demux_segment_count(session->source.value.hls.demux),
        plex_hls_demux_video_bytes(session->source.value.hls.demux),
        plex_hls_demux_audio_bytes(session->source.value.hls.demux),
        plex_hls_demux_complete(session->source.value.hls.demux) ? 1u : 0u,
        plex_hls_demux_failed(session->source.value.hls.demux) ? 1u : 0u);
    plex_hls_demux_destroy(session->source.value.hls.demux);
    session->source.value.hls.demux = NULL;
  }
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM) {
    http_client_destroy(session->source.value.program.client);
    session->source.value.program.client = NULL;
  }
}

void multiplex_playback_session_stop(MultiplexPlaybackSession *session) {
  if (session == NULL) {
    return;
  }
  playback_prefetch_discard_program(session->prefetch);
  const MultiplexGatewayPlaybackManifest manifest = session->manifest;
  const PlaybackTimelineRoute timeline_route = session->timeline_route;
  const PlaybackTimelineItem timeline_item = {
      .rating_key = manifest.rating_key,
      .duration_ms = manifest.media_duration_ms,
  };
  const uint32_t position_ms = playback_position_ms(session);

  multiplex_playback_session_pause(session);
  stop_active_source(session);
  playback_timeline_finish(session->timeline, &timeline_route, &timeline_item,
                           position_ms);

  memset(&session->source, 0, sizeof(session->source));
  playback_timeline_route_clear(&session->timeline_route);
  memset(&session->manifest, 0, sizeof(session->manifest));
  memset(&session->snapshot, 0, sizeof(session->snapshot));
  memset(&session->pending_event, 0, sizeof(session->pending_event));
  memset(&session->startup_watchdog, 0, sizeof(session->startup_watchdog));
  session->frozen_position_ms = 0;
  session->position_frozen = false;
}

void multiplex_playback_session_destroy(MultiplexPlaybackSession **session) {
  if (session == NULL || *session == NULL) {
    return;
  }
  multiplex_playback_session_stop(*session);
  playback_prefetch_destroy(&(*session)->prefetch);
  playback_timeline_destroy(&(*session)->timeline);
  playback_video_destroy(&(*session)->video);
  free(*session);
  *session = NULL;
}

MultiplexPlaybackSnapshot
multiplex_playback_session_step(MultiplexPlaybackSession *session,
                                const MultiplexPlaybackStepInput *input) {
  MultiplexPlaybackSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));
  if (session == NULL || input == NULL) {
    return snapshot;
  }

  snapshot.playback_ready = session->audio != NULL &&
                            playback_video_is_open(session->video) &&
                            session->source.kind != PLAYBACK_SOURCE_NONE;
  snapshot.prefetch_active = playback_prefetch_hls_active(session->prefetch);
  snapshot.rating_key = session->manifest.rating_key;
  snapshot.position_ms = playback_position_ms(session);
  snapshot.duration_ms = session->manifest.media_duration_ms;
  snapshot.segment_start_ms = session->manifest.segment_start_ms;
  snapshot.segment_duration_ms = session->manifest.segment_duration_ms;
  snapshot.burn_subtitles = session->manifest.burn_subtitles;
  snapshot.subtitle_stream_index = session->manifest.subtitle_stream_index;

  if (!input->visible || !snapshot.playback_ready) {
    audio_dma_update(session->audio, false);
    const PlaybackVideoStepInput video_input = {0};
    const PlaybackVideoStepResult video =
        playback_video_step(session->video, &video_input);
    snapshot.surface = video.surface;
    snapshot.content_width = video.content_width;
    snapshot.content_height = video.content_height;
    session->snapshot = snapshot;
    return snapshot;
  }

  bool source_ready = true;
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM) {
    MpegPsDemux *demux = session->source.value.program.demux;
    const size_t video_size = mpeg_ps_demux_video_size(demux);
    const size_t audio_size = mpeg_ps_demux_audio_size(demux);
    const size_t video_prebuffer =
        video_size < VIDEO_PREBUFFER_BYTES ? video_size : VIDEO_PREBUFFER_BYTES;
    const size_t audio_prebuffer =
        audio_size < AUDIO_PREBUFFER_BYTES ? audio_size : AUDIO_PREBUFFER_BYTES;
    source_ready = mpeg_ps_demux_video_bytes_pumped(demux) >= video_prebuffer &&
                   mpeg_ps_demux_audio_bytes_pumped(demux) >= audio_prebuffer;
  }
  const bool playing = input->playing && source_ready;
  snapshot.playing = playing;
  audio_dma_update(session->audio, playing);
  const PlaybackVideoStepInput video_input = {
      .active = true,
      .playing = playing,
      .audio_samples = audio_dma_samples_played(session->audio),
  };
  const PlaybackVideoStepResult video =
      playback_video_step(session->video, &video_input);
  snapshot.surface = video.surface;
  snapshot.playback_failed = video.failed;
  snapshot.frame_ready = video.frame_ready;
  snapshot.content_width = video.content_width;
  snapshot.content_height = video.content_height;

  uint32_t network_bytes = 0;
  if (session->source.kind == PLAYBACK_SOURCE_HLS) {
    snapshot.metrics.stream = MULTIPLEX_PLAYBACK_STREAM_HLS;
    snapshot.metrics.stream_video_bytes =
        plex_hls_demux_video_bytes(session->source.value.hls.demux);
    snapshot.metrics.stream_audio_bytes =
        plex_hls_demux_audio_bytes(session->source.value.hls.demux);
    snapshot.metrics.queued_video_bytes =
        (uint32_t)plex_hls_demux_queued_video_bytes(
            session->source.value.hls.demux);
    snapshot.metrics.queued_audio_bytes =
        (uint32_t)plex_hls_demux_queued_audio_bytes(
            session->source.value.hls.demux);
    snapshot.metrics.producer_units =
        plex_hls_demux_segment_count(session->source.value.hls.demux);
    network_bytes = snapshot.metrics.stream_video_bytes +
                    snapshot.metrics.stream_audio_bytes;
  } else if (session->source.kind == PLAYBACK_SOURCE_PROGRAM) {
    snapshot.metrics.stream = MULTIPLEX_PLAYBACK_STREAM_PROGRAM;
    snapshot.metrics.stream_video_bytes =
        (uint32_t)mpeg_ps_demux_video_bytes_pumped(
            session->source.value.program.demux);
    snapshot.metrics.stream_audio_bytes =
        (uint32_t)mpeg_ps_demux_audio_bytes_pumped(
            session->source.value.program.demux);
    snapshot.metrics.producer_units =
        mpeg_ps_demux_loop_count(session->source.value.program.demux);
  }
  if (!input->collect_network_metrics) {
    session->diagnostic_network_started = 0;
  } else if (session->diagnostic_network_started == 0) {
    session->diagnostic_network_started = gettick();
    session->diagnostic_network_last_bytes = network_bytes;
  } else {
    const uint32_t measured_us =
        elapsed_us(session->diagnostic_network_started);
    if (measured_us >= 1000000u) {
      const uint32_t delta =
          network_bytes - session->diagnostic_network_last_bytes;
      session->diagnostic_network_kib_per_second =
          (uint32_t)(((uint64_t)delta * 1000000ull) /
                     ((uint64_t)measured_us * 1024ull));
      session->diagnostic_network_started = gettick();
      session->diagnostic_network_last_bytes = network_bytes;
    }
  }
  snapshot.metrics.decoder_fps_tenths = video.decoder_fps_tenths;
  snapshot.metrics.codec_average_us = video.codec_average_us;
  snapshot.metrics.codec_max_us = video.codec_max_us;
  snapshot.metrics.upload_average_us = video.upload_average_us;
  snapshot.metrics.network_kib_per_second =
      session->diagnostic_network_kib_per_second;
  snapshot.metrics.audio_ready_buffers =
      audio_dma_ready_buffers(session->audio);
  snapshot.metrics.audio_underruns = audio_dma_underruns(session->audio);
  maintain_playback(session, input->visible);
  session->snapshot = snapshot;
  return snapshot;
}

bool multiplex_playback_session_retain_hls_prefetch(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackPrefetchRequest *request) {
  return session != NULL &&
         playback_prefetch_retain_hls(session->prefetch, request);
}

bool multiplex_playback_session_release_hls_prefetch(
    MultiplexPlaybackSession *session) {
  return session != NULL && playback_prefetch_release_hls(session->prefetch);
}

MultiplexPlaybackHlsPrefetchStatus
multiplex_playback_session_hls_prefetch_status(
    MultiplexPlaybackSession *session) {
  return session == NULL ? MULTIPLEX_PLAYBACK_HLS_PREFETCH_FAILED
                         : playback_prefetch_hls_status(session->prefetch);
}

void multiplex_playback_session_discard_hls_prefetch(
    MultiplexPlaybackSession *session) {
  if (session != NULL) {
    playback_prefetch_discard_hls(session->prefetch);
  }
}

static bool start_staged_program(MultiplexPlaybackSession *session) {
  if (session->source.kind != PLAYBACK_SOURCE_PROGRAM ||
      session->timeline_route.kind != PLAYBACK_TIMELINE_ROUTE_GATEWAY ||
      session->timeline_route.value.gateway_url[0] == '\0' ||
      !playback_video_is_playing(session->video) || session->audio == NULL ||
      session->manifest.rating_key == 0) {
    return false;
  }
  const uint64_t next_offset = (uint64_t)session->manifest.segment_start_ms +
                               session->manifest.segment_duration_ms;
  if (next_offset >= session->manifest.media_duration_ms) {
    return false;
  }
  const uint32_t position_ms = playback_position_ms(session);
  if ((uint64_t)position_ms + SEGMENT_PREFETCH_MARGIN_MS < next_offset) {
    return false;
  }

  PlaybackProgramStageRequest request = {
      .rating_key = session->manifest.rating_key,
      .offset_ms = (uint32_t)next_offset,
  };
  snprintf(request.gateway_url, sizeof(request.gateway_url), "%s",
           session->timeline_route.value.gateway_url);
  if (!playback_prefetch_stage_program(session->prefetch, &request)) {
    return false;
  }
  const uint32_t released = multiplex_native_reference_memo_clear();
  SYS_Report("REFERENCE GX: playback-session staging rating-key=%u offset=%u "
             "released-render-memo=%uKiB\n",
             request.rating_key, request.offset_ms, released / 1024u);
  return true;
}

static void publish_event(MultiplexPlaybackSession *session,
                          MultiplexPlaybackEventKind kind,
                          uint32_t next_offset_ms) {
  if (session->pending_event.kind != MULTIPLEX_PLAYBACK_EVENT_NONE) {
    return;
  }
  session->pending_event.kind = kind;
  session->pending_event.rating_key = session->manifest.rating_key;
  session->pending_event.position_ms = playback_position_ms(session);
  session->pending_event.duration_ms = session->manifest.media_duration_ms;
  session->pending_event.next_offset_ms = next_offset_ms;
}

static bool restart_stalled_program(MultiplexPlaybackSession *session,
                                    bool visible) {
  PlaybackStartupWatchdog *watchdog = &session->startup_watchdog;
  if (session->source.kind != PLAYBACK_SOURCE_PROGRAM ||
      session->timeline_route.kind != PLAYBACK_TIMELINE_ROUTE_GATEWAY ||
      session->manifest.rating_key == 0 || !visible) {
    watchdog->timing = false;
    return true;
  }
  MpegPsDemux *demux = session->source.value.program.demux;
  if (watchdog->rating_key != session->manifest.rating_key ||
      watchdog->segment_start_ms != session->manifest.segment_start_ms) {
    memset(watchdog, 0, sizeof(*watchdog));
    watchdog->rating_key = session->manifest.rating_key;
    watchdog->segment_start_ms = session->manifest.segment_start_ms;
  }

  const size_t video_bytes = mpeg_ps_demux_video_bytes_pumped(demux);
  const size_t audio_bytes = mpeg_ps_demux_audio_bytes_pumped(demux);
  if (playback_video_is_playing(session->video)) {
    watchdog->playback_started = true;
    watchdog->timing = false;
    return true;
  }
  if (watchdog->playback_started) {
    return true;
  }
  if (video_bytes != watchdog->last_video_bytes ||
      audio_bytes != watchdog->last_audio_bytes) {
    watchdog->last_video_bytes = (uint32_t)video_bytes;
    watchdog->last_audio_bytes = (uint32_t)audio_bytes;
    watchdog->started_tick = gettick();
    watchdog->timing = true;
    return true;
  }
  if (!watchdog->timing) {
    watchdog->started_tick = gettick();
    watchdog->timing = true;
    return true;
  }
  if (elapsed_us(watchdog->started_tick) < MEDIA_STARTUP_STALL_TIMEOUT_US) {
    return true;
  }
  if (watchdog->restart_count >= MEDIA_STARTUP_RESTART_LIMIT) {
    publish_event(session, MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED, 0);
    return false;
  }

  watchdog->restart_count += 1;
  MultiplexGatewayPlaybackManifest manifest = session->manifest;
  PlaybackProgramCandidate candidate = {0};
  freeze_playback_position(session);
  playback_prefetch_discard_program(session->prefetch);
  stop_active_source(session);
  memset(&session->source, 0, sizeof(session->source));
  if (!playback_program_candidate_open_manifest(&manifest, &candidate)) {
    publish_event(session, MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED, 0);
    return false;
  }
  if (!adopt_program_candidate(session, &candidate, true)) {
    playback_program_candidate_destroy(&candidate);
    publish_event(session, MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED, 0);
    return false;
  }
  watchdog->started_tick = gettick();
  watchdog->last_video_bytes = 0;
  watchdog->last_audio_bytes = 0;
  watchdog->timing = true;
  SYS_Report("REFERENCE GX: media startup restarted rating-key=%u offset=%u "
             "attempt=%u\n",
             manifest.rating_key, manifest.segment_start_ms,
             watchdog->restart_count);
  return true;
}

static void maintain_playback(MultiplexPlaybackSession *session, bool visible) {
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM) {
    MpegPsDemux *demux = session->source.value.program.demux;
    if (mpeg_ps_demux_failed(demux)) {
      publish_event(session, MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED, 0);
      return;
    }
    restart_stalled_program(session, visible);
    start_staged_program(session);
    const PlaybackProgramDecision decision =
        playback_program_decide((PlaybackProgramDecisionInput){
            .route = &session->timeline_route,
            .manifest = &session->manifest,
            .video_playing = playback_video_is_playing(session->video),
            .audio_ready = session->audio != NULL,
            .position_ms = playback_position_ms(session),
            .handoff_margin_ms = SEGMENT_HANDOFF_MARGIN_MS,
        });
    switch (decision.kind) {
    case PLAYBACK_PROGRAM_DECISION_NONE:
      break;
    case PLAYBACK_PROGRAM_DECISION_CONTINUE:
      audio_dma_update(session->audio, false);
      publish_event(session, MULTIPLEX_PLAYBACK_EVENT_PROGRAM_CONTINUE,
                    decision.next_offset_ms);
      break;
    case PLAYBACK_PROGRAM_DECISION_COMPLETE:
      audio_dma_update(session->audio, false);
      publish_event(session, MULTIPLEX_PLAYBACK_EVENT_PROGRAM_COMPLETE,
                    decision.next_offset_ms);
      break;
    }
    return;
  }

  if (session->source.kind == PLAYBACK_SOURCE_HLS) {
    PlexHlsDemux *demux = session->source.value.hls.demux;
    if (plex_hls_demux_failed(demux)) {
      publish_event(session, MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED, 0);
      return;
    }
    if (playback_video_is_playing(session->video) && session->audio != NULL &&
        plex_hls_demux_complete(demux) &&
        (uint64_t)playback_position_ms(session) +
                DIRECT_PLAYBACK_END_MARGIN_MS >=
            session->manifest.media_duration_ms) {
      audio_dma_update(session->audio, false);
      publish_event(session, MULTIPLEX_PLAYBACK_EVENT_HLS_COMPLETE, 0);
    }
  }
}

MultiplexPlaybackOpenResult multiplex_playback_session_open_program(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackProgramOpenRequest *request) {
  if (session == NULL || request == NULL) {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }
  if (request->source_kind != MULTIPLEX_PLAYBACK_PROGRAM_EMBEDDED &&
      request->source_kind != MULTIPLEX_PLAYBACK_PROGRAM_HTTP) {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }

  HttpClient *client = NULL;
  MpegPsDemux *demux = NULL;
  if (request->source_kind == MULTIPLEX_PLAYBACK_PROGRAM_HTTP) {
    const MultiplexPlaybackProgramStreamInfo *stream_info =
        &request->source.http.stream_info;
    if (request->source.http.url == NULL ||
        request->source.http.url[0] == '\0') {
      return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
    }
    client = http_client_open(request->source.http.url);
    if (client == NULL) {
      return MULTIPLEX_PLAYBACK_OPEN_NETWORK_FAILED;
    }
    if (stream_info->has_stream_info) {
      const MpegPsInfo info = {
          .video_stream_id = 0xe0,
          .audio_stream_id = 0xc0,
          .video_size = stream_info->video_bytes,
          .audio_size = stream_info->audio_bytes,
          .video_packets = stream_info->video_packets,
          .audio_packets = stream_info->audio_packets,
          .first_video_pts90k = stream_info->first_video_pts90k,
          .first_audio_pts90k = stream_info->first_audio_pts90k,
      };
      demux = mpeg_ps_demux_create_reader_with_info(
          client, http_client_size(client), read_http_program, &info);
    } else {
      demux = mpeg_ps_demux_create_reader(client, http_client_size(client),
                                          read_http_program);
    }
    http_client_begin_stream(client);
  } else {
    if (request->source.embedded.bytes == NULL ||
        request->source.embedded.size == 0) {
      return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
    }
    demux = mpeg_ps_demux_create(request->source.embedded.bytes,
                                 request->source.embedded.size);
  }
  if (demux == NULL) {
    http_client_destroy(client);
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }

  multiplex_playback_session_stop(session);
  if (!start_program_pipeline(session, demux, 0, true)) {
    mpeg_ps_demux_destroy(demux);
    http_client_destroy(client);
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  session->source.value.program.client = client;
  return MULTIPLEX_PLAYBACK_OPEN_READY;
}

MultiplexPlaybackOpenResult multiplex_playback_session_open_gateway(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackGatewayOpenRequest *request) {
  if (session == NULL || request == NULL || request->rating_key == 0 ||
      request->gateway_url[0] == '\0' ||
      request->gateway_url[sizeof(request->gateway_url) - 1u] != '\0') {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }
  if (session->source.kind == PLAYBACK_SOURCE_PROGRAM &&
      session->manifest.rating_key == request->rating_key &&
      session->manifest.segment_start_ms == request->offset_ms) {
    return MULTIPLEX_PLAYBACK_OPEN_READY;
  }

  multiplex_playback_session_stop(session);
  PlaybackProgramCandidate candidate = {0};
  if (!playback_program_candidate_open_gateway(
          request->gateway_url, request->rating_key, request->offset_ms,
          &candidate)) {
    return MULTIPLEX_PLAYBACK_OPEN_NETWORK_FAILED;
  }

  if (!adopt_program_candidate(session, &candidate, true)) {
    playback_program_candidate_destroy(&candidate);
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  if (!playback_timeline_route_set_gateway(&session->timeline_route,
                                           request->gateway_url)) {
    stop_active_source(session);
    memset(&session->source, 0, sizeof(session->source));
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  SYS_Report("REFERENCE GX: playback-session ready rating-key=%u offset=%u\n",
             session->manifest.rating_key, session->manifest.segment_start_ms);
  return MULTIPLEX_PLAYBACK_OPEN_READY;
}

MultiplexPlaybackOpenResult multiplex_playback_session_open_hls(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackHlsOpenRequest *request) {
  if (session == NULL || request == NULL || request->rating_key == 0 ||
      request->duration_ms == 0 || request->offset_ms >= request->duration_ms) {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }
  if (session->source.kind == PLAYBACK_SOURCE_HLS &&
      session->manifest.rating_key == request->rating_key &&
      session->manifest.segment_start_ms == request->offset_ms &&
      session->manifest.burn_subtitles == request->burn_subtitles &&
      (!request->burn_subtitles || session->manifest.subtitle_stream_index ==
                                       request->subtitle_stream_index)) {
    return MULTIPLEX_PLAYBACK_OPEN_READY;
  }

  char resume_session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  resume_session_id[0] = '\0';
  if (request->resume_current_session &&
      session->source.kind == PLAYBACK_SOURCE_HLS &&
      session->timeline_route.kind == PLAYBACK_TIMELINE_ROUTE_PLEX &&
      session->manifest.rating_key == request->rating_key) {
    snprintf(resume_session_id, sizeof(resume_session_id), "%s",
             session->timeline_route.value.plex.session_id);
  }

  multiplex_playback_session_stop(session);
  const uint32_t released = multiplex_native_reference_memo_clear();
  SYS_Report("REFERENCE GX: direct playback released-render-memo=%uKiB\n",
             released / 1024u);
  PlexHlsDemux *demux =
      playback_prefetch_open_hls(session->prefetch, request, resume_session_id);
  if (demux == NULL) {
    return MULTIPLEX_PLAYBACK_OPEN_NETWORK_FAILED;
  }
  if (!plex_hls_demux_start(demux) ||
      !plex_hls_demux_wait_ready(demux, HLS_VIDEO_PREBUFFER_BYTES,
                                 HLS_AUDIO_PREBUFFER_BYTES,
                                 HLS_READINESS_TIMEOUT_MS) ||
      !start_hls_pipeline(session, demux, request->rating_key)) {
    plex_hls_demux_destroy(demux);
    memset(&session->source, 0, sizeof(session->source));
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }

  const char *started_session_id = plex_hls_demux_session_id(demux);
  if (started_session_id == NULL ||
      strlen(started_session_id) >=
          sizeof(session->timeline_route.value.plex.session_id)) {
    stop_active_source(session);
    memset(&session->source, 0, sizeof(session->source));
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  if (!playback_timeline_route_set_plex(&session->timeline_route,
                                        &request->credentials,
                                        started_session_id)) {
    stop_active_source(session);
    memset(&session->source, 0, sizeof(session->source));
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  memset(&session->manifest, 0, sizeof(session->manifest));
  session->manifest.version = 1;
  session->manifest.rating_key = request->rating_key;
  session->manifest.media_duration_ms = request->duration_ms;
  session->manifest.segment_start_ms = request->offset_ms;
  session->manifest.segment_duration_ms =
      request->duration_ms - request->offset_ms;
  session->manifest.burn_subtitles = request->burn_subtitles;
  session->manifest.subtitle_stream_index = request->subtitle_stream_index;
  SYS_Report("REFERENCE GX: direct playback ready rating-key=%u offset=%u\n",
             request->rating_key, request->offset_ms);
  return MULTIPLEX_PLAYBACK_OPEN_READY;
}

MultiplexPlaybackOpenResult
multiplex_playback_session_continue_program(MultiplexPlaybackSession *session) {
  if (session == NULL || session->source.kind != PLAYBACK_SOURCE_PROGRAM ||
      session->timeline_route.kind != PLAYBACK_TIMELINE_ROUTE_GATEWAY ||
      session->timeline_route.value.gateway_url[0] == '\0' ||
      session->manifest.rating_key == 0) {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }
  const uint64_t next_offset = (uint64_t)session->manifest.segment_start_ms +
                               session->manifest.segment_duration_ms;
  if (next_offset >= session->manifest.media_duration_ms) {
    return MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST;
  }

  PlaybackProgramCandidate candidate = {0};
  const bool staged = playback_prefetch_take_program(
      session->prefetch, session->manifest.rating_key, (uint32_t)next_offset,
      &candidate);
  if (!staged) {
    const uint32_t rating_key = session->manifest.rating_key;
    char gateway_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
    snprintf(gateway_url, sizeof(gateway_url), "%s",
             session->timeline_route.value.gateway_url);
    freeze_playback_position(session);
    stop_active_source(session);
    memset(&session->source, 0, sizeof(session->source));

    if (!playback_program_candidate_open_gateway(
            gateway_url, rating_key, (uint32_t)next_offset, &candidate)) {
      return MULTIPLEX_PLAYBACK_OPEN_NETWORK_FAILED;
    }
    if (!adopt_program_candidate(session, &candidate, true)) {
      playback_program_candidate_destroy(&candidate);
      return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
    }
    memset(&session->startup_watchdog, 0, sizeof(session->startup_watchdog));
    return MULTIPLEX_PLAYBACK_OPEN_READY;
  }

  freeze_playback_position(session);
  stop_active_source(session);
  memset(&session->source, 0, sizeof(session->source));
  if (!adopt_program_candidate(session, &candidate, false)) {
    playback_program_candidate_destroy(&candidate);
    return MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED;
  }
  memset(&session->startup_watchdog, 0, sizeof(session->startup_watchdog));
  SYS_Report("REFERENCE GX: playback-session staged-switch active=%u offset=%u "
             "video-buffered=%u audio-buffered=%u\n",
             session->manifest.rating_key, session->manifest.segment_start_ms,
             (unsigned)mpeg_ps_demux_video_bytes_pumped(
                 session->source.value.program.demux),
             (unsigned)mpeg_ps_demux_audio_bytes_pumped(
                 session->source.value.program.demux));
  return MULTIPLEX_PLAYBACK_OPEN_READY;
}

MultiplexPlaybackSnapshot
multiplex_playback_session_snapshot(const MultiplexPlaybackSession *session) {
  MultiplexPlaybackSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));
  if (session == NULL) {
    return snapshot;
  }
  snapshot = session->snapshot;
  const PlaybackVideoStepResult video = playback_video_snapshot(session->video);
  snapshot.surface = video.surface;
  snapshot.playback_ready = session->source.kind != PLAYBACK_SOURCE_NONE &&
                            session->audio != NULL &&
                            playback_video_is_open(session->video);
  snapshot.playing = playback_video_is_playing(session->video);
  snapshot.prefetch_active = playback_prefetch_hls_active(session->prefetch);
  snapshot.content_width = video.content_width;
  snapshot.content_height = video.content_height;
  snapshot.rating_key = session->manifest.rating_key;
  snapshot.position_ms = playback_position_ms(session);
  snapshot.duration_ms = session->manifest.media_duration_ms;
  snapshot.segment_start_ms = session->manifest.segment_start_ms;
  snapshot.segment_duration_ms = session->manifest.segment_duration_ms;
  snapshot.burn_subtitles = session->manifest.burn_subtitles;
  snapshot.subtitle_stream_index = session->manifest.subtitle_stream_index;
  return snapshot;
}

bool multiplex_playback_session_poll_event(MultiplexPlaybackSession *session,
                                           MultiplexPlaybackEvent *event) {
  if (session == NULL || event == NULL ||
      session->pending_event.kind == MULTIPLEX_PLAYBACK_EVENT_NONE) {
    return false;
  }
  *event = session->pending_event;
  memset(&session->pending_event, 0, sizeof(session->pending_event));
  return true;
}

void multiplex_playback_session_pause(MultiplexPlaybackSession *session) {
  if (session == NULL) {
    return;
  }
  audio_dma_update(session->audio, false);
  const PlaybackVideoStepInput input = {0};
  playback_video_step(session->video, &input);
}

void multiplex_playback_session_update_timeline(
    MultiplexPlaybackSession *session, bool visible) {
  if (session == NULL || session->manifest.rating_key == 0) {
    return;
  }
  const uint32_t position_ms = playback_position_ms(session);
  const PlaybackTimelineState state =
      !visible ? PLAYBACK_TIMELINE_STATE_STOPPED
      : playback_video_is_playing(session->video)
          ? PLAYBACK_TIMELINE_STATE_PLAYING
          : PLAYBACK_TIMELINE_STATE_PAUSED;
  const PlaybackTimelineItem item = {
      .rating_key = session->manifest.rating_key,
      .duration_ms = session->manifest.media_duration_ms,
  };
  PlexHlsDemux *hls_demux = session->source.kind == PLAYBACK_SOURCE_HLS
                                ? session->source.value.hls.demux
                                : NULL;
  playback_timeline_update(session->timeline, &session->timeline_route,
                           hls_demux, &item, position_ms, state);
}
