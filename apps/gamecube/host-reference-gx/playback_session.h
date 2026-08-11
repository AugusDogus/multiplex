#ifndef MULTIPLEX_PLAYBACK_SESSION_H
#define MULTIPLEX_PLAYBACK_SESSION_H

#include "auth_record.h"
#include "gateway_client.h"
#include "playback_frame.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MultiplexPlaybackSession MultiplexPlaybackSession;

typedef enum {
  MULTIPLEX_PLAYBACK_OPEN_READY = 0,
  MULTIPLEX_PLAYBACK_OPEN_INVALID_REQUEST = 1,
  MULTIPLEX_PLAYBACK_OPEN_NETWORK_FAILED = 2,
  MULTIPLEX_PLAYBACK_OPEN_MEDIA_FAILED = 3,
} MultiplexPlaybackOpenResult;

typedef struct {
  bool visible;
  bool playing;
  bool collect_network_metrics;
} MultiplexPlaybackStepInput;

typedef enum {
  MULTIPLEX_PLAYBACK_PROGRAM_EMBEDDED = 0,
  MULTIPLEX_PLAYBACK_PROGRAM_HTTP = 1,
} MultiplexPlaybackProgramSourceKind;

typedef struct {
  bool has_stream_info;
  uint32_t video_bytes;
  uint32_t audio_bytes;
  uint32_t video_packets;
  uint32_t audio_packets;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
} MultiplexPlaybackProgramStreamInfo;

typedef struct {
  MultiplexPlaybackProgramSourceKind source_kind;
  union {
    struct {
      const uint8_t *bytes;
      size_t size;
    } embedded;
    struct {
      const char *url;
      MultiplexPlaybackProgramStreamInfo stream_info;
    } http;
  } source;
} MultiplexPlaybackProgramOpenRequest;

typedef struct {
  char gateway_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
  uint32_t rating_key;
  uint32_t offset_ms;
} MultiplexPlaybackGatewayOpenRequest;

typedef struct {
  MultiplexAuthCredentials credentials;
  uint32_t rating_key;
  uint32_t offset_ms;
  uint32_t duration_ms;
  bool resume_current_session;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexPlaybackHlsOpenRequest;

typedef struct {
  MultiplexAuthCredentials credentials;
  uint32_t rating_key;
  uint32_t offset_ms;
  bool burn_subtitles;
  uint32_t subtitle_stream_index;
} MultiplexPlaybackPrefetchRequest;

typedef enum {
  MULTIPLEX_PLAYBACK_HLS_PREFETCH_IDLE = 0,
  MULTIPLEX_PLAYBACK_HLS_PREFETCH_RETAINING = 1,
  MULTIPLEX_PLAYBACK_HLS_PREFETCH_READY = 2,
  MULTIPLEX_PLAYBACK_HLS_PREFETCH_FAILED = 3,
  MULTIPLEX_PLAYBACK_HLS_PREFETCH_RELEASING = 4,
} MultiplexPlaybackHlsPrefetchStatus;

typedef enum {
  MULTIPLEX_PLAYBACK_EVENT_NONE = 0,
  MULTIPLEX_PLAYBACK_EVENT_SOURCE_FAILED = 1,
  MULTIPLEX_PLAYBACK_EVENT_STARTUP_RECOVERY_FAILED = 2,
  MULTIPLEX_PLAYBACK_EVENT_PROGRAM_CONTINUE = 3,
  MULTIPLEX_PLAYBACK_EVENT_PROGRAM_COMPLETE = 4,
  MULTIPLEX_PLAYBACK_EVENT_HLS_COMPLETE = 5,
} MultiplexPlaybackEventKind;

typedef struct {
  MultiplexPlaybackEventKind kind;
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  uint32_t next_offset_ms;
} MultiplexPlaybackEvent;

MultiplexPlaybackSession *multiplex_playback_session_create(void);
void multiplex_playback_session_destroy(MultiplexPlaybackSession **session);

MultiplexPlaybackOpenResult multiplex_playback_session_open_program(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackProgramOpenRequest *request);
MultiplexPlaybackOpenResult multiplex_playback_session_open_gateway(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackGatewayOpenRequest *request);
MultiplexPlaybackOpenResult multiplex_playback_session_open_hls(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackHlsOpenRequest *request);
MultiplexPlaybackOpenResult
multiplex_playback_session_continue_program(MultiplexPlaybackSession *session);

bool multiplex_playback_session_retain_hls_prefetch(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackPrefetchRequest *request);
bool multiplex_playback_session_release_hls_prefetch(
    MultiplexPlaybackSession *session);
MultiplexPlaybackHlsPrefetchStatus
multiplex_playback_session_hls_prefetch_status(
    MultiplexPlaybackSession *session);
void multiplex_playback_session_discard_hls_prefetch(
    MultiplexPlaybackSession *session);

MultiplexPlaybackSnapshot
multiplex_playback_session_step(MultiplexPlaybackSession *session,
                                const MultiplexPlaybackStepInput *input);
MultiplexPlaybackSnapshot
multiplex_playback_session_snapshot(const MultiplexPlaybackSession *session);
bool multiplex_playback_session_poll_event(MultiplexPlaybackSession *session,
                                           MultiplexPlaybackEvent *event);
void multiplex_playback_session_pause(MultiplexPlaybackSession *session);
void multiplex_playback_session_update_timeline(
    MultiplexPlaybackSession *session, bool visible);
void multiplex_playback_session_stop(MultiplexPlaybackSession *session);

#endif
