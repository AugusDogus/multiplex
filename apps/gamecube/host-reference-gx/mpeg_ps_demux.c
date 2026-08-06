/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Narrow MPEG-2 Program Stream demuxer for the GameCube media pipeline. The
 * parser operates on a seekable reader, so HTTP containers do not need a
 * whole-file buffer. The app LWP cooperatively walks selected PES packets and
 * feeds bounded audio/video queues consumed by the codec threads.
 */

#include "mpeg_ps_demux.h"
#include "media_byte_queue.h"

#include <gccore.h>
#include <ogc/lwp.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MPEG_START_CODE_PREFIX 0x000001u
#define MPEG_PACK_HEADER 0xbau
#define MPEG_PROGRAM_END 0xb9u
#define MPEG_NO_STREAM 0xffu
#define MPEG_NO_PTS (-1)
#define PROGRAM_CACHE_SIZE 1024u
#define VIDEO_QUEUE_SIZE (320 * 1024u)
#define AUDIO_QUEUE_SIZE (64 * 1024u)
#define PRODUCER_STACK_SIZE (128 * 1024u)

typedef struct {
  void *context;
  size_t size;
  MpegPsReadAt read_at;
  uint8_t cache[PROGRAM_CACHE_SIZE];
  size_t cache_start;
  size_t cache_size;
  bool cache_valid;
} ProgramReader;

typedef struct {
  uint8_t stream_id;
  size_t payload_offset;
  size_t payload_size;
  bool has_pts;
  int64_t pts90k;
} PesPacket;

typedef struct {
  uint8_t video_stream_id;
  uint8_t audio_stream_id;
  size_t video_size;
  size_t audio_size;
  uint32_t video_packets;
  uint32_t audio_packets;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
} ProgramScan;

struct MpegPsDemux {
  ProgramReader reader;
  ProgramScan scan;
  MediaByteQueue *video;
  MediaByteQueue *audio;
  bool started;
  volatile bool stopped;
  volatile bool failed;
  lwp_t producer_thread;
  void *producer_stack;
  size_t program_offset;
  PesPacket pending_packet;
  size_t pending_offset;
  bool has_pending_packet;
  volatile uint32_t loops;
  volatile uint32_t video_bytes_pumped;
  volatile uint32_t audio_bytes_pumped;
};

static void *run_producer(void *context);

static bool memory_read_at(void *context, size_t offset, uint8_t *destination,
                           size_t size) {
  const uint8_t *memory = context;
  if (memory == NULL || destination == NULL) {
    return false;
  }
  memcpy(destination, memory + offset, size);
  return true;
}

static bool reader_fill_cache(ProgramReader *reader, size_t offset) {
  if (offset >= reader->size) {
    return false;
  }
  const size_t start = offset - offset % PROGRAM_CACHE_SIZE;
  const size_t remaining = reader->size - start;
  const size_t size =
      remaining < PROGRAM_CACHE_SIZE ? remaining : PROGRAM_CACHE_SIZE;
  if (!reader->read_at(reader->context, start, reader->cache, size)) {
    return false;
  }
  reader->cache_start = start;
  reader->cache_size = size;
  reader->cache_valid = true;
  return true;
}

static bool reader_read(ProgramReader *reader, size_t offset,
                        uint8_t *destination, size_t size) {
  if (destination == NULL || offset > reader->size ||
      size > reader->size - offset) {
    return false;
  }

  size_t copied = 0;
  while (copied < size) {
    const size_t position = offset + copied;
    if (!reader->cache_valid || position < reader->cache_start ||
        position >= reader->cache_start + reader->cache_size) {
      if (!reader_fill_cache(reader, position)) {
        return false;
      }
    }
    const size_t cache_offset = position - reader->cache_start;
    const size_t available = reader->cache_size - cache_offset;
    const size_t remaining = size - copied;
    const size_t chunk = available < remaining ? available : remaining;
    memcpy(destination + copied, reader->cache + cache_offset, chunk);
    copied += chunk;
  }
  return true;
}

static bool reader_byte(ProgramReader *reader, size_t offset, uint8_t *value) {
  return reader_read(reader, offset, value, 1);
}

static bool reader_be16(ProgramReader *reader, size_t offset, uint16_t *value) {
  uint8_t bytes[2];
  if (!reader_read(reader, offset, bytes, sizeof(bytes))) {
    return false;
  }
  *value = (uint16_t)((uint16_t)bytes[0] << 8 | bytes[1]);
  return true;
}

static bool read_pts90k(const uint8_t *bytes, int64_t *pts90k) {
  if ((bytes[0] & 1u) == 0 || (bytes[2] & 1u) == 0 || (bytes[4] & 1u) == 0) {
    return false;
  }
  *pts90k =
      (int64_t)((uint64_t)((bytes[0] >> 1) & 7u) << 30 |
                (uint64_t)bytes[1] << 22 | (uint64_t)(bytes[2] >> 1) << 15 |
                (uint64_t)bytes[3] << 7 | (uint64_t)(bytes[4] >> 1));
  return true;
}

static bool parse_pes_packet(ProgramReader *reader, size_t start,
                             size_t packet_size, uint8_t stream_id,
                             PesPacket *pes) {
  if (packet_size < 9) {
    return false;
  }

  uint8_t header[9];
  if (!reader_read(reader, start, header, sizeof(header))) {
    return false;
  }
  size_t payload_offset = start + 6u;
  bool has_pts = false;
  int64_t pts90k = MPEG_NO_PTS;

  if ((header[6] & 0xc0u) == 0x80u) {
    const size_t optional_size = header[8];
    payload_offset = start + 9u + optional_size;
    if (payload_offset > start + packet_size) {
      return false;
    }
    if ((header[7] & 0x80u) != 0) {
      uint8_t pts[5];
      if (optional_size < sizeof(pts) ||
          !reader_read(reader, start + 9u, pts, sizeof(pts)) ||
          !read_pts90k(pts, &pts90k)) {
        return false;
      }
      has_pts = true;
    }
  } else {
    while (payload_offset < start + packet_size) {
      uint8_t value = 0;
      if (!reader_byte(reader, payload_offset, &value)) {
        return false;
      }
      if (value != 0xffu) {
        break;
      }
      payload_offset += 1;
    }
    uint8_t marker = 0;
    if (!reader_byte(reader, payload_offset, &marker)) {
      return false;
    }
    if ((marker & 0xc0u) == 0x40u) {
      payload_offset += 2;
      if (!reader_byte(reader, payload_offset, &marker)) {
        return false;
      }
    }
    const uint8_t timestamp_prefix = marker & 0xf0u;
    if (timestamp_prefix == 0x20u || timestamp_prefix == 0x30u) {
      uint8_t pts[5];
      if (!reader_read(reader, payload_offset, pts, sizeof(pts)) ||
          !read_pts90k(pts, &pts90k)) {
        return false;
      }
      has_pts = true;
      payload_offset += timestamp_prefix == 0x30u ? 10u : 5u;
    } else if (marker == 0x0fu) {
      payload_offset += 1;
    } else {
      return false;
    }
    if (payload_offset > start + packet_size) {
      return false;
    }
  }

  pes->stream_id = stream_id;
  pes->payload_offset = payload_offset;
  pes->payload_size = start + packet_size - payload_offset;
  pes->has_pts = has_pts;
  pes->pts90k = pts90k;
  return true;
}

static bool find_start_code(ProgramReader *reader, size_t *offset) {
  while (*offset + 4u <= reader->size) {
    uint8_t bytes[3];
    if (!reader_read(reader, *offset, bytes, sizeof(bytes))) {
      return false;
    }
    const uint32_t prefix =
        (uint32_t)bytes[0] << 16 | (uint32_t)bytes[1] << 8 | bytes[2];
    if (prefix == MPEG_START_CODE_PREFIX) {
      return true;
    }
    *offset += 1;
  }
  return false;
}

static bool next_pes_packet(ProgramReader *reader, size_t *offset,
                            PesPacket *pes, bool *finished) {
  *finished = false;
  while (find_start_code(reader, offset)) {
    const size_t start = *offset;
    uint8_t stream_id = 0;
    if (!reader_byte(reader, start + 3u, &stream_id)) {
      return false;
    }

    if (stream_id == MPEG_PROGRAM_END) {
      *offset = start + 4u;
      *finished = true;
      return true;
    }
    if (stream_id == MPEG_PACK_HEADER) {
      uint8_t header[14];
      const size_t available = reader->size - start;
      const size_t header_size =
          available < sizeof(header) ? available : sizeof(header);
      if (header_size < 12 ||
          !reader_read(reader, start, header, header_size)) {
        return false;
      }
      if ((header[4] & 0xc0u) == 0x40u) {
        if (header_size < 14) {
          return false;
        }
        *offset = start + 14u + (header[13] & 7u);
      } else if ((header[4] & 0xf0u) == 0x20u) {
        *offset = start + 12u;
      } else {
        return false;
      }
      if (*offset > reader->size) {
        return false;
      }
      continue;
    }
    if (start + 6u > reader->size) {
      return false;
    }

    uint16_t declared_size = 0;
    if (!reader_be16(reader, start + 4u, &declared_size)) {
      return false;
    }
    const size_t packet_size = 6u + declared_size;
    if (packet_size == 6u || packet_size > reader->size - start) {
      return false;
    }
    *offset = start + packet_size;

    const bool is_video = stream_id >= 0xe0u && stream_id <= 0xefu;
    const bool is_audio = stream_id >= 0xc0u && stream_id <= 0xdfu;
    if (!is_video && !is_audio) {
      continue;
    }
    return parse_pes_packet(reader, start, packet_size, stream_id, pes);
  }

  *finished = true;
  return *offset == reader->size;
}

static bool add_payload_size(size_t *total, size_t payload_size) {
  if (payload_size > SIZE_MAX - *total) {
    return false;
  }
  *total += payload_size;
  return true;
}

static bool scan_program(ProgramReader *reader, ProgramScan *scan) {
  size_t offset = 0;
  bool finished = false;
  while (!finished) {
    PesPacket pes;
    if (!next_pes_packet(reader, &offset, &pes, &finished)) {
      return false;
    }
    if (finished) {
      break;
    }

    const bool is_video = pes.stream_id >= 0xe0u;
    uint8_t *selected_id =
        is_video ? &scan->video_stream_id : &scan->audio_stream_id;
    size_t *total = is_video ? &scan->video_size : &scan->audio_size;
    uint32_t *packets = is_video ? &scan->video_packets : &scan->audio_packets;
    int64_t *first_pts =
        is_video ? &scan->first_video_pts90k : &scan->first_audio_pts90k;

    if (*selected_id == MPEG_NO_STREAM) {
      *selected_id = pes.stream_id;
    }
    if (pes.stream_id != *selected_id) {
      continue;
    }
    if (!add_payload_size(total, pes.payload_size)) {
      return false;
    }
    *packets += 1;
    if (*first_pts == MPEG_NO_PTS && pes.has_pts) {
      *first_pts = pes.pts90k;
    }
  }

  return scan->video_stream_id != MPEG_NO_STREAM &&
         scan->audio_stream_id != MPEG_NO_STREAM && scan->video_size != 0 &&
         scan->audio_size != 0 && scan->first_video_pts90k != MPEG_NO_PTS &&
         scan->first_audio_pts90k != MPEG_NO_PTS;
}

static MpegPsDemux *create_reader(void *context, size_t program_size,
                                  MpegPsReadAt read_at,
                                  const ProgramScan *known_scan) {
  if (context == NULL || read_at == NULL || program_size < 16 ||
      (known_scan != NULL &&
       (known_scan->video_stream_id < 0xe0u ||
        known_scan->video_stream_id > 0xefu ||
        known_scan->audio_stream_id < 0xc0u ||
        known_scan->audio_stream_id > 0xdfu || known_scan->video_size == 0 ||
        known_scan->audio_size == 0 ||
        known_scan->first_video_pts90k == MPEG_NO_PTS ||
        known_scan->first_audio_pts90k == MPEG_NO_PTS))) {
    return NULL;
  }
  ProgramReader reader = {
      .context = context,
      .size = program_size,
      .read_at = read_at,
  };
  ProgramScan scan;
  if (known_scan != NULL) {
    scan = *known_scan;
  } else {
    memset(&scan, 0, sizeof(scan));
    scan.video_stream_id = MPEG_NO_STREAM;
    scan.audio_stream_id = MPEG_NO_STREAM;
    scan.first_video_pts90k = MPEG_NO_PTS;
    scan.first_audio_pts90k = MPEG_NO_PTS;
    if (!scan_program(&reader, &scan)) {
      SYS_Report("REFERENCE GX: MPEG-PS demux scan failed\n");
      return NULL;
    }
  }

  MpegPsDemux *demux = calloc(1, sizeof(*demux));
  if (demux == NULL) {
    return NULL;
  }
  demux->reader = reader;
  demux->scan = scan;
  demux->video = media_byte_queue_create(VIDEO_QUEUE_SIZE);
  demux->audio = media_byte_queue_create(AUDIO_QUEUE_SIZE);
  if (demux->video == NULL || demux->audio == NULL) {
    SYS_Report("REFERENCE GX: MPEG-PS queue allocation failed\n");
    mpeg_ps_demux_destroy(demux);
    return NULL;
  }

  SYS_Report(
      "REFERENCE GX: demux=mpeg-ps video=%02x packets=%u bytes=%u pts=%lld "
      "audio=%02x packets=%u bytes=%u pts=%lld pts-delta=%lld\n",
      scan.video_stream_id, scan.video_packets, (unsigned)scan.video_size,
      scan.first_video_pts90k, scan.audio_stream_id, scan.audio_packets,
      (unsigned)scan.audio_size, scan.first_audio_pts90k,
      scan.first_video_pts90k - scan.first_audio_pts90k);
  return demux;
}

MpegPsDemux *mpeg_ps_demux_create_reader(void *context, size_t program_size,
                                         MpegPsReadAt read_at) {
  return create_reader(context, program_size, read_at, NULL);
}

MpegPsDemux *mpeg_ps_demux_create_reader_with_info(void *context,
                                                   size_t program_size,
                                                   MpegPsReadAt read_at,
                                                   const MpegPsInfo *info) {
  if (info == NULL) {
    return NULL;
  }
  const ProgramScan scan = {
      .video_stream_id = info->video_stream_id,
      .audio_stream_id = info->audio_stream_id,
      .video_size = info->video_size,
      .audio_size = info->audio_size,
      .video_packets = info->video_packets,
      .audio_packets = info->audio_packets,
      .first_video_pts90k = info->first_video_pts90k,
      .first_audio_pts90k = info->first_audio_pts90k,
  };
  return create_reader(context, program_size, read_at, &scan);
}

MpegPsDemux *mpeg_ps_demux_create(const uint8_t *program, size_t program_size) {
  if (program == NULL) {
    return NULL;
  }
  return mpeg_ps_demux_create_reader((void *)program, program_size,
                                     memory_read_at);
}

void mpeg_ps_demux_destroy(MpegPsDemux *demux) {
  if (demux == NULL) {
    return;
  }
  mpeg_ps_demux_stop(demux);
  media_byte_queue_destroy(demux->audio);
  media_byte_queue_destroy(demux->video);
  free(demux);
}

void mpeg_ps_demux_stop(MpegPsDemux *demux) {
  if (demux == NULL || demux->stopped) {
    return;
  }
  demux->stopped = true;
  media_byte_queue_close(demux->video);
  media_byte_queue_close(demux->audio);
  if (demux->producer_thread != LWP_THREAD_NULL) {
    LWP_JoinThread(demux->producer_thread, NULL);
    demux->producer_thread = LWP_THREAD_NULL;
  }
  free(demux->producer_stack);
  demux->producer_stack = NULL;
}

bool mpeg_ps_demux_start(MpegPsDemux *demux) {
  if (demux == NULL || demux->started) {
    return false;
  }
  demux->started = true;
  demux->producer_stack = malloc(PRODUCER_STACK_SIZE);
  if (demux->producer_stack == NULL ||
      LWP_CreateThread(&demux->producer_thread, run_producer, demux,
                       demux->producer_stack, PRODUCER_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    free(demux->producer_stack);
    demux->producer_stack = NULL;
    demux->started = false;
    return false;
  }
  SYS_Report("REFERENCE GX: demux-queues video=%uKiB audio=%uKiB\n",
             VIDEO_QUEUE_SIZE / 1024u, AUDIO_QUEUE_SIZE / 1024u);
  return true;
}

bool mpeg_ps_demux_pump(MpegPsDemux *demux, unsigned max_chunks) {
  if (demux == NULL || !demux->started || demux->stopped || demux->failed ||
      max_chunks == 0) {
    return demux != NULL && !demux->failed;
  }

  uint8_t bytes[PROGRAM_CACHE_SIZE];
  for (unsigned chunk_index = 0; chunk_index < max_chunks; ++chunk_index) {
    if (!demux->has_pending_packet) {
      bool finished = false;
      if (!next_pes_packet(&demux->reader, &demux->program_offset,
                           &demux->pending_packet, &finished)) {
        demux->failed = true;
        return false;
      }
      if (finished) {
        demux->loops += 1;
        demux->program_offset = 0;
        demux->reader.cache_valid = false;
        continue;
      }
      if (demux->pending_packet.stream_id != demux->scan.video_stream_id &&
          demux->pending_packet.stream_id != demux->scan.audio_stream_id) {
        continue;
      }
      demux->pending_offset = 0;
      demux->has_pending_packet = true;
    }

    MediaByteQueue *queue =
        demux->pending_packet.stream_id == demux->scan.video_stream_id
            ? demux->video
            : demux->audio;
    const size_t remaining =
        demux->pending_packet.payload_size - demux->pending_offset;
    size_t wanted = remaining < sizeof(bytes) ? remaining : sizeof(bytes);
    const size_t queue_space = media_byte_queue_contiguous_space(queue);
    if (queue_space == 0) {
      return true;
    }
    if (wanted > queue_space) {
      wanted = queue_space;
    }
    if (!reader_read(&demux->reader,
                     demux->pending_packet.payload_offset +
                         demux->pending_offset,
                     bytes, wanted)) {
      demux->failed = true;
      return false;
    }
    const size_t written =
        media_byte_queue_write_available(queue, bytes, wanted);
    if (written == 0) {
      return true;
    }
    demux->pending_offset += written;
    if (queue == demux->video) {
      demux->video_bytes_pumped += (uint32_t)written;
    } else {
      demux->audio_bytes_pumped += (uint32_t)written;
    }
    if (demux->pending_offset == demux->pending_packet.payload_size) {
      demux->has_pending_packet = false;
    }
  }
  return true;
}

static void *run_producer(void *context) {
  MpegPsDemux *demux = context;
  while (!demux->stopped && !demux->failed) {
    if (!mpeg_ps_demux_pump(demux, 1)) {
      demux->failed = true;
      break;
    }
    /* Yield when a bounded queue is full and let its codec consumer run. */
    usleep(1000);
  }
  return NULL;
}

size_t mpeg_ps_demux_read_video(void *context, uint8_t *destination,
                                size_t size) {
  MpegPsDemux *demux = context;
  return demux == NULL ? 0
                       : media_byte_queue_read(demux->video, destination, size);
}

size_t mpeg_ps_demux_read_audio(void *context, uint8_t *destination,
                                size_t size) {
  MpegPsDemux *demux = context;
  return demux == NULL ? 0
                       : media_byte_queue_read(demux->audio, destination, size);
}

size_t mpeg_ps_demux_video_size(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->scan.video_size;
}

size_t mpeg_ps_demux_audio_size(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->scan.audio_size;
}

int64_t mpeg_ps_demux_first_video_pts90k(const MpegPsDemux *demux) {
  return demux == NULL ? MPEG_NO_PTS : demux->scan.first_video_pts90k;
}

int64_t mpeg_ps_demux_first_audio_pts90k(const MpegPsDemux *demux) {
  return demux == NULL ? MPEG_NO_PTS : demux->scan.first_audio_pts90k;
}

uint32_t mpeg_ps_demux_loop_count(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->loops;
}

uint32_t mpeg_ps_demux_video_bytes_pumped(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->video_bytes_pumped;
}

uint32_t mpeg_ps_demux_audio_bytes_pumped(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->audio_bytes_pumped;
}

bool mpeg_ps_demux_failed(const MpegPsDemux *demux) {
  return demux == NULL || demux->failed;
}
