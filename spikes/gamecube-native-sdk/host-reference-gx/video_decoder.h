#ifndef MULTIPLEX_VIDEO_DECODER_H
#define MULTIPLEX_VIDEO_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "media_reader.h"

typedef struct VideoDecoder VideoDecoder;

typedef struct {
  const uint8_t *planes[3];
  int strides[3];
  unsigned width;
  unsigned height;
} VideoFrame;

typedef enum {
  VIDEO_CODEC_MPEG2,
  VIDEO_CODEC_H264,
} VideoCodec;

VideoDecoder *video_decoder_create(VideoCodec codec, void *reader_context,
                                   MediaRead read);
void video_decoder_destroy(VideoDecoder *decoder);

/*
 * Decodes the next display-order YUV420P frame. The returned planes remain
 * valid until the next call. Input arrives in bounded elementary-stream
 * chunks from the container producer.
 */
bool video_decoder_next_frame(VideoDecoder *decoder, VideoFrame *frame);
uint64_t video_decoder_stream_offset(const VideoDecoder *decoder);

const char *video_codec_name(VideoCodec codec);

#endif
