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

#include <gccore.h>
#include <ogc/lwp.h>
#include <ogc/mutex.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define HLS_VIDEO_QUEUE_SIZE (512u * 1024u)
#define HLS_AUDIO_QUEUE_SIZE (96u * 1024u)
#define HLS_PRODUCER_STACK_SIZE (256u * 1024u)
#define HLS_PLAYLIST_RETRY_US 250000u
#define HLS_PLAYLIST_FAILURE_LIMIT 24u

struct PlexHlsDemux {
  const MultiplexAuthCredentials *credentials;
  MultiplexPlexHlsSession session;
  MediaByteQueue *video;
  MediaByteQueue *audio;
  MpegTsParser parser;
  HlsMediaPlaylist prefetched_playlist;
  lwp_t producer_thread;
  void *producer_stack;
  volatile bool started;
  volatile bool stopping;
  volatile bool failed;
  volatile bool complete;
  volatile uint32_t segment_count;
  volatile uint32_t video_bytes;
  volatile uint32_t audio_bytes;
  uint32_t rating_key;
  uint32_t timeline_position_ms;
  uint32_t timeline_duration_ms;
  uint8_t timeline_state;
  bool timeline_pending;
  mutex_t timeline_mutex;
  bool timeline_mutex_ready;
  bool initial_timeline_reported;
  bool has_prefetched_playlist;
};

enum {
  HLS_TIMELINE_PLAYING = 1,
  HLS_TIMELINE_PAUSED = 2,
};

static bool queue_elementary(void *context, MpegTsStream stream,
                             const uint8_t *bytes, size_t size) {
  PlexHlsDemux *demux = context;
  if (demux == NULL || demux->stopping) {
    return false;
  }
  MediaByteQueue *queue =
      stream == MPEG_TS_STREAM_VIDEO ? demux->video : demux->audio;
  if (!media_byte_queue_write(queue, bytes, size)) {
    return false;
  }
  if (stream == MPEG_TS_STREAM_VIDEO) {
    demux->video_bytes += (uint32_t)size;
  } else {
    demux->audio_bytes += (uint32_t)size;
  }
  return true;
}

static bool parse_transport(void *context, const uint8_t *bytes, size_t size) {
  PlexHlsDemux *demux = context;
  if (demux->stopping) {
    return false;
  }
  if (size == 0) {
    return true;
  }
  if (mpeg_ts_parser_push(&demux->parser, bytes, size)) {
    return true;
  }
  /*
   * Stopping the session closes its elementary-stream queues. The parser
   * reports that rejected writer call as MPEG_TS_ERROR_OUTPUT, but it is the
   * expected result of a seek or shutdown rather than malformed transport.
   */
  if (demux->stopping) {
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

static void report_pending_timeline(PlexHlsDemux *demux) {
  if (!demux->timeline_mutex_ready) {
    return;
  }
  LWP_MutexLock(demux->timeline_mutex);
  const bool pending = demux->timeline_pending;
  const uint32_t position_ms = pending ? demux->timeline_position_ms : 0;
  const uint32_t duration_ms = pending ? demux->timeline_duration_ms : 0;
  const uint8_t state = pending ? demux->timeline_state : 0;
  demux->timeline_pending = false;
  LWP_MutexUnlock(demux->timeline_mutex);
  if (!pending) {
    return;
  }
  multiplex_plex_report_timeline(demux->credentials, demux->session.session_id,
                                 demux->rating_key, position_ms, duration_ms,
                                 state == HLS_TIMELINE_PAUSED ? "paused"
                                                              : "playing");
}

static void *run_hls_producer(void *context) {
  PlexHlsDemux *demux = context;
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
  while (!demux->stopping) {
    if (!has_playlist) {
      if (!multiplex_plex_hls_refresh(demux->credentials, &demux->session,
                                      &playlist)) {
        if (++playlist_failures >= HLS_PLAYLIST_FAILURE_LIMIT) {
          SYS_Report("REFERENCE GX: Plex HLS playlist retry limit reached\n");
          demux->failed = true;
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
        demux->complete = mpeg_ts_parser_finish(&demux->parser);
        demux->failed = !demux->complete;
        break;
      }
      has_playlist = false;
      usleep(HLS_PLAYLIST_RETRY_US);
      continue;
    }

    size_t transport_bytes = 0;
    if (!multiplex_plex_hls_stream_segment(
            demux->credentials, &demux->session, segment, parse_transport,
            demux, &demux->stopping, &transport_bytes)) {
      if (!demux->stopping) {
        demux->failed = true;
      }
      break;
    }
    demux->session.next_sequence = segment->sequence + 1u;
    demux->segment_count += 1u;
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
  demux->credentials = credentials;
  demux->rating_key = rating_key;
  demux->producer_thread = LWP_THREAD_NULL;
  demux->timeline_mutex = LWP_MUTEX_NULL;
  if (LWP_MutexInit(&demux->timeline_mutex, false) != 0) {
    free(demux);
    return NULL;
  }
  demux->timeline_mutex_ready = true;
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
                                    uint32_t duration_ms,
                                    const char *session_id, bool burn_subtitles,
                                    uint32_t subtitle_stream_index) {
  if (rating_key == 0 || duration_ms == 0) {
    return NULL;
  }
  MultiplexPlexHlsSession session;
  if (!multiplex_plex_hls_start(credentials, rating_key, offset_ms, session_id,
                                burn_subtitles, subtitle_stream_index,
                                &session)) {
    return NULL;
  }
  const bool initial_timeline_reported = multiplex_plex_report_timeline(
      credentials, session.session_id, rating_key, offset_ms, duration_ms,
      "playing");
  PlexHlsDemux *demux = allocate_hls_demux(credentials, rating_key);
  if (demux == NULL) {
    multiplex_plex_hls_stop(credentials, &session);
    return NULL;
  }
  demux->session = session;
  demux->initial_timeline_reported = initial_timeline_reported;
  return demux;
}

PlexHlsDemux *
plex_hls_demux_create_prepared(const MultiplexAuthCredentials *credentials,
                               uint32_t rating_key, uint32_t duration_ms,
                               const MultiplexPlexHlsSession *session,
                               const HlsMediaPlaylist *playlist) {
  if (rating_key == 0 || duration_ms == 0 || session == NULL ||
      playlist == NULL || !session->started || playlist->segment_count == 0) {
    return NULL;
  }
  const bool initial_timeline_reported = multiplex_plex_report_timeline(
      credentials, session->session_id, rating_key, session->start_offset_ms,
      duration_ms, "playing");
  PlexHlsDemux *demux = allocate_hls_demux(credentials, rating_key);
  if (demux == NULL) {
    return NULL;
  }
  demux->session = *session;
  demux->initial_timeline_reported = initial_timeline_reported;
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
  while (!demux->failed && !demux->complete && !demux->stopping &&
         waited_ms < timeout_ms) {
    const MpegTsInfo *info = mpeg_ts_parser_info(&demux->parser);
    const size_t queued_video = media_byte_queue_size(demux->video);
    const size_t queued_audio = media_byte_queue_size(demux->audio);
    const bool requested_prebuffer =
        queued_video >= video_bytes && queued_audio >= audio_bytes;
    /*
     * MPEG-TS does not promise a bounded byte ratio between elementary
     * streams. In particular, a seek can land before a long run of audio
     * packets. If either bounded queue fills while both streams already have
     * data, the producer cannot reach the other stream's requested prebuffer
     * until codec consumers start draining it.
     */
    const bool producer_backpressured =
        (queued_video == HLS_VIDEO_QUEUE_SIZE && queued_audio != 0) ||
        (queued_audio == HLS_AUDIO_QUEUE_SIZE && queued_video != 0);
    if (info->video_pid != MPEG_TS_NO_PID &&
        info->audio_pid != MPEG_TS_NO_PID &&
        info->first_video_pts90k != MPEG_TS_NO_PTS &&
        info->first_audio_pts90k != MPEG_TS_NO_PTS &&
        (requested_prebuffer || producer_backpressured)) {
      SYS_Report("REFERENCE GX: HLS ready video=%u audio=%u video-pts=%lld "
                 "audio-pts=%lld backpressured=%u\n",
                 (unsigned)queued_video, (unsigned)queued_audio,
                 info->first_video_pts90k, info->first_audio_pts90k,
                 producer_backpressured ? 1u : 0u);
      return true;
    }
    usleep(10000);
    waited_ms += 10u;
  }
  const MpegTsInfo *info = mpeg_ts_parser_info(&demux->parser);
  SYS_Report("REFERENCE GX: HLS readiness failed waited=%u video=%u/%u "
             "audio=%u/%u pids=%u/%u pts=%lld/%lld failed=%u complete=%u "
             "stopping=%u\n",
             waited_ms, (unsigned)media_byte_queue_size(demux->video),
             (unsigned)video_bytes,
             (unsigned)media_byte_queue_size(demux->audio),
             (unsigned)audio_bytes, info->video_pid, info->audio_pid,
             info->first_video_pts90k, info->first_audio_pts90k,
             demux->failed ? 1u : 0u, demux->complete ? 1u : 0u,
             demux->stopping ? 1u : 0u);
  return false;
}

void plex_hls_demux_stop(PlexHlsDemux *demux) {
  if (demux == NULL || demux->stopping) {
    return;
  }
  demux->stopping = true;
  finish_queues(demux);
  if (demux->producer_thread != LWP_THREAD_NULL) {
    LWP_JoinThread(demux->producer_thread, NULL);
    demux->producer_thread = LWP_THREAD_NULL;
  }
  multiplex_plex_hls_stop(demux->credentials, &demux->session);
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

int64_t plex_hls_demux_first_video_pts90k(const PlexHlsDemux *demux) {
  return demux == NULL
             ? MPEG_TS_NO_PTS
             : mpeg_ts_parser_info(&demux->parser)->first_video_pts90k;
}

int64_t plex_hls_demux_first_audio_pts90k(const PlexHlsDemux *demux) {
  return demux == NULL
             ? MPEG_TS_NO_PTS
             : mpeg_ts_parser_info(&demux->parser)->first_audio_pts90k;
}

uint32_t plex_hls_demux_segment_count(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->segment_count;
}

uint32_t plex_hls_demux_video_bytes(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->video_bytes;
}

uint32_t plex_hls_demux_audio_bytes(const PlexHlsDemux *demux) {
  return demux == NULL ? 0 : demux->audio_bytes;
}

size_t plex_hls_demux_queued_video_bytes(PlexHlsDemux *demux) {
  return demux == NULL ? 0 : media_byte_queue_size(demux->video);
}

size_t plex_hls_demux_queued_audio_bytes(PlexHlsDemux *demux) {
  return demux == NULL ? 0 : media_byte_queue_size(demux->audio);
}

bool plex_hls_demux_failed(const PlexHlsDemux *demux) {
  return demux == NULL || demux->failed;
}

bool plex_hls_demux_complete(const PlexHlsDemux *demux) {
  return demux != NULL && demux->complete;
}

const char *plex_hls_demux_session_id(const PlexHlsDemux *demux) {
  return demux == NULL ? NULL : demux->session.session_id;
}

bool plex_hls_demux_initial_timeline_reported(const PlexHlsDemux *demux) {
  return demux != NULL && demux->initial_timeline_reported;
}

bool plex_hls_demux_report_timeline_now(PlexHlsDemux *demux,
                                        uint32_t position_ms,
                                        uint32_t duration_ms,
                                        const char *state) {
  return demux != NULL &&
         multiplex_plex_report_timeline(
             demux->credentials, demux->session.session_id, demux->rating_key,
             position_ms, duration_ms, state);
}

bool plex_hls_demux_request_timeline(PlexHlsDemux *demux, uint32_t position_ms,
                                     uint32_t duration_ms, const char *state) {
  if (demux == NULL || duration_ms == 0 || state == NULL ||
      !demux->timeline_mutex_ready ||
      (strcmp(state, "playing") != 0 && strcmp(state, "paused") != 0)) {
    return false;
  }
  LWP_MutexLock(demux->timeline_mutex);
  demux->timeline_position_ms = position_ms;
  demux->timeline_duration_ms = duration_ms;
  demux->timeline_state =
      strcmp(state, "paused") == 0 ? HLS_TIMELINE_PAUSED : HLS_TIMELINE_PLAYING;
  demux->timeline_pending = true;
  LWP_MutexUnlock(demux->timeline_mutex);
  return true;
}
