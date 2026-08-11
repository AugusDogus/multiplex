#include "plex_hls_state.h"

static void state_lock(const MultiplexPlexHlsState *state) {
  state->lock_ops.lock(state->lock_ops.context);
}

static void state_unlock(const MultiplexPlexHlsState *state) {
  state->lock_ops.unlock(state->lock_ops.context);
}

void multiplex_plex_hls_state_init(MultiplexPlexHlsState *state,
                                   MultiplexPlexHlsLockOps lock_ops) {
  *state = (MultiplexPlexHlsState){
      .lock_ops = lock_ops,
      .snapshot = {.parser_info =
                       {
                           .pmt_pid = MPEG_TS_NO_PID,
                           .video_pid = MPEG_TS_NO_PID,
                           .audio_pid = MPEG_TS_NO_PID,
                           .first_video_pts90k = MPEG_TS_NO_PTS,
                           .first_audio_pts90k = MPEG_TS_NO_PTS,
                       }},
  };
}

bool multiplex_plex_hls_state_request_stop(MultiplexPlexHlsState *state) {
  state_lock(state);
  const bool requested = !state->snapshot.stopping;
  state->snapshot.stopping = true;
  state_unlock(state);
  return requested;
}

bool multiplex_plex_hls_state_is_stopping(const MultiplexPlexHlsState *state) {
  state_lock(state);
  const bool stopping = state->snapshot.stopping;
  state_unlock(state);
  return stopping;
}

void multiplex_plex_hls_state_mark_failed(MultiplexPlexHlsState *state) {
  state_lock(state);
  if (state->snapshot.terminal == MULTIPLEX_PLEX_HLS_ACTIVE) {
    state->snapshot.terminal = MULTIPLEX_PLEX_HLS_FAILED;
  }
  state_unlock(state);
}

void multiplex_plex_hls_state_mark_complete(MultiplexPlexHlsState *state) {
  state_lock(state);
  if (state->snapshot.terminal == MULTIPLEX_PLEX_HLS_ACTIVE) {
    state->snapshot.terminal = MULTIPLEX_PLEX_HLS_COMPLETE;
  }
  state_unlock(state);
}

void multiplex_plex_hls_state_add_bytes(MultiplexPlexHlsState *state,
                                        uint32_t video_bytes,
                                        uint32_t audio_bytes) {
  state_lock(state);
  state->snapshot.video_bytes += video_bytes;
  state->snapshot.audio_bytes += audio_bytes;
  state_unlock(state);
}

void multiplex_plex_hls_state_mark_segment(MultiplexPlexHlsState *state) {
  state_lock(state);
  state->snapshot.segment_count += 1u;
  state_unlock(state);
}

void multiplex_plex_hls_state_publish_parser(MultiplexPlexHlsState *state,
                                             const MpegTsInfo *info) {
  state_lock(state);
  state->snapshot.parser_info = *info;
  state_unlock(state);
}

void multiplex_plex_hls_state_snapshot(const MultiplexPlexHlsState *state,
                                       MultiplexPlexHlsSnapshot *output) {
  state_lock(state);
  *output = state->snapshot;
  state_unlock(state);
}

bool multiplex_plex_hls_snapshot_ready(const MultiplexPlexHlsSnapshot *snapshot,
                                       const MultiplexPlexHlsBuffers *buffers) {
  if (snapshot->stopping || snapshot->terminal != MULTIPLEX_PLEX_HLS_ACTIVE ||
      snapshot->parser_info.video_pid == MPEG_TS_NO_PID ||
      snapshot->parser_info.audio_pid == MPEG_TS_NO_PID ||
      snapshot->parser_info.first_video_pts90k == MPEG_TS_NO_PTS ||
      snapshot->parser_info.first_audio_pts90k == MPEG_TS_NO_PTS) {
    return false;
  }
  const bool requested_prebuffer =
      buffers->queued_video >= buffers->requested_video &&
      buffers->queued_audio >= buffers->requested_audio;
  const bool producer_backpressured =
      (buffers->queued_video == buffers->video_capacity &&
       buffers->queued_audio != 0) ||
      (buffers->queued_audio == buffers->audio_capacity &&
       buffers->queued_video != 0);
  return requested_prebuffer || producer_backpressured;
}
