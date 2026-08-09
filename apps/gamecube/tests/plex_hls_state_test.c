#include "plex_hls_state.h"

#include <assert.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
  pthread_mutex_t mutex;
  unsigned lock_count;
  unsigned unlock_count;
} Fixture;

static void lock(void *context) {
  Fixture *fixture = context;
  assert(pthread_mutex_lock(&fixture->mutex) == 0);
  fixture->lock_count += 1u;
}

static void unlock(void *context) {
  Fixture *fixture = context;
  fixture->unlock_count += 1u;
  assert(pthread_mutex_unlock(&fixture->mutex) == 0);
}

static MultiplexPlexHlsState state_for(Fixture *fixture) {
  MultiplexPlexHlsState state;
  multiplex_plex_hls_state_init(
      &state, (MultiplexPlexHlsLockOps){
                  .lock = lock, .unlock = unlock, .context = fixture});
  return state;
}

static void test_initial_snapshot_uses_parser_sentinels(void) {
  Fixture fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState state = state_for(&fixture);
  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&state, &snapshot);

  assert(!snapshot.stopping);
  assert(snapshot.terminal == MULTIPLEX_PLEX_HLS_ACTIVE);
  assert(snapshot.parser_info.pmt_pid == MPEG_TS_NO_PID);
  assert(snapshot.parser_info.video_pid == MPEG_TS_NO_PID);
  assert(snapshot.parser_info.audio_pid == MPEG_TS_NO_PID);
  assert(snapshot.parser_info.first_video_pts90k == MPEG_TS_NO_PTS);
  assert(snapshot.parser_info.first_audio_pts90k == MPEG_TS_NO_PTS);
  assert(fixture.lock_count == fixture.unlock_count);
}

static void test_snapshot_publishes_session_progress(void) {
  Fixture fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState state = state_for(&fixture);
  const MpegTsInfo info = {
      .pmt_pid = 1,
      .video_pid = 2,
      .audio_pid = 3,
      .first_video_pts90k = INT64_C(0x100000001),
      .first_audio_pts90k = INT64_C(0x200000002),
  };

  multiplex_plex_hls_state_publish_parser(&state, &info);
  multiplex_plex_hls_state_add_bytes(&state, 11, 13);
  multiplex_plex_hls_state_mark_segment(&state);

  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&state, &snapshot);
  assert(snapshot.segment_count == 1);
  assert(snapshot.video_bytes == 11);
  assert(snapshot.audio_bytes == 13);
  assert(snapshot.parser_info.first_video_pts90k == INT64_C(0x100000001));
  assert(snapshot.parser_info.first_audio_pts90k == INT64_C(0x200000002));
}

static void test_terminal_state_is_exclusive(void) {
  Fixture failed_fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState failed_state = state_for(&failed_fixture);
  multiplex_plex_hls_state_mark_failed(&failed_state);
  multiplex_plex_hls_state_mark_complete(&failed_state);

  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&failed_state, &snapshot);
  assert(snapshot.terminal == MULTIPLEX_PLEX_HLS_FAILED);

  Fixture complete_fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState complete_state = state_for(&complete_fixture);
  multiplex_plex_hls_state_mark_complete(&complete_state);
  multiplex_plex_hls_state_mark_failed(&complete_state);
  multiplex_plex_hls_state_snapshot(&complete_state, &snapshot);
  assert(snapshot.terminal == MULTIPLEX_PLEX_HLS_COMPLETE);
}

static void test_stop_publishes_snapshot_and_transport_boundary(void) {
  Fixture fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState state = state_for(&fixture);
  assert(!multiplex_plex_hls_state_is_stopping(&state));
  assert(!state.http_client_cancelled);

  assert(multiplex_plex_hls_state_request_stop(&state));
  assert(!multiplex_plex_hls_state_request_stop(&state));

  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&state, &snapshot);
  assert(snapshot.stopping);
  assert(multiplex_plex_hls_state_is_stopping(&state));
  assert(state.http_client_cancelled);
}

static void test_readiness_requires_metadata_and_prebuffer(void) {
  MultiplexPlexHlsSnapshot snapshot = {
      .terminal = MULTIPLEX_PLEX_HLS_ACTIVE,
      .parser_info = {.video_pid = 2,
                      .audio_pid = 3,
                      .first_video_pts90k = INT64_C(0x100000001),
                      .first_audio_pts90k = INT64_C(0x200000002)},
  };
  MultiplexPlexHlsBuffers buffers = {
      .queued_video = 100,
      .queued_audio = 50,
      .requested_video = 100,
      .requested_audio = 50,
      .video_capacity = 200,
      .audio_capacity = 100,
  };
  assert(multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));

  buffers.queued_video = 99;
  assert(!multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
  buffers = (MultiplexPlexHlsBuffers){.queued_video = 200,
                                      .queued_audio = 1,
                                      .requested_video = 300,
                                      .requested_audio = 50,
                                      .video_capacity = 200,
                                      .audio_capacity = 100};
  assert(multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
  buffers.queued_audio = 0;
  assert(!multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
  buffers = (MultiplexPlexHlsBuffers){.queued_video = 1,
                                      .queued_audio = 100,
                                      .requested_video = 100,
                                      .requested_audio = 200,
                                      .video_capacity = 200,
                                      .audio_capacity = 100};
  assert(multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));

  snapshot.parser_info.first_audio_pts90k = MPEG_TS_NO_PTS;
  assert(!multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
  snapshot.parser_info.first_audio_pts90k = INT64_C(0x200000002);
  snapshot.stopping = true;
  assert(!multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
  snapshot.stopping = false;
  snapshot.terminal = MULTIPLEX_PLEX_HLS_COMPLETE;
  assert(!multiplex_plex_hls_snapshot_ready(&snapshot, &buffers));
}

static const MpegTsInfo first_info = {
    .pmt_pid = 0x101,
    .video_pid = 0x102,
    .audio_pid = 0x103,
    .video_stream_type = 0x11,
    .audio_stream_type = 0x22,
    .video_packets = 0x11111111,
    .audio_packets = 0x22222222,
    .video_bytes = UINT64_C(0x1111111122222222),
    .audio_bytes = UINT64_C(0x3333333344444444),
    .first_video_pts90k = INT64_C(0x1111111122222222),
    .first_audio_pts90k = INT64_C(0x3333333344444444),
};

static const MpegTsInfo second_info = {
    .pmt_pid = 0x201,
    .video_pid = 0x202,
    .audio_pid = 0x203,
    .video_stream_type = 0xaa,
    .audio_stream_type = 0xbb,
    .video_packets = 0xaaaaaaaa,
    .audio_packets = 0xbbbbbbbb,
    .video_bytes = UINT64_C(0xaaaabbbbccccdddd),
    .audio_bytes = UINT64_C(0x1111222233334444),
    .first_video_pts90k = INT64_C(0x5555666677770001),
    .first_audio_pts90k = INT64_C(0x2222333344440002),
};

typedef struct {
  MultiplexPlexHlsState *state;
} WriterContext;

static void *publish_snapshots(void *context) {
  WriterContext *writer = context;
  for (unsigned index = 0; index < 10000; ++index) {
    const MpegTsInfo *info = index % 2u == 0 ? &first_info : &second_info;
    multiplex_plex_hls_state_publish_parser(writer->state, info);
    multiplex_plex_hls_state_add_bytes(writer->state, 1, 2);
  }
  return NULL;
}

static bool info_matches(const MpegTsInfo *actual, const MpegTsInfo *expected) {
  return actual->pmt_pid == expected->pmt_pid &&
         actual->video_pid == expected->video_pid &&
         actual->audio_pid == expected->audio_pid &&
         actual->video_stream_type == expected->video_stream_type &&
         actual->audio_stream_type == expected->audio_stream_type &&
         actual->video_packets == expected->video_packets &&
         actual->audio_packets == expected->audio_packets &&
         actual->video_bytes == expected->video_bytes &&
         actual->audio_bytes == expected->audio_bytes &&
         actual->first_video_pts90k == expected->first_video_pts90k &&
         actual->first_audio_pts90k == expected->first_audio_pts90k;
}

static void test_snapshot_is_coherent_during_publication(void) {
  Fixture fixture = {.mutex = PTHREAD_MUTEX_INITIALIZER};
  MultiplexPlexHlsState state = state_for(&fixture);
  WriterContext writer = {.state = &state};
  pthread_t thread;
  assert(pthread_create(&thread, NULL, publish_snapshots, &writer) == 0);
  const MpegTsInfo initial_info = {
      .pmt_pid = MPEG_TS_NO_PID,
      .video_pid = MPEG_TS_NO_PID,
      .audio_pid = MPEG_TS_NO_PID,
      .first_video_pts90k = MPEG_TS_NO_PTS,
      .first_audio_pts90k = MPEG_TS_NO_PTS,
  };

  for (unsigned index = 0; index < 10000; ++index) {
    MultiplexPlexHlsSnapshot snapshot;
    multiplex_plex_hls_state_snapshot(&state, &snapshot);
    assert(info_matches(&snapshot.parser_info, &initial_info) ||
           info_matches(&snapshot.parser_info, &first_info) ||
           info_matches(&snapshot.parser_info, &second_info));
    assert(snapshot.audio_bytes == snapshot.video_bytes * 2u);
  }

  assert(pthread_join(thread, NULL) == 0);
  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&state, &snapshot);
  assert(snapshot.video_bytes == 10000);
  assert(snapshot.audio_bytes == 20000);
  assert(fixture.lock_count == fixture.unlock_count);
}

int main(void) {
  test_initial_snapshot_uses_parser_sentinels();
  test_snapshot_publishes_session_progress();
  test_terminal_state_is_exclusive();
  test_stop_publishes_snapshot_and_transport_boundary();
  test_readiness_requires_metadata_and_prebuffer();
  test_snapshot_is_coherent_during_publication();
  puts("GameCube Plex HLS state tests passed.");
  return 0;
}
