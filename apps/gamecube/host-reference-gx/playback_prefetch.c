#include "playback_prefetch.h"

#include "plex_hls.h"

#include <gccore.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <stdlib.h>
#include <string.h>

#define MEDIA_PREFETCH_STACK_SIZE (256u * 1024u)
#define HLS_SESSION_PREFETCH_STACK_SIZE (128u * 1024u)

typedef struct {
  MultiplexAuthCredentials credentials;
  MultiplexPlexHlsSession session;
  HlsMediaPlaylist playlist;
  lwp_t thread;
  void *stack;
  uint32_t rating_key;
  uint32_t offset_ms;
  uint32_t subtitle_stream_index;
  uint32_t started_tick;
  bool burn_subtitles;
  bool started;
  volatile bool complete;
  volatile bool ready;
} PlaybackHlsPrefetch;

typedef struct {
  PlaybackProgramStageRequest request;
  PlaybackProgramCandidate candidate;
  lwp_t thread;
  void *stack;
  volatile bool ready;
  volatile bool failed;
} PlaybackProgramStage;

struct PlaybackPrefetch {
  PlaybackHlsPrefetch hls;
  PlaybackProgramStage program;
};

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size) {
  return http_client_read_at(context, offset, destination, size);
}

void playback_program_candidate_clear(PlaybackProgramCandidate *candidate) {
  if (candidate != NULL) {
    memset(candidate, 0, sizeof(*candidate));
  }
}

void playback_program_candidate_destroy(PlaybackProgramCandidate *candidate) {
  if (candidate == NULL) {
    return;
  }
  http_client_request_stop(candidate->client);
  if (candidate->demux != NULL) {
    mpeg_ps_demux_stop(candidate->demux);
    mpeg_ps_demux_destroy(candidate->demux);
  }
  http_client_destroy(candidate->client);
  playback_program_candidate_clear(candidate);
}

bool playback_program_candidate_open_manifest(
    const MultiplexGatewayPlaybackManifest *manifest,
    PlaybackProgramCandidate *candidate) {
  if (manifest == NULL || candidate == NULL || manifest->media_url[0] == '\0') {
    return false;
  }
  playback_program_candidate_destroy(candidate);
  HttpClient *client = http_client_open(manifest->media_url);
  if (client == NULL) {
    SYS_Report("REFERENCE GX: HTTP media initialization failed rating-key=%u\n",
               manifest->rating_key);
    return false;
  }
  const MpegPsInfo info = {
      .video_stream_id = 0xe0,
      .audio_stream_id = 0xc0,
      .video_size = manifest->video_bytes,
      .audio_size = manifest->audio_bytes,
      .video_packets = manifest->video_packets,
      .audio_packets = manifest->audio_packets,
      .first_video_pts90k = manifest->first_video_pts90k,
      .first_audio_pts90k = manifest->first_audio_pts90k,
  };
  MpegPsDemux *demux = mpeg_ps_demux_create_reader_with_info(
      client, http_client_size(client), read_http_program, &info);
  if (demux == NULL) {
    http_client_destroy(client);
    return false;
  }
  SYS_Report("REFERENCE GX: media-source=http rating-key=%u host=%s port=%u "
             "bytes=%u ranges=%u\n",
             manifest->rating_key, http_client_host(client),
             http_client_port(client), (unsigned)http_client_size(client),
             http_client_range_count(client));
  http_client_begin_stream(client);
  candidate->manifest = *manifest;
  candidate->client = client;
  candidate->demux = demux;
  return true;
}

bool playback_program_candidate_open_gateway(
    const char *gateway_url, uint32_t rating_key, uint32_t offset_ms,
    PlaybackProgramCandidate *candidate) {
  if (gateway_url == NULL || gateway_url[0] == '\0' || rating_key == 0 ||
      candidate == NULL) {
    return false;
  }
  MultiplexGatewayPlaybackManifest manifest;
  if (!multiplex_gateway_load_playback_manifest(gateway_url, rating_key,
                                                offset_ms, &manifest)) {
    return false;
  }
  return playback_program_candidate_open_manifest(&manifest, candidate);
}

static void reset_hls(PlaybackHlsPrefetch *hls) {
  memset(hls, 0, sizeof(*hls));
  hls->thread = LWP_THREAD_NULL;
}

static void *run_hls(void *context) {
  PlaybackHlsPrefetch *hls = context;
  hls->ready =
      multiplex_plex_hls_start(&hls->credentials, hls->rating_key,
                               hls->offset_ms, NULL, hls->burn_subtitles,
                               hls->subtitle_stream_index, &hls->session) &&
      multiplex_plex_hls_refresh(&hls->credentials, &hls->session,
                                 &hls->playlist);
  __sync_synchronize();
  hls->complete = true;
  return NULL;
}

static bool finish_hls(PlaybackHlsPrefetch *hls, bool wait) {
  if (hls == NULL || !hls->started) {
    return false;
  }
  if (hls->thread != LWP_THREAD_NULL) {
    if (!wait && !hls->complete) {
      return false;
    }
    LWP_JoinThread(hls->thread, NULL);
    hls->thread = LWP_THREAD_NULL;
    free(hls->stack);
    hls->stack = NULL;
    __sync_synchronize();
    SYS_Report("REFERENCE GX: HLS session prefetch ready=%u rating-key=%u "
               "us=%u\n",
               hls->ready ? 1u : 0u, hls->rating_key,
               elapsed_us(hls->started_tick));
  }
  return hls->ready;
}

void playback_prefetch_discard_hls(PlaybackPrefetch *prefetch) {
  if (prefetch == NULL || !prefetch->hls.started) {
    return;
  }
  PlaybackHlsPrefetch *hls = &prefetch->hls;
  finish_hls(hls, true);
  if (hls->session.started) {
    multiplex_plex_hls_stop(&hls->credentials, &hls->session);
  }
  reset_hls(hls);
}

bool playback_prefetch_retain_hls(
    PlaybackPrefetch *prefetch,
    const MultiplexPlaybackPrefetchRequest *request) {
  if (prefetch == NULL || request == NULL) {
    return false;
  }
  PlaybackHlsPrefetch *hls = &prefetch->hls;
  finish_hls(hls, false);
  if (request->disposition == MULTIPLEX_PLAYBACK_PREFETCH_RELEASE_WHEN_READY) {
    if (hls->started && hls->complete) {
      playback_prefetch_discard_hls(prefetch);
    }
    return true;
  }
  if (request->disposition != MULTIPLEX_PLAYBACK_PREFETCH_RETAIN ||
      request->rating_key == 0) {
    return false;
  }
  if (hls->started && hls->rating_key == request->rating_key &&
      hls->offset_ms == request->offset_ms &&
      hls->burn_subtitles == request->burn_subtitles &&
      (!request->burn_subtitles ||
       hls->subtitle_stream_index == request->subtitle_stream_index)) {
    SYS_Report("REFERENCE GX: HLS session prefetch retained rating-key=%u "
               "offset=%u\n",
               request->rating_key, request->offset_ms);
    return true;
  }
  if (hls->started && !hls->complete) {
    SYS_Report("REFERENCE GX: HLS session prefetch deferred rating-key=%u "
               "behind=%u\n",
               request->rating_key, hls->rating_key);
    return true;
  }
  playback_prefetch_discard_hls(prefetch);
  reset_hls(hls);
  hls->credentials = request->credentials;
  hls->rating_key = request->rating_key;
  hls->offset_ms = request->offset_ms;
  hls->burn_subtitles = request->burn_subtitles;
  hls->subtitle_stream_index = request->subtitle_stream_index;
  hls->stack = malloc(HLS_SESSION_PREFETCH_STACK_SIZE);
  hls->started_tick = gettick();
  if (hls->stack == NULL ||
      LWP_CreateThread(&hls->thread, run_hls, hls, hls->stack,
                       HLS_SESSION_PREFETCH_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    free(hls->stack);
    reset_hls(hls);
    return false;
  }
  hls->started = true;
  SYS_Report("REFERENCE GX: HLS session prefetch started rating-key=%u "
             "offset=%u\n",
             hls->rating_key, hls->offset_ms);
  return true;
}

bool playback_prefetch_hls_active(const PlaybackPrefetch *prefetch) {
  return prefetch != NULL && prefetch->hls.started;
}

PlexHlsDemux *
playback_prefetch_open_hls(PlaybackPrefetch *prefetch,
                           const MultiplexPlaybackHlsOpenRequest *request,
                           const char *resume_session_id) {
  if (prefetch == NULL || request == NULL) {
    return NULL;
  }
  PlaybackHlsPrefetch *hls = &prefetch->hls;
  PlexHlsDemux *demux = NULL;
  const bool use_resume =
      resume_session_id != NULL && resume_session_id[0] != '\0';
  const bool prefetch_matches =
      !use_resume && hls->started && hls->rating_key == request->rating_key &&
      hls->offset_ms == request->offset_ms &&
      hls->burn_subtitles == request->burn_subtitles &&
      (!request->burn_subtitles ||
       hls->subtitle_stream_index == request->subtitle_stream_index) &&
      finish_hls(hls, true);
  if (prefetch_matches) {
    demux = plex_hls_demux_create_prepared(&request->credentials,
                                           request->rating_key, &hls->session,
                                           &hls->playlist);
    if (demux != NULL) {
      hls->session.started = false;
      reset_hls(hls);
    }
  }
  if (demux == NULL) {
    playback_prefetch_discard_hls(prefetch);
    demux = plex_hls_demux_create(
        &request->credentials, request->rating_key, request->offset_ms,
        use_resume ? resume_session_id : NULL, request->burn_subtitles,
        request->subtitle_stream_index);
  }
  return demux;
}

static void reset_program(PlaybackProgramStage *program) {
  memset(program, 0, sizeof(*program));
  program->thread = LWP_THREAD_NULL;
}

static void *run_program(void *context) {
  PlaybackProgramStage *program = context;
  program->ready =
      playback_program_candidate_open_gateway(
          program->request.gateway_url, program->request.rating_key,
          program->request.offset_ms, &program->candidate) &&
      mpeg_ps_demux_start(program->candidate.demux);
  program->failed = !program->ready;
  if (program->ready) {
    SYS_Report(
        "REFERENCE GX: playback-session staged rating-key=%u offset=%u\n",
        program->request.rating_key, program->request.offset_ms);
  }
  return NULL;
}

static void join_program(PlaybackProgramStage *program) {
  if (program->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(program->thread, NULL);
    program->thread = LWP_THREAD_NULL;
  }
  free(program->stack);
  program->stack = NULL;
}

void playback_prefetch_discard_program(PlaybackPrefetch *prefetch) {
  if (prefetch == NULL) {
    return;
  }
  PlaybackProgramStage *program = &prefetch->program;
  join_program(program);
  playback_program_candidate_destroy(&program->candidate);
  reset_program(program);
}

bool playback_prefetch_stage_program(
    PlaybackPrefetch *prefetch, const PlaybackProgramStageRequest *request) {
  if (prefetch == NULL || request == NULL || request->gateway_url[0] == '\0' ||
      request->rating_key == 0) {
    return false;
  }
  PlaybackProgramStage *program = &prefetch->program;
  if (program->thread != LWP_THREAD_NULL || program->ready || program->failed) {
    return false;
  }
  program->request = *request;
  program->stack = malloc(MEDIA_PREFETCH_STACK_SIZE);
  if (program->stack == NULL ||
      LWP_CreateThread(&program->thread, run_program, program, program->stack,
                       MEDIA_PREFETCH_STACK_SIZE, LWP_PRIO_NORMAL / 2) != 0) {
    free(program->stack);
    reset_program(program);
    return false;
  }
  return true;
}

bool playback_prefetch_take_program(PlaybackPrefetch *prefetch,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    PlaybackProgramCandidate *candidate) {
  if (prefetch == NULL || candidate == NULL) {
    return false;
  }
  PlaybackProgramStage *program = &prefetch->program;
  join_program(program);
  if (!program->ready || program->failed ||
      program->request.rating_key != rating_key ||
      program->request.offset_ms != offset_ms ||
      program->candidate.client == NULL || program->candidate.demux == NULL) {
    playback_prefetch_discard_program(prefetch);
    return false;
  }
  playback_program_candidate_destroy(candidate);
  *candidate = program->candidate;
  playback_program_candidate_clear(&program->candidate);
  reset_program(program);
  return true;
}

PlaybackPrefetch *playback_prefetch_create(void) {
  PlaybackPrefetch *prefetch = calloc(1, sizeof(*prefetch));
  if (prefetch != NULL) {
    reset_hls(&prefetch->hls);
    reset_program(&prefetch->program);
  }
  return prefetch;
}

void playback_prefetch_destroy(PlaybackPrefetch **prefetch) {
  if (prefetch == NULL || *prefetch == NULL) {
    return;
  }
  playback_prefetch_discard_program(*prefetch);
  playback_prefetch_discard_hls(*prefetch);
  free(*prefetch);
  *prefetch = NULL;
}
