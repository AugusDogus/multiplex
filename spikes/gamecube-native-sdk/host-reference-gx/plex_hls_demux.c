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
#include "plex_hls.h"

#include <gccore.h>
#include <ogc/lwp.h>
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
  lwp_t producer_thread;
  void *producer_stack;
  volatile bool started;
  volatile bool stopping;
  volatile bool failed;
  volatile bool complete;
  volatile uint32_t segment_count;
  volatile uint32_t video_bytes;
  volatile uint32_t audio_bytes;
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

static bool parse_transport(void *context, const uint8_t *bytes,
                            size_t size) {
  PlexHlsDemux *demux = context;
  if (demux->stopping) {
    return false;
  }
  if (mpeg_ts_parser_push(&demux->parser, bytes, size)) {
    return true;
  }
  uint32_t packet_index = 0;
  uint16_t pid = MPEG_TS_NO_PID;
  const MpegTsError error =
      mpeg_ts_parser_error(&demux->parser, &packet_index, &pid);
  SYS_Report(
      "REFERENCE GX: MPEG-TS rejected packet=%u pid=%u error=%u "
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

static void *run_hls_producer(void *context) {
  PlexHlsDemux *demux = context;
  unsigned playlist_failures = 0;
  while (!demux->stopping) {
    HlsMediaPlaylist playlist;
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
    const HlsSegment *segment = next_segment(&demux->session, &playlist);
    if (segment == NULL) {
      if (playlist.end_list) {
        demux->complete = mpeg_ts_parser_finish(&demux->parser);
        demux->failed = !demux->complete;
        break;
      }
      usleep(HLS_PLAYLIST_RETRY_US);
      continue;
    }

    size_t transport_bytes = 0;
    if (!multiplex_plex_hls_stream_segment(
            demux->credentials, &demux->session, segment, parse_transport,
            demux, &transport_bytes)) {
      if (!demux->stopping) {
        demux->failed = true;
      }
      break;
    }
    demux->session.next_sequence = segment->sequence + 1u;
    demux->segment_count += 1u;
  }
  finish_queues(demux);
  return NULL;
}

PlexHlsDemux *plex_hls_demux_create(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    uint32_t offset_ms) {
  if (credentials == NULL || rating_key == 0) {
    return NULL;
  }
  PlexHlsDemux *demux = calloc(1, sizeof(*demux));
  if (demux == NULL) {
    return NULL;
  }
  demux->credentials = credentials;
  demux->producer_thread = LWP_THREAD_NULL;
  demux->video = media_byte_queue_create(HLS_VIDEO_QUEUE_SIZE);
  demux->audio = media_byte_queue_create(HLS_AUDIO_QUEUE_SIZE);
  if (demux->video == NULL || demux->audio == NULL ||
      !multiplex_plex_hls_start(credentials, rating_key, offset_ms,
                                &demux->session)) {
    plex_hls_demux_destroy(demux);
    return NULL;
  }
  mpeg_ts_parser_init(&demux->parser, queue_elementary, demux);
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
    if (info->video_pid != MPEG_TS_NO_PID &&
        info->audio_pid != MPEG_TS_NO_PID &&
        info->first_video_pts90k != MPEG_TS_NO_PTS &&
        info->first_audio_pts90k != MPEG_TS_NO_PTS &&
        media_byte_queue_size(demux->video) >= video_bytes &&
        media_byte_queue_size(demux->audio) >= audio_bytes) {
      SYS_Report(
          "REFERENCE GX: HLS ready video=%u audio=%u video-pts=%lld "
          "audio-pts=%lld\n",
          (unsigned)media_byte_queue_size(demux->video),
          (unsigned)media_byte_queue_size(demux->audio),
          info->first_video_pts90k, info->first_audio_pts90k);
      return true;
    }
    usleep(10000);
    waited_ms += 10u;
  }
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
  free(demux->producer_stack);
  free(demux);
}

size_t plex_hls_demux_read_video(void *context, uint8_t *destination,
                                 size_t size) {
  PlexHlsDemux *demux = context;
  return demux == NULL
             ? 0
             : media_byte_queue_read(demux->video, destination, size);
}

size_t plex_hls_demux_read_audio(void *context, uint8_t *destination,
                                 size_t size) {
  PlexHlsDemux *demux = context;
  return demux == NULL
             ? 0
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

bool plex_hls_demux_failed(const PlexHlsDemux *demux) {
  return demux == NULL || demux->failed;
}

bool plex_hls_demux_complete(const PlexHlsDemux *demux) {
  return demux != NULL && demux->complete;
}
