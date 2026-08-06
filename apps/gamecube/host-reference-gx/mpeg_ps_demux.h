#ifndef MULTIPLEX_MPEG_PS_DEMUX_H
#define MULTIPLEX_MPEG_PS_DEMUX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "media_reader.h"

typedef struct MpegPsDemux MpegPsDemux;
typedef bool (*MpegPsReadAt)(void *context, size_t offset, uint8_t *destination,
                             size_t size);
typedef struct {
  uint8_t video_stream_id;
  uint8_t audio_stream_id;
  size_t video_size;
  size_t audio_size;
  uint32_t video_packets;
  uint32_t audio_packets;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
} MpegPsInfo;

MpegPsDemux *mpeg_ps_demux_create(const uint8_t *program, size_t program_size);
MpegPsDemux *mpeg_ps_demux_create_reader(void *context, size_t program_size,
                                         MpegPsReadAt read_at);
MpegPsDemux *mpeg_ps_demux_create_reader_with_info(void *context,
                                                   size_t program_size,
                                                   MpegPsReadAt read_at,
                                                   const MpegPsInfo *info);
void mpeg_ps_demux_destroy(MpegPsDemux *demux);

bool mpeg_ps_demux_start(MpegPsDemux *demux);
bool mpeg_ps_demux_pump(MpegPsDemux *demux, unsigned max_chunks);
void mpeg_ps_demux_stop(MpegPsDemux *demux);
size_t mpeg_ps_demux_read_video(void *context, uint8_t *destination,
                                size_t size);
size_t mpeg_ps_demux_read_audio(void *context, uint8_t *destination,
                                size_t size);
size_t mpeg_ps_demux_video_size(const MpegPsDemux *demux);
size_t mpeg_ps_demux_audio_size(const MpegPsDemux *demux);
int64_t mpeg_ps_demux_first_video_pts90k(const MpegPsDemux *demux);
int64_t mpeg_ps_demux_first_audio_pts90k(const MpegPsDemux *demux);
uint32_t mpeg_ps_demux_loop_count(const MpegPsDemux *demux);
uint32_t mpeg_ps_demux_video_bytes_pumped(const MpegPsDemux *demux);
uint32_t mpeg_ps_demux_audio_bytes_pumped(const MpegPsDemux *demux);
bool mpeg_ps_demux_failed(const MpegPsDemux *demux);

#endif
