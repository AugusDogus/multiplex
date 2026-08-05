#ifndef MULTIPLEX_AUDIO_DECODER_H
#define MULTIPLEX_AUDIO_DECODER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "media_reader.h"

typedef struct AudioDecoder AudioDecoder;

typedef enum {
  AUDIO_CODEC_MP2,
  AUDIO_CODEC_AAC,
} AudioCodec;

AudioDecoder *audio_decoder_create(AudioCodec codec, void *reader_context,
                                   MediaRead read);
void audio_decoder_destroy(AudioDecoder *decoder);

/*
 * Fill the complete destination with native-endian, interleaved stereo S16
 * PCM. Input arrives in bounded elementary-stream chunks from the container
 * producer.
 */
bool audio_decoder_read_pcm(AudioDecoder *decoder, void *destination,
                            size_t destination_size);

uint32_t audio_decoder_frame_count(const AudioDecoder *decoder);
const char *audio_codec_name(AudioCodec codec);
#endif
