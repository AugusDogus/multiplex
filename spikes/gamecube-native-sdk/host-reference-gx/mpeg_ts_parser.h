#ifndef MULTIPLEX_MPEG_TS_PARSER_H
#define MULTIPLEX_MPEG_TS_PARSER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MPEG_TS_PACKET_SIZE 188u
#define MPEG_TS_NO_PID UINT16_MAX
#define MPEG_TS_NO_PTS INT64_C(-1)

typedef enum {
  MPEG_TS_STREAM_VIDEO = 1,
  MPEG_TS_STREAM_AUDIO = 2,
} MpegTsStream;

typedef bool (*MpegTsWrite)(void *context, MpegTsStream stream,
                            const uint8_t *bytes, size_t size);

typedef struct {
  uint16_t pmt_pid;
  uint16_t video_pid;
  uint16_t audio_pid;
  uint8_t video_stream_type;
  uint8_t audio_stream_type;
  uint32_t video_packets;
  uint32_t audio_packets;
  uint64_t video_bytes;
  uint64_t audio_bytes;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
} MpegTsInfo;

typedef struct {
  MpegTsWrite write;
  void *write_context;
  MpegTsInfo info;
  uint8_t pending[MPEG_TS_PACKET_SIZE];
  size_t pending_size;
} MpegTsParser;

void mpeg_ts_parser_init(MpegTsParser *parser, MpegTsWrite write,
                         void *write_context);
bool mpeg_ts_parser_push(MpegTsParser *parser, const uint8_t *bytes,
                         size_t size);
bool mpeg_ts_parser_finish(const MpegTsParser *parser);
const MpegTsInfo *mpeg_ts_parser_info(const MpegTsParser *parser);

#endif
