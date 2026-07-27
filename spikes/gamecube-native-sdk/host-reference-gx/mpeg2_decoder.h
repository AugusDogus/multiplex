#ifndef MULTIPLEX_MPEG2_DECODER_H
#define MULTIPLEX_MPEG2_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct Mpeg2Decoder Mpeg2Decoder;

typedef struct {
  const uint8_t *planes[3];
  int strides[3];
  unsigned width;
  unsigned height;
} Mpeg2Frame;

Mpeg2Decoder *mpeg2_decoder_create(const uint8_t *stream, size_t stream_size);
void mpeg2_decoder_destroy(Mpeg2Decoder *decoder);

/*
 * Decodes the next display-order YUV420P frame. The returned planes remain
 * valid until the next call. The embedded elementary stream loops at EOF.
 */
bool mpeg2_decoder_next_frame(Mpeg2Decoder *decoder, Mpeg2Frame *frame);

#endif
