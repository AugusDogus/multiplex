#ifndef MULTIPLEX_MP2_DECODER_H
#define MULTIPLEX_MP2_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "media_reader.h"

typedef struct Mp2Decoder Mp2Decoder;

Mp2Decoder *mp2_decoder_create(void *reader_context, MediaRead read);
void mp2_decoder_destroy(Mp2Decoder *decoder);

/*
 * Fill the complete destination with native-endian, interleaved stereo S16
 * PCM. Input arrives in bounded chunks from the MPEG-PS producer.
 */
bool mp2_decoder_read_pcm(Mp2Decoder *decoder, void *destination,
                          size_t destination_size);

uint32_t mp2_decoder_frame_count(const Mp2Decoder *decoder);
#endif
