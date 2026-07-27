#ifndef MULTIPLEX_MP2_DECODER_H
#define MULTIPLEX_MP2_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct Mp2Decoder Mp2Decoder;

Mp2Decoder *mp2_decoder_create(const uint8_t *stream, size_t stream_size);
void mp2_decoder_destroy(Mp2Decoder *decoder);

/*
 * Fill the complete destination with native-endian, interleaved stereo S16
 * PCM. The embedded elementary stream loops without inserting silence.
 */
bool mp2_decoder_read_pcm(Mp2Decoder *decoder, void *destination,
                          size_t destination_size);

uint32_t mp2_decoder_frame_count(const Mp2Decoder *decoder);
uint32_t mp2_decoder_loop_count(const Mp2Decoder *decoder);

#endif
