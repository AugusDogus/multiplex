#ifndef MULTIPLEX_MPEG2_DECODER_H
#define MULTIPLEX_MPEG2_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "media_reader.h"

typedef struct Mpeg2Decoder Mpeg2Decoder;

typedef struct {
  const uint8_t *planes[3];
  int strides[3];
  unsigned width;
  unsigned height;
} Mpeg2Frame;

Mpeg2Decoder *mpeg2_decoder_create(void *reader_context, MediaRead read);
void mpeg2_decoder_destroy(Mpeg2Decoder *decoder);

/*
 * Decodes the next display-order YUV420P frame. The returned planes remain
 * valid until the next call. Input arrives in bounded chunks from the MPEG-PS
 * producer.
 */
bool mpeg2_decoder_next_frame(Mpeg2Decoder *decoder, Mpeg2Frame *frame);

#endif
