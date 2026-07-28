#ifndef MULTIPLEX_MPEG_PS_DEMUX_H
#define MULTIPLEX_MPEG_PS_DEMUX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MpegPsDemux MpegPsDemux;
typedef bool (*MpegPsReadAt)(void *context, size_t offset,
                             uint8_t *destination, size_t size);

MpegPsDemux *mpeg_ps_demux_create(const uint8_t *program,
                                  size_t program_size);
MpegPsDemux *mpeg_ps_demux_create_reader(void *context, size_t program_size,
                                         MpegPsReadAt read_at);
void mpeg_ps_demux_destroy(MpegPsDemux *demux);

const uint8_t *mpeg_ps_demux_video_data(const MpegPsDemux *demux);
size_t mpeg_ps_demux_video_size(const MpegPsDemux *demux);
const uint8_t *mpeg_ps_demux_audio_data(const MpegPsDemux *demux);
size_t mpeg_ps_demux_audio_size(const MpegPsDemux *demux);
int64_t mpeg_ps_demux_first_video_pts90k(const MpegPsDemux *demux);
int64_t mpeg_ps_demux_first_audio_pts90k(const MpegPsDemux *demux);

#endif
