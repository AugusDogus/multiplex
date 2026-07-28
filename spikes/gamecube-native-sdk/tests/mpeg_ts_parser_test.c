#include "mpeg_ts_parser.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  uint8_t video[64];
  size_t video_size;
  uint8_t audio[64];
  size_t audio_size;
} Output;

static bool collect(void *context, MpegTsStream stream, const uint8_t *bytes,
                    size_t size) {
  Output *output = context;
  uint8_t *destination =
      stream == MPEG_TS_STREAM_VIDEO ? output->video : output->audio;
  size_t *destination_size = stream == MPEG_TS_STREAM_VIDEO
                                 ? &output->video_size
                                 : &output->audio_size;
  if (size > 64u - *destination_size) {
    return false;
  }
  memcpy(destination + *destination_size, bytes, size);
  *destination_size += size;
  return true;
}

static void make_packet(uint8_t *packet, uint16_t pid, bool start,
                        const uint8_t *payload, size_t payload_size,
                        uint8_t continuity) {
  assert(payload_size <= 184u);
  memset(packet, 0xff, MPEG_TS_PACKET_SIZE);
  packet[0] = 0x47;
  packet[1] = (uint8_t)((pid >> 8u) & 0x1fu);
  if (start) {
    packet[1] |= 0x40u;
  }
  packet[2] = (uint8_t)pid;
  if (payload_size == 184u) {
    packet[3] = (uint8_t)(0x10u | (continuity & 0x0fu));
    memcpy(packet + 4u, payload, payload_size);
    return;
  }
  packet[3] = (uint8_t)(0x30u | (continuity & 0x0fu));
  const size_t adaptation_size = 183u - payload_size;
  packet[4] = (uint8_t)adaptation_size;
  if (adaptation_size != 0) {
    packet[5] = 0;
  }
  memcpy(packet + 5u + adaptation_size, payload, payload_size);
}

static void write_pts(uint8_t *bytes, uint64_t pts) {
  bytes[0] = (uint8_t)(0x20u | ((pts >> 29u) & 0x0eu) | 1u);
  bytes[1] = (uint8_t)(pts >> 22u);
  bytes[2] = (uint8_t)(((pts >> 14u) & 0xfeu) | 1u);
  bytes[3] = (uint8_t)(pts >> 7u);
  bytes[4] = (uint8_t)(((pts << 1u) & 0xfeu) | 1u);
}

static size_t make_pes(uint8_t *destination, uint8_t stream_id, uint64_t pts,
                       const uint8_t *payload, size_t payload_size) {
  destination[0] = 0;
  destination[1] = 0;
  destination[2] = 1;
  destination[3] = stream_id;
  const size_t packet_length = 8u + payload_size;
  destination[4] = (uint8_t)(packet_length >> 8u);
  destination[5] = (uint8_t)packet_length;
  destination[6] = 0x80;
  destination[7] = 0x80;
  destination[8] = 5;
  write_pts(destination + 9u, pts);
  memcpy(destination + 14u, payload, payload_size);
  return 14u + payload_size;
}

static void test_extracts_h264_and_aac(void) {
  static const uint8_t pat[] = {
      0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00,
      0x00, 0x01, 0xe1, 0x00, 0x00, 0x00, 0x00, 0x00,
  };
  static const uint8_t pmt[] = {
      0x00, 0x02, 0xb0, 0x17, 0x00, 0x01, 0xc1, 0x00, 0x00,
      0xe1, 0x01, 0xf0, 0x00, 0x1b, 0xe1, 0x01, 0xf0, 0x00,
      0x0f, 0xe1, 0x02, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00,
  };
  static const uint8_t video[] = {0x00, 0x00, 0x00, 0x01,
                                  0x65, 0xaa, 0xbb};
  static const uint8_t audio[] = {0xff, 0xf1, 0x50, 0x80,
                                  0x01, 0x7f, 0xfc};
  uint8_t transport[MPEG_TS_PACKET_SIZE * 4u];
  uint8_t pes[64];

  make_packet(transport, 0, true, pat, sizeof(pat), 0);
  make_packet(transport + MPEG_TS_PACKET_SIZE, 0x100, true, pmt,
              sizeof(pmt), 0);
  size_t pes_size = make_pes(pes, 0xe0, 90000, video, sizeof(video));
  make_packet(transport + MPEG_TS_PACKET_SIZE * 2u, 0x101, true, pes,
              pes_size, 0);
  pes_size = make_pes(pes, 0xc0, 90900, audio, sizeof(audio));
  make_packet(transport + MPEG_TS_PACKET_SIZE * 3u, 0x102, true, pes,
              pes_size, 0);

  Output output = {0};
  MpegTsParser parser;
  mpeg_ts_parser_init(&parser, collect, &output);
  assert(mpeg_ts_parser_push(&parser, transport, 97));
  assert(mpeg_ts_parser_push(&parser, transport + 97,
                             sizeof(transport) - 97));
  assert(mpeg_ts_parser_finish(&parser));

  const MpegTsInfo *info = mpeg_ts_parser_info(&parser);
  assert(info != NULL);
  assert(info->pmt_pid == 0x100);
  assert(info->video_pid == 0x101);
  assert(info->audio_pid == 0x102);
  assert(info->video_stream_type == 0x1b);
  assert(info->audio_stream_type == 0x0f);
  assert(info->video_packets == 1);
  assert(info->audio_packets == 1);
  assert(info->video_bytes == sizeof(video));
  assert(info->audio_bytes == sizeof(audio));
  assert(info->first_video_pts90k == 90000);
  assert(info->first_audio_pts90k == 90900);
  assert(output.video_size == sizeof(video));
  assert(output.audio_size == sizeof(audio));
  assert(memcmp(output.video, video, sizeof(video)) == 0);
  assert(memcmp(output.audio, audio, sizeof(audio)) == 0);
}

static void test_rejects_truncated_packet(void) {
  uint8_t packet[MPEG_TS_PACKET_SIZE] = {0};
  packet[0] = 0x47;
  MpegTsParser parser;
  mpeg_ts_parser_init(&parser, NULL, NULL);
  assert(mpeg_ts_parser_push(&parser, packet, sizeof(packet) - 1u));
  assert(!mpeg_ts_parser_finish(&parser));
}

static int inspect_transport_file(const char *path) {
  FILE *file = fopen(path, "rb");
  if (file == NULL) {
    return 2;
  }
  MpegTsParser parser;
  mpeg_ts_parser_init(&parser, NULL, NULL);
  uint8_t bytes[4096];
  bool parsed = true;
  size_t size = 0;
  while (parsed && (size = fread(bytes, 1, sizeof(bytes), file)) != 0) {
    parsed = mpeg_ts_parser_push(&parser, bytes, size);
  }
  fclose(file);
  uint32_t packet_index = 0;
  uint16_t pid = MPEG_TS_NO_PID;
  const MpegTsError error =
      mpeg_ts_parser_error(&parser, &packet_index, &pid);
  const MpegTsInfo *info = mpeg_ts_parser_info(&parser);
  printf(
      "parsed=%u complete=%u packet=%u pid=%u error=%u video-pid=%u "
      "audio-pid=%u video-bytes=%llu audio-bytes=%llu\n",
      parsed ? 1u : 0u, mpeg_ts_parser_finish(&parser) ? 1u : 0u,
      packet_index, pid, error, info->video_pid, info->audio_pid,
      (unsigned long long)info->video_bytes,
      (unsigned long long)info->audio_bytes);
  return parsed ? 0 : 1;
}

int main(int argc, char **argv) {
  test_extracts_h264_and_aac();
  test_rejects_truncated_packet();
  if (argc == 2) {
    return inspect_transport_file(argv[1]);
  }
  puts("GameCube MPEG-TS parser tests passed.");
  return 0;
}
