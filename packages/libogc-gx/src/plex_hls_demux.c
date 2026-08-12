/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Incremental Plex HLS producer. The network thread streams one MPEG-TS
 * segment at a time through PAT/PMT/PES parsing and into bounded elementary
 * stream queues. Codec threads never retain transport segments.
 */

#include "plex_hls_demux.h"

#include "media_byte_queue.h"
#include "mpeg_ts_parser.h"
#include "plex_catalog.h"
#include "plex_hls.h"
#include "plex_hls_state.h"

#include <gccore.h>
#include <ogc/lwp.h>
#include <ogc/mutex.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

#define HLS_VIDEO_QUEUE_SIZE (512u * 1024u)
#define HLS_AUDIO_QUEUE_SIZE (96u * 1024u)
#define HLS_PRODUCER_STACK_SIZE (256u * 1024u)
#define HLS_PLAYLIST_RETRY_US 250000u
#define HLS_PLAYLIST_FAILURE_LIMIT 24u

struct PlexHlsDemux {
  MultiplexAuthCredentials credentials;
  MultiplexPlexHlsSession session;
  MediaByteQueue *video;
  MediaByteQueue *audio;
  MpegTsParser parser;
  MultiplexPlexHlsState state;
  HlsMediaPlaylist prefetched_playlist;
  lwp_t producer_thread;
  void *producer_stack;
  bool started;
  uint32_t rating_key;
  uint32_t timeline_position_ms;
  uint32_t timeline_duration_ms;
  PlaybackTimelineState timeline_state;
  bool timeline_pending;
  mutex_t timeline_mutex;
  bool timeline_mutex_ready;
  bool has_prefetched_playlist;
};

static void lock_state(void *context) {
  mutex_t *mutex = context;
  LWP_MutexLock(*mutex);
}

static void unlock_state(void *context) {
  mutex_t *mutex = context;
  LWP_MutexUnlock(*mutex);
}

static bool queue_elementary(void *context, MpegTsStream stream,
                             const uint8_t *bytes, size_t size) {
  PlexHlsDemux *demux = context;
  if (demux == NULL || multiplex_plex_hls_state_is_stopping(&demux->state)) {
    return false;
  }
  MediaByteQueue *queue =
      stream == MPEG_TS_STREAM_VIDEO ? demux->video : demux->audio;
  if (!media_byte_queue_write(queue, bytes, size)) {
    return false;
  }
  if (stream == MPEG_TS_STREAM_VIDEO) {
    multiplex_plex_hls_state_add_bytes(&demux->state, (uint32_t)size, 0);
  } else {
    multiplex_plex_hls_state_add_bytes(&demux->state, 0, (uint32_t)size);
  }
  return true;
}

static bool parse_transport(void *context, const uint8_t *bytes, size_t size) {
  PlexHlsDemux *demux = context;
  if (multiplex_plex_hls_state_is_stopping(&demux->state)) {
    return false;
  }
  if (size == 0) {
    return true;
  }
  if (mpeg_ts_parser_push(&demux->parser, bytes, size)) {
    multiplex_plex_hls_state_publish_parser(
        &demux->state, mpeg_ts_parser_info(&demux->parser));
    return true;
  }
  /*
   * Stopping the session closes its elementary-stream queues. The parser
   * reports that rejected writer call as MPEG_TS_ERROR_OUTPUT, but it is the
   * expected result of a seek or shutdown rather than malformed transport.
   */
  if (multiplex_plex_hls_state_is_stopping(&demux->state)) {
    return false;
  }
  uint32_t packet_index = 0;
  uint16_t pid = MPEG_TS_NO_PID;
  const MpegTsError error =
      mpeg_ts_parser_error(&demux->parser, &packet_index, &pid);
  SYS_Report("REFERENCE GX: MPEG-TS rejected packet=%u pid=%u error=%u "
             "sync=%02x\n",
             packet_index, pid, error, demux->parser.pending[0]);
  return false;
}

static const HlsSegment *next_segment(const MultiplexPlexHlsSession *session,
                                      const HlsMediaPlaylist *playlist) {
  for (size_t index = 0; index < playlist->segment_count; ++index) {
    if (playlist->segments[index].sequence >= session->next_sequence) {
      return &playlist->segments[index];
    }
  }
  return NULL;
}

static void finish_queues(PlexHlsDemux *demux) {
  media_byte_queue_close(demux->video);
  media_byte_queue_close(demux->audio);
}

static const char *timeline_state_name(PlaybackTimelineState state) {
  switch (state) {
  case PLAYBACK_TIMELINE_STATE_STOPPED:
    return "stopped";
  case PLAYBACK_TIMELINE_STATE_PAUSED:
    return "paused";
  case PLAYBACK_TIMELINE_STATE_PLAYING:
    return "playing";
  }
  return NULL;
}

static bool timeline_state_valid(PlaybackTimelineState state) {
  switch (state) {
  case PLAYBACK_TIMELINE_STATE_STOPPED:
  case PLAYBACK_TIMELINE_STATE_PAUSED:
  case PLAYBACK_TIMELINE_STATE_PLAYING:
    return true;
  }
  return false;
}

static bool hls_http_cancelled(void *context) {
  return multiplex_plex_hls_state_is_stopping(context);
}

static void report_pending_timeline(PlexHlsDemux *demux) {
  if (!demux->timeline_mutex_ready) {
    return;
  }
  LWP_MutexLock(demux->timeline_mutex);
  const bool pending = demux->timeline_pending;
  const uint32_t position_ms = pending ? demux->timeline_position_ms : 0;
  const uint32_t duration_ms = pending ? demux->timeline_duration_ms : 0;
  const PlaybackTimelineState state = demux->timeline_state;
  demux->timeline_pending = false;
  LWP_MutexUnlock(demux->timeline_mutex);
  if (!pending) {
    return;
  }
  const char *state_name = timeline_state_name(state);
  if (state_name != NULL) {
    const MultiplexHttpCancellation cancellation = {
        .is_cancelled = hls_http_cancelled,
        .context = &demux->state,
    };
    multiplex_plex_report_timeline_cancellable(
        &demux->credentials, demux->session.session_id, demux->rating_key,
        position_ms, duration_ms, state_name, &cancellation);
  }
}

static void *run_hls_producer(void *context) {
  PlexHlsDemux *demux = context;
  const MultiplexHttpCancellation cancellation = {
      .is_cancelled = hls_http_cancelled,
      .context = &demux->state,
  };
  unsigned playlist_failures = 0;
  HlsMediaPlaylist playlist;
  bool has_playlist = demux->has_prefetched_playlist;
  if (has_playlist) {
    playlist = demux->prefetched_playlist;
    demux->has_prefetched_playlist = false;
    SYS_Report("REFERENCE GX: HLS reused prefetched playlist segments=%u "
               "first=%u\n",
               (unsigned)playlist.segment_count,
               playlist.segment_count == 0 ? 0u
                                           : playlist.segments[0].sequence);
  }
  while (!multiplex_plex_hls_state_is_stopping(&demux->state)) {
    if (!has_playlist) {
      if (!multiplex_plex_hls_refresh_cancellable(
              &demux->credentials, &demux->session, &playlist, &cancellation)) {
        if (++playlist_failures >= HLS_PLAYLIST_FAILURE_LIMIT) {
          SYS_Report("REFERENCE GX: Plex HLS playlist retry limit reached\n");
          multiplex_plex_hls_state_mark_failed(&demux->state);
          break;
        }
        usleep(HLS_PLAYLIST_RETRY_US);
        continue;
      }
      playlist_failures = 0;
      has_playlist = true;
    }
    const HlsSegment *segment = next_segment(&demux->session, &playlist);
    if (segment == NULL) {
      if (playlist.end_list) {
        if (mpeg_ts_parser_finish(&demux->parser)) {
          multiplex_plex_hls_state_mark_complete(&demux->state);
        } else {
          multiplex_plex_hls_state_mark_failed(&demux->state);
        }
        break;
      }
      has_playlist = false;
      usleep(HLS_PLAYLIST_RETRY_US);
      continue;
    }

    size_t transport_bytes = 0;
    if (!multiplex_plex_hls_stream_segment_cancellable(
            &demux->credentials, &demux->session, segment, parse_transport,
            demux, &cancellation, &transport_bytes)) {
      if (!multiplex_plex_hls_state_is_stopping(&demux->state)) {
        multiplex_plex_hls_state_mark_failed(&demux->state);
      }
      break;
    }
    demux->session.next_sequence = segment->sequence + 1u;
    multiplex_plex_hls_state_mark_segment(&demux->state);
    report_pending_timeline(demux);
  }
  finish_queues(demux);
  return NULL;
}

static PlexHlsDemux *
allocate_hls_demux(const MultiplexAuthCredentials *credentials,
                   uint32_t rating_key) {
  if (credentials == NULL || rating_key == 0) {
    return NULL;
  }
  PlexHlsDemux *demux = calloc(1, sizeof(*demux));
  if (demux == NULL) {
    return NULL;
  }
  demux->credentials = *credentials;
  demux->rating_key = rating_key;
  demux->producer_thread = LWP_THREAD_NULL;
  demux->timeline_mutex = LWP_MUTEX_NULL;
  if (LWP_MutexInit(&demux->timeline_mutex, false) != 0) {
    free(demux);
    return NULL;
  }
  demux->timeline_mutex_ready = true;
  multiplex_plex_hls_state_init(
      &demux->state,
      (MultiplexPlexHlsLockOps){.lock = lock_state,
                                .unlock = unlock_state,
                                .context = &demux->timeline_mutex});
  demux->video = media_byte_queue_create(HLS_VIDEO_QUEUE_SIZE);
  demux->audio = media_byte_queue_create(HLS_AUDIO_QUEUE_SIZE);
  if (demux->video == NULL || demux->audio == NULL) {
    plex_hls_demux_destroy(demux);
    return NULL;
  }
  mpeg_ts_parser_init(&demux->parser, queue_elementary, demux);
  return demux;
}

PlexHlsDemux *plex_hls_demux_create(const MultiplexAuthCredentials *credentials,
                                    uint32_t rating_key, uint32_t offset_ms,
                                    const char *session_id, bool burn_subtitles,
                                    uint32_t subtitle_stream_index) {
  if (rating_key == 0) {
    return NULL;
  }
  MultiplexPlexHlsSession session = {0};
  if (!multiplex_plex_hls_start(credentials, rating_key, offset_ms, session_id,
                                burn_subtitles, subtitle_stream_index,
                                &session)) {
    multiplex_plex_hls_stop(credentials, &session);
    return NULL;
  }
  PlexHlsDemux *demux = allocate_hls_demux(credentials, rating_key);
  if (demux == NULL) {
    multiplex_plex_hls_stop(credentials, &session);
    return NULL;
  }
  demux->session = session;
  return demux;
}

PlexHlsDemux *plex_hls_demux_create_prepared(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    const MultiplexPlexHlsSession *session, const HlsMediaPlaylist *playlist) {
  if (rating_key == 0 || session == NULL || playlist == NULL ||
      !session->started || playlist->segment_count == 0) {
    return NULL;
  }
  PlexHlsDemux *demux = allocate_hls_demux(credentials, rating_key);
  if (demux == NULL) {
    return NULL;
  }
  demux->session = *session;
  demux->prefetched_playlist = *playlist;
  demux->has_prefetched_playlist = true;
  return demux;
}

bool plex_hls_demux_start(PlexHlsDemux *demux) {
  if (demux == NULL || demux->started) {
    return false;
  }
  demux->producer_stack = malloc(HLS_PRODUCER_STACK_SIZE);
  if (demux->producer_stack == NULL ||
      LWP_CreateThread(&demux->producer_thread, run_hls_producer, demux,
                       demux->producer_stack, HLS_PRODUCER_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    free(demux->producer_stack);
    demux->producer_stack = NULL;
    return false;
  }
  demux->started = true;
  SYS_Report("REFERENCE GX: HLS queues video=%uKiB audio=%uKiB\n",
             HLS_VIDEO_QUEUE_SIZE / 1024u, HLS_AUDIO_QUEUE_SIZE / 1024u);
  return true;
}

bool plex_hls_demux_wait_ready(PlexHlsDemux *demux, size_t video_bytes,
                               size_t audio_bytes, uint32_t timeout_ms) {
  if (demux == NULL || !demux->started) {
    return false;
  }
  uint32_t waited_ms = 0;
  MultiplexPlexHlsSnapshot snapshot;
  while (waited_ms < timeout_ms) {
    multiplex_plex_hls_state_snapshot(&demux->state, &snapshot);
    if (snapshot.terminal != MULTIPLEX_PLEX_HLS_ACTIVE || snapshot.stopping) {
      break;
    }
    const MultiplexPlexHlsBuffers buffers = {
        .queued_video = media_byte_queue_size(demux->video),
        .queued_audio = media_byte_queue_size(demux->audio),
        .requested_video = video_bytes,
        .requested_audio = audio_bytes,
        .video_capacity = HLS_VIDEO_QUEUE_SIZE,
        .audio_capacity = HLS_AUDIO_QUEUE_SIZE,
    };
    /*
     * MPEG-TS does not promise a bounded byte ratio between elementary
     * streams. In particular, a seek can land before a long run of audio
     * packets. If either bounded queue fills while both streams already have
     * data, the producer cannot reach the other stream's requested prebuffer
     * until codec consumers start draining it.
     */
    const bool producer_backpressured =
        (buffers.queued_video == buffers.video_capacity &&
         buffers.queued_audio != 0) ||
        (buffers.queued_audio == buffers.audio_capacity &&
         buffers.queued_video != 0);
    if (multiplex_plex_hls_snapshot_ready(&snapshot, &buffers)) {
      SYS_Report("REFERENCE GX: HLS ready video=%u audio=%u video-pts=%lld "
                 "audio-pts=%lld backpressured=%u\n",
                 (unsigned)buffers.queued_video, (unsigned)buffers.queued_audio,
                 snapshot.parser_info.first_video_pts90k,
                 snapshot.parser_info.first_audio_pts90k,
                 producer_backpressured ? 1u : 0u);
      return true;
    }
    usleep(10000);
    waited_ms += 10u;
  }
  multiplex_plex_hls_state_snapshot(&demux->state, &snapshot);
  SYS_Report(
      "REFERENCE GX: HLS readiness failed waited=%u video=%u/%u "
      "audio=%u/%u pids=%u/%u pts=%lld/%lld failed=%u complete=%u "
      "stopping=%u\n",
      waited_ms, (unsigned)media_byte_queue_size(demux->video),
      (unsigned)video_bytes, (unsigned)media_byte_queue_size(demux->audio),
      (unsigned)audio_bytes, snapshot.parser_info.video_pid,
      snapshot.parser_info.audio_pid, snapshot.parser_info.first_video_pts90k,
      snapshot.parser_info.first_audio_pts90k,
      snapshot.terminal == MULTIPLEX_PLEX_HLS_FAILED ? 1u : 0u,
      snapshot.terminal == MULTIPLEX_PLEX_HLS_COMPLETE ? 1u : 0u,
      snapshot.stopping ? 1u : 0u);
  return false;
}

void plex_hls_demux_request_stop(PlexHlsDemux *demux) {
  if (demux == NULL) {
    return;
  }
  if (multiplex_plex_hls_state_request_stop(&demux->state)) {
    finish_queues(demux);
  }
}

void plex_hls_demux_stop(PlexHlsDemux *demux) {
  if (demux == NULL) {
    return;
  }
  plex_hls_demux_request_stop(demux);
  if (demux->producer_thread != LWP_THREAD_NULL) {
    LWP_JoinThread(demux->producer_thread, NULL);
    demux->producer_thread = LWP_THREAD_NULL;
  }
  multiplex_plex_hls_stop(&demux->credentials, &demux->session);
}

void plex_hls_demux_destroy(PlexHlsDemux *demux) {
  if (demux == NULL) {
    return;
  }
  plex_hls_demux_stop(demux);
  media_byte_queue_destroy(demux->audio);
  media_byte_queue_destroy(demux->video);
  if (demux->timeline_mutex_ready) {
    LWP_MutexDestroy(demux->timeline_mutex);
  }
  free(demux->producer_stack);
  free(demux);
}

size_t plex_hls_demux_read_video(void *context, uint8_t *destination,
                                 size_t size) {
  PlexHlsDemux *demux = context;
  return demux == NULL ? 0
                       : media_byte_queue_read(demux->video, destination, size);
}

size_t plex_hls_demux_read_audio(void *context, uint8_t *destination,
                                 size_t size) {
  PlexHlsDemux *demux = context;
  return demux == NULL ? 0
                       : media_byte_queue_read(demux->audio, destination, size);
}

unsigned plex_hls_demux_width(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->session.variant.width;
}

unsigned plex_hls_demux_height(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->session.variant.height;
}

uint32_t plex_hls_demux_frame_rate_millihertz(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->session.variant.frame_rate_millihertz;
}

static MultiplexPlexHlsSnapshot state_snapshot(const PlexHlsDemux *demux) {
  MultiplexPlexHlsSnapshot snapshot;
  multiplex_plex_hls_state_snapshot(&demux->state, &snapshot);
  return snapshot;
}

int64_t plex_hls_demux_first_video_pts90k(const PlexHlsDemux *demux) {
  return demux == NULL ? MPEG_TS_NO_PTS
                       : state_snapshot(demux).parser_info.first_video_pts90k;
}

int64_t plex_hls_demux_first_audio_pts90k(const PlexHlsDemux *demux) {
  return demux == NULL ? MPEG_TS_NO_PTS
                       : state_snapshot(demux).parser_info.first_audio_pts90k;
}

uint32_t plex_hls_demux_segment_count(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : state_snapshot(demux).segment_count;
}

uint32_t plex_hls_demux_video_bytes(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : state_snapshot(demux).video_bytes;
}

uint32_t plex_hls_demux_audio_bytes(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : state_snapshot(demux).audio_bytes;
}

size_t plex_hls_demux_queued_video_bytes(PlexHlsDemux *demux) {
  return demux == NULL ? 0 : media_byte_queue_size(demux->video);
}

size_t plex_hls_demux_queued_audio_bytes(PlexHlsDemux *demux) {
  return demux == NULL ? 0 : media_byte_queue_size(demux->audio);
}

bool plex_hls_demux_failed(const PlexHlsDemux *demux) {
  return demux == NULL ||
         state_snapshot(demux).terminal == MULTIPLEX_PLEX_HLS_FAILED;
}

bool plex_hls_demux_complete(const PlexHlsDemux *demux) {
  return demux != NULL &&
         state_snapshot(demux).terminal == MULTIPLEX_PLEX_HLS_COMPLETE;
}

const char *plex_hls_demux_session_id(const PlexHlsDemux *demux) {
  return demux == NULL ? NULL : demux->session.session_id;
}

bool plex_hls_demux_report_timeline_now(PlexHlsDemux *demux,
                                        uint32_t position_ms,
                                        uint32_t duration_ms,
                                        PlaybackTimelineState state) {
  const char *state_name = timeline_state_name(state);
  return demux != NULL && state_name != NULL &&
         multiplex_plex_report_timeline(
             &demux->credentials, demux->session.session_id, demux->rating_key,
             position_ms, duration_ms, state_name);
}

bool plex_hls_demux_request_timeline(PlexHlsDemux *demux, uint32_t position_ms,
                                     uint32_t duration_ms,
                                     PlaybackTimelineState state) {
  if (demux == NULL || duration_ms == 0 || !demux->timeline_mutex_ready ||
      !timeline_state_valid(state)) {
    return false;
  }
  LWP_MutexLock(demux->timeline_mutex);
  demux->timeline_position_ms = position_ms;
  demux->timeline_duration_ms = duration_ms;
  demux->timeline_state = state;
  demux->timeline_pending = true;
  LWP_MutexUnlock(demux->timeline_mutex);
  return true;
}
