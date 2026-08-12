#ifndef MULTIPLEX_PLEX_HLS_STATE_H
#define MULTIPLEX_PLEX_HLS_STATE_H

#include "mpeg_ts_parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef void (*MultiplexPlexHlsLock)(void *context);

typedef struct {
  MultiplexPlexHlsLock lock;
  MultiplexPlexHlsLock unlock;
  void *context;
} MultiplexPlexHlsLockOps;

typedef enum {
  MULTIPLEX_PLEX_HLS_ACTIVE = 0,
  MULTIPLEX_PLEX_HLS_FAILED = 1,
  MULTIPLEX_PLEX_HLS_COMPLETE = 2,
} MultiplexPlexHlsTerminal;

typedef struct {
  bool stopping;
  MultiplexPlexHlsTerminal terminal;
  uint32_t segment_count;
  uint32_t video_bytes;
  uint32_t audio_bytes;
  MpegTsInfo parser_info;
} MultiplexPlexHlsSnapshot;

typedef struct {
  size_t queued_video;
  size_t queued_audio;
  size_t requested_video;
  size_t requested_audio;
  size_t video_capacity;
  size_t audio_capacity;
} MultiplexPlexHlsBuffers;

typedef struct {
  MultiplexPlexHlsLockOps lock_ops;
  MultiplexPlexHlsSnapshot snapshot;
} MultiplexPlexHlsState;

void multiplex_plex_hls_state_init(MultiplexPlexHlsState *state,
                                   MultiplexPlexHlsLockOps lock_ops);
bool multiplex_plex_hls_state_request_stop(MultiplexPlexHlsState *state);
bool multiplex_plex_hls_state_is_stopping(const MultiplexPlexHlsState *state);
void multiplex_plex_hls_state_mark_failed(MultiplexPlexHlsState *state);
void multiplex_plex_hls_state_mark_complete(MultiplexPlexHlsState *state);
void multiplex_plex_hls_state_add_bytes(MultiplexPlexHlsState *state,
                                        uint32_t video_bytes,
                                        uint32_t audio_bytes);
void multiplex_plex_hls_state_mark_segment(MultiplexPlexHlsState *state);
void multiplex_plex_hls_state_publish_parser(MultiplexPlexHlsState *state,
                                             const MpegTsInfo *info);
void multiplex_plex_hls_state_snapshot(const MultiplexPlexHlsState *state,
                                       MultiplexPlexHlsSnapshot *output);
bool multiplex_plex_hls_snapshot_ready(const MultiplexPlexHlsSnapshot *snapshot,
                                       const MultiplexPlexHlsBuffers *buffers);

#endif
