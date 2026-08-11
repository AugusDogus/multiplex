#ifndef MULTIPLEX_PLAYBACK_PREFETCH_H
#define MULTIPLEX_PLAYBACK_PREFETCH_H

#include "http_client.h"
#include "mpeg_ps_demux.h"
#include "playback_session.h"
#include "plex_hls_demux.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct PlaybackPrefetch PlaybackPrefetch;

typedef struct {
  MultiplexGatewayPlaybackManifest manifest;
  HttpClient *client;
  MpegPsDemux *demux;
} PlaybackProgramCandidate;

typedef struct {
  char gateway_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
  uint32_t rating_key;
  uint32_t offset_ms;
} PlaybackProgramStageRequest;

PlaybackPrefetch *playback_prefetch_create(void);
void playback_prefetch_destroy(PlaybackPrefetch **prefetch);
bool playback_prefetch_hls_active(const PlaybackPrefetch *prefetch);
bool playback_prefetch_retain_hls(
    PlaybackPrefetch *prefetch,
    const MultiplexPlaybackPrefetchRequest *request);
bool playback_prefetch_release_hls(PlaybackPrefetch *prefetch);
MultiplexPlaybackHlsPrefetchStatus
playback_prefetch_hls_status(PlaybackPrefetch *prefetch);
void playback_prefetch_discard_hls(PlaybackPrefetch *prefetch);
PlexHlsDemux *
playback_prefetch_open_hls(PlaybackPrefetch *prefetch,
                           const MultiplexPlaybackHlsOpenRequest *request,
                           const char *resume_session_id);

void playback_program_candidate_clear(PlaybackProgramCandidate *candidate);
void playback_program_candidate_destroy(PlaybackProgramCandidate *candidate);
bool playback_program_candidate_open_manifest(
    const MultiplexGatewayPlaybackManifest *manifest,
    PlaybackProgramCandidate *candidate);
bool playback_program_candidate_open_gateway(
    const char *gateway_url, uint32_t rating_key, uint32_t offset_ms,
    PlaybackProgramCandidate *candidate);

bool playback_prefetch_stage_program(
    PlaybackPrefetch *prefetch, const PlaybackProgramStageRequest *request);
bool playback_prefetch_take_program(PlaybackPrefetch *prefetch,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    PlaybackProgramCandidate *candidate);
void playback_prefetch_discard_program(PlaybackPrefetch *prefetch);

#endif
