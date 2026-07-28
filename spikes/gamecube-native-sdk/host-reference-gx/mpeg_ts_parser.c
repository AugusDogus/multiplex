/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Narrow MPEG-TS parser for Plex HLS. It discovers one H.264 video PID and
 * one AAC/ADTS audio PID from PAT/PMT tables, then forwards elementary PES
 * payloads without retaining whole HLS segments.
 */

#include "mpeg_ts_parser.h"

#include <string.h>

#define MPEG_TS_SYNC_BYTE 0x47u
#define MPEG_TS_PAT_PID 0u
#define MPEG_TS_TABLE_PAT 0u
#define MPEG_TS_TABLE_PMT 2u
#define MPEG_TS_STREAM_TYPE_AAC_ADTS 0x0fu
#define MPEG_TS_STREAM_TYPE_H264 0x1bu

typedef struct {
  const uint8_t *bytes;
  size_t size;
  bool payload_unit_start;
  uint16_t pid;
} TransportPayload;

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)((uint16_t)bytes[0] << 8u | bytes[1]);
}

static bool read_pts90k(const uint8_t *bytes, int64_t *pts90k) {
  if ((bytes[0] & 1u) == 0 || (bytes[2] & 1u) == 0 ||
      (bytes[4] & 1u) == 0) {
    return false;
  }
  *pts90k =
      (int64_t)((uint64_t)((bytes[0] >> 1u) & 7u) << 30u |
                (uint64_t)bytes[1] << 22u |
                (uint64_t)(bytes[2] >> 1u) << 15u |
                (uint64_t)bytes[3] << 7u |
                (uint64_t)(bytes[4] >> 1u));
  return true;
}

static bool transport_payload(const uint8_t *packet,
                              TransportPayload *payload) {
  if (packet[0] != MPEG_TS_SYNC_BYTE || (packet[1] & 0x80u) != 0) {
    return false;
  }
  const uint8_t adaptation_control = (packet[3] >> 4u) & 3u;
  if (adaptation_control == 0) {
    return false;
  }
  size_t offset = 4;
  if ((adaptation_control & 2u) != 0) {
    const size_t adaptation_size = packet[offset];
    offset += 1u + adaptation_size;
    if (offset > MPEG_TS_PACKET_SIZE) {
      return false;
    }
  }
  payload->payload_unit_start = (packet[1] & 0x40u) != 0;
  payload->pid =
      (uint16_t)(((uint16_t)(packet[1] & 0x1fu) << 8u) | packet[2]);
  payload->bytes = packet + offset;
  payload->size =
      (adaptation_control & 1u) != 0 ? MPEG_TS_PACKET_SIZE - offset : 0;
  return true;
}

static bool psi_section(const TransportPayload *payload, uint8_t table_id,
                        const uint8_t **section, size_t *section_size) {
  if (!payload->payload_unit_start || payload->size < 4u) {
    return false;
  }
  const size_t pointer_size = payload->bytes[0];
  if (pointer_size > payload->size - 1u) {
    return false;
  }
  const uint8_t *candidate = payload->bytes + 1u + pointer_size;
  const size_t available = payload->size - 1u - pointer_size;
  if (available < 3u || candidate[0] != table_id ||
      (candidate[1] & 0x80u) == 0) {
    return false;
  }
  const size_t body_size =
      (size_t)((candidate[1] & 0x0fu) << 8u) | candidate[2];
  const size_t total_size = 3u + body_size;
  if (body_size < 4u || total_size > available) {
    return false;
  }
  *section = candidate;
  *section_size = total_size;
  return true;
}

static bool parse_pat(MpegTsParser *parser,
                      const TransportPayload *payload) {
  const uint8_t *section = NULL;
  size_t section_size = 0;
  if (!psi_section(payload, MPEG_TS_TABLE_PAT, &section, &section_size) ||
      section_size < 12u) {
    return false;
  }
  const size_t entries_end = section_size - 4u;
  for (size_t offset = 8u; offset + 4u <= entries_end; offset += 4u) {
    const uint16_t program = read_be16(section + offset);
    if (program != 0) {
      parser->info.pmt_pid =
          (uint16_t)(((uint16_t)(section[offset + 2u] & 0x1fu) << 8u) |
                     section[offset + 3u]);
      return true;
    }
  }
  return false;
}

static bool parse_pmt(MpegTsParser *parser,
                      const TransportPayload *payload) {
  const uint8_t *section = NULL;
  size_t section_size = 0;
  if (!psi_section(payload, MPEG_TS_TABLE_PMT, &section, &section_size) ||
      section_size < 16u) {
    return false;
  }
  const size_t program_info_size =
      (size_t)((section[10] & 0x0fu) << 8u) | section[11];
  size_t offset = 12u + program_info_size;
  const size_t entries_end = section_size - 4u;
  if (offset > entries_end) {
    return false;
  }
  while (offset + 5u <= entries_end) {
    const uint8_t stream_type = section[offset];
    const uint16_t pid =
        (uint16_t)(((uint16_t)(section[offset + 1u] & 0x1fu) << 8u) |
                   section[offset + 2u]);
    const size_t descriptor_size =
        (size_t)((section[offset + 3u] & 0x0fu) << 8u) |
        section[offset + 4u];
    if (descriptor_size > entries_end - offset - 5u) {
      return false;
    }
    if (stream_type == MPEG_TS_STREAM_TYPE_H264 &&
        parser->info.video_pid == MPEG_TS_NO_PID) {
      parser->info.video_pid = pid;
      parser->info.video_stream_type = stream_type;
    } else if (stream_type == MPEG_TS_STREAM_TYPE_AAC_ADTS &&
               parser->info.audio_pid == MPEG_TS_NO_PID) {
      parser->info.audio_pid = pid;
      parser->info.audio_stream_type = stream_type;
    }
    offset += 5u + descriptor_size;
  }
  return offset == entries_end;
}

static bool forward_pes(MpegTsParser *parser,
                        const TransportPayload *payload,
                        MpegTsStream stream) {
  const uint8_t *bytes = payload->bytes;
  size_t size = payload->size;
  int64_t pts90k = MPEG_TS_NO_PTS;
  if (payload->payload_unit_start) {
    if (size < 9u || bytes[0] != 0 || bytes[1] != 0 || bytes[2] != 1u ||
        (bytes[6] & 0xc0u) != 0x80u) {
      parser->error = MPEG_TS_ERROR_PES;
      return false;
    }
    const size_t optional_size = bytes[8];
    const size_t header_size = 9u + optional_size;
    if (header_size > size) {
      parser->error = MPEG_TS_ERROR_PES;
      return false;
    }
    if ((bytes[7] & 0x80u) != 0 &&
        (optional_size < 5u || !read_pts90k(bytes + 9u, &pts90k))) {
      parser->error = MPEG_TS_ERROR_PES;
      return false;
    }
    bytes += header_size;
    size -= header_size;
  }
  if (stream == MPEG_TS_STREAM_VIDEO) {
    if (pts90k != MPEG_TS_NO_PTS &&
        parser->info.first_video_pts90k == MPEG_TS_NO_PTS) {
      parser->info.first_video_pts90k = pts90k;
    }
    parser->info.video_packets += 1u;
    parser->info.video_bytes += size;
  } else {
    if (pts90k != MPEG_TS_NO_PTS &&
        parser->info.first_audio_pts90k == MPEG_TS_NO_PTS) {
      parser->info.first_audio_pts90k = pts90k;
    }
    parser->info.audio_packets += 1u;
    parser->info.audio_bytes += size;
  }
  if (size != 0 && parser->write != NULL &&
      !parser->write(parser->write_context, stream, bytes, size)) {
    parser->error = MPEG_TS_ERROR_OUTPUT;
    return false;
  }
  return true;
}

static bool parse_packet(MpegTsParser *parser, const uint8_t *packet) {
  TransportPayload payload;
  if (!transport_payload(packet, &payload)) {
    parser->error = MPEG_TS_ERROR_TRANSPORT;
    parser->error_pid = MPEG_TS_NO_PID;
    return false;
  }
  parser->error_pid = payload.pid;
  if (payload.size == 0) {
    return true;
  }
  if (payload.pid == MPEG_TS_PAT_PID) {
    if (payload.payload_unit_start && !parse_pat(parser, &payload)) {
      parser->error = MPEG_TS_ERROR_PAT;
      return false;
    }
    return true;
  }
  if (payload.pid == parser->info.pmt_pid) {
    if (payload.payload_unit_start && !parse_pmt(parser, &payload)) {
      parser->error = MPEG_TS_ERROR_PMT;
      return false;
    }
    return true;
  }
  if (payload.pid == parser->info.video_pid) {
    return forward_pes(parser, &payload, MPEG_TS_STREAM_VIDEO);
  }
  if (payload.pid == parser->info.audio_pid) {
    return forward_pes(parser, &payload, MPEG_TS_STREAM_AUDIO);
  }
  return true;
}

void mpeg_ts_parser_init(MpegTsParser *parser, MpegTsWrite write,
                         void *write_context) {
  memset(parser, 0, sizeof(*parser));
  parser->write = write;
  parser->write_context = write_context;
  parser->info.pmt_pid = MPEG_TS_NO_PID;
  parser->info.video_pid = MPEG_TS_NO_PID;
  parser->info.audio_pid = MPEG_TS_NO_PID;
  parser->info.first_video_pts90k = MPEG_TS_NO_PTS;
  parser->info.first_audio_pts90k = MPEG_TS_NO_PTS;
}

bool mpeg_ts_parser_push(MpegTsParser *parser, const uint8_t *bytes,
                         size_t size) {
  if (parser == NULL || (bytes == NULL && size != 0)) {
    return false;
  }
  while (size != 0) {
    const size_t available = MPEG_TS_PACKET_SIZE - parser->pending_size;
    const size_t copied = size < available ? size : available;
    memcpy(parser->pending + parser->pending_size, bytes, copied);
    parser->pending_size += copied;
    bytes += copied;
    size -= copied;
    if (parser->pending_size == MPEG_TS_PACKET_SIZE) {
      parser->error = MPEG_TS_ERROR_NONE;
      parser->error_packet_index = parser->packet_index;
      if (!parse_packet(parser, parser->pending)) {
        return false;
      }
      ++parser->packet_index;
      parser->pending_size = 0;
    }
  }
  return true;
}

bool mpeg_ts_parser_finish(const MpegTsParser *parser) {
  return parser != NULL && parser->pending_size == 0 &&
         parser->info.pmt_pid != MPEG_TS_NO_PID &&
         parser->info.video_pid != MPEG_TS_NO_PID &&
         parser->info.audio_pid != MPEG_TS_NO_PID;
}

const MpegTsInfo *mpeg_ts_parser_info(const MpegTsParser *parser) {
  return parser == NULL ? NULL : &parser->info;
}

MpegTsError mpeg_ts_parser_error(const MpegTsParser *parser,
                                 uint32_t *packet_index, uint16_t *pid) {
  if (parser == NULL) {
    return MPEG_TS_ERROR_TRANSPORT;
  }
  if (packet_index != NULL) {
    *packet_index = parser->error_packet_index;
  }
  if (pid != NULL) {
    *pid = parser->error_pid;
  }
  return parser->error;
}
