/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Narrow in-memory MPEG-2 Program Stream demuxer for the GameCube media
 * spike. It extracts the first MPEG video and MPEG audio PES streams and
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

typedef struct {
  uint8_t stream_id;
  const uint8_t *payload;
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
  uint8_t *video;
  size_t video_size;
  uint8_t *audio;
  size_t audio_size;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
};

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)((uint16_t)bytes[0] << 8 | bytes[1]);
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

static bool parse_pes_packet(const uint8_t *packet, size_t packet_size,
                             uint8_t stream_id, PesPacket *pes) {
  if (packet_size < 6) {
    return false;
  }
  const size_t declared_size = 6u + read_be16(packet + 4);
  if (declared_size != packet_size || declared_size < 9) {
    return false;
  }

  const uint8_t *header = packet + 6;
  const size_t header_size = packet_size - 6u;
  size_t payload_offset = 0;
  bool has_pts = false;
  int64_t pts90k = MPEG_NO_PTS;

  if ((header[0] & 0xc0u) == 0x80u) {
    if (header_size < 3) {
      return false;
    }
    payload_offset = 3u + header[2];
    if (payload_offset > header_size) {
      return false;
    }
    if ((header[1] & 0x80u) != 0) {
      if (header[2] < 5 || header_size < 8 ||
          !read_pts90k(header + 3, &pts90k)) {
        return false;
      }
      has_pts = true;
    }
  } else {
    while (payload_offset < header_size &&
           header[payload_offset] == 0xffu) {
      payload_offset += 1;
    }
    if (payload_offset + 2 <= header_size &&
        (header[payload_offset] & 0xc0u) == 0x40u) {
      payload_offset += 2;
    }
    if (payload_offset >= header_size) {
      return false;
    }
    const uint8_t timestamp_prefix = header[payload_offset] & 0xf0u;
    if (timestamp_prefix == 0x20u || timestamp_prefix == 0x30u) {
      if (payload_offset + 5 > header_size ||
          !read_pts90k(header + payload_offset, &pts90k)) {
        return false;
      }
      has_pts = true;
      payload_offset += timestamp_prefix == 0x30u ? 10u : 5u;
    } else if (header[payload_offset] == 0x0fu) {
      payload_offset += 1;
    } else {
      return false;
    }
    if (payload_offset > header_size) {
      return false;
    }
  }

  pes->stream_id = stream_id;
  pes->payload = header + payload_offset;
  pes->payload_size = header_size - payload_offset;
  pes->has_pts = has_pts;
  pes->pts90k = pts90k;
  return true;
}

static bool find_start_code(const uint8_t *program, size_t program_size,
                            size_t *offset) {
  while (*offset + 4 <= program_size) {
    const uint32_t prefix =
        (uint32_t)program[*offset] << 16 |
        (uint32_t)program[*offset + 1] << 8 |
        program[*offset + 2];
    if (prefix == MPEG_START_CODE_PREFIX) {
      return true;
    }
    *offset += 1;
  }
  return false;
}

static bool next_pes_packet(const uint8_t *program, size_t program_size,
                            size_t *offset, PesPacket *pes, bool *finished) {
  *finished = false;
  while (find_start_code(program, program_size, offset)) {
    const size_t start = *offset;
    const uint8_t stream_id = program[start + 3];

    if (stream_id == MPEG_PROGRAM_END) {
      *offset = start + 4;
      *finished = true;
      return true;
    }
    if (stream_id == MPEG_PACK_HEADER) {
      if (start + 12 > program_size) {
        return false;
      }
      if ((program[start + 4] & 0xc0u) == 0x40u) {
        if (start + 14 > program_size) {
          return false;
        }
        *offset = start + 14u + (program[start + 13] & 7u);
      } else if ((program[start + 4] & 0xf0u) == 0x20u) {
        *offset = start + 12u;
      } else {
        return false;
      }
      if (*offset > program_size) {
        return false;
      }
      continue;
    }
    if (start + 6 > program_size) {
      return false;
    }

    const size_t packet_size = 6u + read_be16(program + start + 4);
    if (packet_size == 6 || packet_size > program_size - start) {
      return false;
    }
    *offset = start + packet_size;

    const bool is_video = stream_id >= 0xe0u && stream_id <= 0xefu;
    const bool is_audio = stream_id >= 0xc0u && stream_id <= 0xdfu;
    if (!is_video && !is_audio) {
      continue;
    }
    return parse_pes_packet(program + start, packet_size, stream_id, pes);
  }

  *finished = true;
  return *offset == program_size;
}

static bool add_payload_size(size_t *total, size_t payload_size) {
  if (payload_size > SIZE_MAX - *total) {
    return false;
  }
  *total += payload_size;
  return true;
}

static bool scan_program(const uint8_t *program, size_t program_size,
                         ProgramScan *scan) {
  size_t offset = 0;
  bool finished = false;
  while (!finished) {
    PesPacket pes;
    if (!next_pes_packet(program, program_size, &offset, &pes, &finished)) {
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
         scan->audio_stream_id != MPEG_NO_STREAM &&
         scan->video_size != 0 && scan->audio_size != 0 &&
         scan->first_video_pts90k != MPEG_NO_PTS &&
         scan->first_audio_pts90k != MPEG_NO_PTS;
}

static bool extract_streams(const uint8_t *program, size_t program_size,
                            const ProgramScan *scan, MpegPsDemux *demux) {
  size_t offset = 0;
  size_t video_offset = 0;
  size_t audio_offset = 0;
  bool finished = false;
  while (!finished) {
    PesPacket pes;
    if (!next_pes_packet(program, program_size, &offset, &pes, &finished)) {
      return false;
    }
    if (finished) {
      break;
    }

    if (pes.stream_id == scan->video_stream_id) {
      if (pes.payload_size > demux->video_size - video_offset) {
        return false;
      }
      memcpy(demux->video + video_offset, pes.payload, pes.payload_size);
      video_offset += pes.payload_size;
    } else if (pes.stream_id == scan->audio_stream_id) {
      if (pes.payload_size > demux->audio_size - audio_offset) {
        return false;
      }
      memcpy(demux->audio + audio_offset, pes.payload, pes.payload_size);
      audio_offset += pes.payload_size;
    }
  }
  return video_offset == demux->video_size &&
         audio_offset == demux->audio_size;
}

MpegPsDemux *mpeg_ps_demux_create(const uint8_t *program,
                                  size_t program_size) {
  if (program == NULL || program_size < 16) {
    return NULL;
  }

  ProgramScan scan = {
      .video_stream_id = MPEG_NO_STREAM,
      .audio_stream_id = MPEG_NO_STREAM,
      .first_video_pts90k = MPEG_NO_PTS,
      .first_audio_pts90k = MPEG_NO_PTS,
  };
  if (!scan_program(program, program_size, &scan)) {
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
      !extract_streams(program, program_size, &scan, demux)) {
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
