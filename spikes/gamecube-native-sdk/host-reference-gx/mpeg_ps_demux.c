/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Narrow MPEG-2 Program Stream demuxer for the GameCube media spike. The
 * parser operates on a seekable reader, so HTTP containers do not need a
 * whole-file buffer. It extracts the first MPEG video and audio streams and
 * preserves their initial 90 kHz presentation timestamps.
 */

#include "mpeg_ps_demux.h"

#include <gccore.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MPEG_START_CODE_PREFIX 0x000001u
#define MPEG_PACK_HEADER 0xbau
#define MPEG_PROGRAM_END 0xb9u
#define MPEG_NO_STREAM 0xffu
#define MPEG_NO_PTS (-1)
#define PROGRAM_CACHE_SIZE 1024u

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

typedef struct {
  const uint8_t *data;
  size_t size;
} MemoryProgram;

struct MpegPsDemux {
  uint8_t *video;
  size_t video_size;
  uint8_t *audio;
  size_t audio_size;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
};

static bool memory_read_at(void *context, size_t offset,
                           uint8_t *destination, size_t size) {
  const MemoryProgram *memory = context;
  if (memory == NULL || destination == NULL || offset > memory->size ||
      size > memory->size - offset) {
    return false;
  }
  memcpy(destination, memory->data + offset, size);
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

static bool reader_be16(ProgramReader *reader, size_t offset,
                        uint16_t *value) {
  uint8_t bytes[2];
  if (!reader_read(reader, offset, bytes, sizeof(bytes))) {
    return false;
  }
  *value = (uint16_t)((uint16_t)bytes[0] << 8 | bytes[1]);
  return true;
}

static bool read_pts90k(const uint8_t *bytes, int64_t *pts90k) {
  if ((bytes[0] & 1u) == 0 || (bytes[2] & 1u) == 0 ||
      (bytes[4] & 1u) == 0) {
    return false;
  }
  *pts90k =
      (int64_t)((uint64_t)((bytes[0] >> 1) & 7u) << 30 |
                (uint64_t)bytes[1] << 22 |
                (uint64_t)(bytes[2] >> 1) << 15 |
                (uint64_t)bytes[3] << 7 |
                (uint64_t)(bytes[4] >> 1));
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
    const uint32_t prefix = (uint32_t)bytes[0] << 16 |
                            (uint32_t)bytes[1] << 8 | bytes[2];
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
      const size_t header_size = available < sizeof(header) ? available
                                                            : sizeof(header);
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
    uint32_t *packets =
        is_video ? &scan->video_packets : &scan->audio_packets;
    int64_t *first_pts = is_video ? &scan->first_video_pts90k
                                  : &scan->first_audio_pts90k;

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

static bool extract_streams(ProgramReader *reader, const ProgramScan *scan,
                            MpegPsDemux *demux) {
  reader->cache_valid = false;
  size_t offset = 0;
  size_t video_offset = 0;
  size_t audio_offset = 0;
  bool finished = false;
  while (!finished) {
    PesPacket pes;
    if (!next_pes_packet(reader, &offset, &pes, &finished)) {
      return false;
    }
    if (finished) {
      break;
    }

    uint8_t *destination = NULL;
    size_t *destination_offset = NULL;
    size_t destination_size = 0;
    if (pes.stream_id == scan->video_stream_id) {
      destination = demux->video;
      destination_offset = &video_offset;
      destination_size = demux->video_size;
    } else if (pes.stream_id == scan->audio_stream_id) {
      destination = demux->audio;
      destination_offset = &audio_offset;
      destination_size = demux->audio_size;
    } else {
      continue;
    }
    if (*destination_offset > destination_size ||
        pes.payload_size > destination_size - *destination_offset ||
        !reader_read(reader, pes.payload_offset,
                     destination + *destination_offset, pes.payload_size)) {
      return false;
    }
    *destination_offset += pes.payload_size;
  }
  return video_offset == demux->video_size &&
         audio_offset == demux->audio_size;
}

MpegPsDemux *mpeg_ps_demux_create_reader(void *context, size_t program_size,
                                         MpegPsReadAt read_at) {
  if (context == NULL || read_at == NULL || program_size < 16) {
    return NULL;
  }
  ProgramReader reader = {
      .context = context,
      .size = program_size,
      .read_at = read_at,
  };
  ProgramScan scan = {
      .video_stream_id = MPEG_NO_STREAM,
      .audio_stream_id = MPEG_NO_STREAM,
      .first_video_pts90k = MPEG_NO_PTS,
      .first_audio_pts90k = MPEG_NO_PTS,
  };
  if (!scan_program(&reader, &scan)) {
    SYS_Report("REFERENCE GX: MPEG-PS demux scan failed\n");
    return NULL;
  }

  MpegPsDemux *demux = calloc(1, sizeof(*demux));
  if (demux == NULL) {
    return NULL;
  }
  demux->video = malloc(scan.video_size);
  demux->audio = malloc(scan.audio_size);
  demux->video_size = scan.video_size;
  demux->audio_size = scan.audio_size;
  demux->first_video_pts90k = scan.first_video_pts90k;
  demux->first_audio_pts90k = scan.first_audio_pts90k;
  if (demux->video == NULL || demux->audio == NULL ||
      !extract_streams(&reader, &scan, demux)) {
    SYS_Report("REFERENCE GX: MPEG-PS demux extraction failed\n");
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

MpegPsDemux *mpeg_ps_demux_create(const uint8_t *program,
                                  size_t program_size) {
  if (program == NULL) {
    return NULL;
  }
  MemoryProgram memory = {
      .data = program,
      .size = program_size,
  };
  return mpeg_ps_demux_create_reader(&memory, program_size, memory_read_at);
}

void mpeg_ps_demux_destroy(MpegPsDemux *demux) {
  if (demux == NULL) {
    return;
  }
  free(demux->audio);
  free(demux->video);
  free(demux);
}

const uint8_t *mpeg_ps_demux_video_data(const MpegPsDemux *demux) {
  return demux == NULL ? NULL : demux->video;
}

size_t mpeg_ps_demux_video_size(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->video_size;
}

const uint8_t *mpeg_ps_demux_audio_data(const MpegPsDemux *demux) {
  return demux == NULL ? NULL : demux->audio;
}

size_t mpeg_ps_demux_audio_size(const MpegPsDemux *demux) {
  return demux == NULL ? 0 : demux->audio_size;
}

int64_t mpeg_ps_demux_first_video_pts90k(const MpegPsDemux *demux) {
  return demux == NULL ? MPEG_NO_PTS : demux->first_video_pts90k;
}

int64_t mpeg_ps_demux_first_audio_pts90k(const MpegPsDemux *demux) {
  return demux == NULL ? MPEG_NO_PTS : demux->first_audio_pts90k;
}
