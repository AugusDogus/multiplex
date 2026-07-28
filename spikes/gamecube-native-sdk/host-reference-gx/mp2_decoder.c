/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Thin GameCube adapter around the fixed-point MP2 decoder bundled by the
 * pinned MPlayer CE tree.
 */

#include "mp2_decoder.h"

#include <gccore.h>
#include <malloc.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/mem.h>

#define MP2_CHANNELS 2
#define MP2_SAMPLE_RATE 48000
#define MP2_INPUT_SIZE (8 * 1024)

extern AVCodec ff_mp2_decoder;
extern AVCodecParser ff_mpegaudio_parser;

struct Mp2Decoder {
  void *reader_context;
  MediaRead read;
  uint8_t *input;
  size_t input_size;
  size_t input_offset;
  uint64_t stream_offset;
  AVCodec *codec;
  AVCodecContext *context;
  AVCodecParserContext *parser;
  uint8_t *decoded;
  size_t decoded_size;
  size_t decoded_offset;
  uint32_t decoded_frames;
};

static bool refill_input(Mp2Decoder *decoder) {
  decoder->input_size = decoder->read(
      decoder->reader_context, decoder->input, MP2_INPUT_SIZE);
  decoder->input_offset = 0;
  if (decoder->input_size == 0 || decoder->input_size > MP2_INPUT_SIZE) {
    return false;
  }
  memset(decoder->input + decoder->input_size, 0,
         FF_INPUT_BUFFER_PADDING_SIZE);
  return true;
}

static bool decode_frame(Mp2Decoder *decoder) {
  for (unsigned attempts = 0; attempts < 64; ++attempts) {
    if (decoder->input_offset >= decoder->input_size &&
        !refill_input(decoder)) {
      SYS_Report("REFERENCE GX: MP2 input stopped at byte %llu\n",
                 decoder->stream_offset);
      return false;
    }
    const uint8_t *input = decoder->input + decoder->input_offset;
    const int input_size =
        (int)(decoder->input_size - decoder->input_offset);
    uint8_t *frame_data = NULL;
    int frame_size = 0;
    const int parsed = av_parser_parse2(
        decoder->parser, decoder->context, &frame_data, &frame_size, input,
        input_size, AV_NOPTS_VALUE, AV_NOPTS_VALUE,
        (int64_t)decoder->stream_offset);
    if (parsed < 0 || parsed > input_size) {
      SYS_Report("REFERENCE GX: MP2 parser failed at byte %u\n",
                 (unsigned)decoder->stream_offset);
      return false;
    }
    decoder->input_offset += (size_t)parsed;
    decoder->stream_offset += (uint64_t)parsed;

    if (frame_size == 0) {
      continue;
    }

    AVPacket packet;
    av_init_packet(&packet);
    packet.data = frame_data;
    packet.size = frame_size;
    int output_size = AVCODEC_MAX_AUDIO_FRAME_SIZE;
    const int consumed = avcodec_decode_audio3(
        decoder->context, (int16_t *)decoder->decoded, &output_size, &packet);
    if (consumed < 0) {
      SYS_Report("REFERENCE GX: MP2 decode failed at byte %u frame=%u\n",
                 (unsigned)decoder->stream_offset, decoder->decoded_frames);
      return false;
    }
    if (consumed != frame_size) {
      SYS_Report(
          "REFERENCE GX: MP2 decoder consumed %d of %d parsed bytes\n",
          consumed, frame_size);
      return false;
    }

    if (output_size == 0) {
      continue;
    }
    if (output_size < 0 || output_size > AVCODEC_MAX_AUDIO_FRAME_SIZE ||
        decoder->context->sample_rate != MP2_SAMPLE_RATE ||
        decoder->context->channels != MP2_CHANNELS ||
        decoder->context->sample_fmt != AV_SAMPLE_FMT_S16) {
      SYS_Report(
          "REFERENCE GX: unexpected MP2 frame bytes=%d rate=%d channels=%d "
          "format=%d\n",
          output_size, decoder->context->sample_rate,
          decoder->context->channels, decoder->context->sample_fmt);
      return false;
    }

    decoder->decoded_size = (size_t)output_size;
    decoder->decoded_offset = 0;
    decoder->decoded_frames += 1;
    return true;
  }

  SYS_Report("REFERENCE GX: MP2 decoder exceeded progress limit\n");
  return false;
}

Mp2Decoder *mp2_decoder_create(void *reader_context, MediaRead read) {
  if (reader_context == NULL || read == NULL) {
    return NULL;
  }

  Mp2Decoder *decoder = calloc(1, sizeof(*decoder));
  if (decoder == NULL) {
    return NULL;
  }
  decoder->reader_context = reader_context;
  decoder->read = read;
  decoder->input =
      memalign(32, MP2_INPUT_SIZE + FF_INPUT_BUFFER_PADDING_SIZE);
  decoder->decoded = memalign(32, AVCODEC_MAX_AUDIO_FRAME_SIZE);
  if (decoder->input == NULL || decoder->decoded == NULL) {
    mp2_decoder_destroy(decoder);
    return NULL;
  }

  avcodec_init();
  avcodec_register(&ff_mp2_decoder);
  av_register_codec_parser(&ff_mpegaudio_parser);
  decoder->codec = avcodec_find_decoder(CODEC_ID_MP2);
  decoder->context = avcodec_alloc_context();
  if (decoder->codec == NULL || decoder->context == NULL) {
    mp2_decoder_destroy(decoder);
    return NULL;
  }
  decoder->context->codec_type = AVMEDIA_TYPE_AUDIO;
  decoder->context->codec_id = CODEC_ID_MP2;
  if (avcodec_open(decoder->context, decoder->codec) < 0) {
    SYS_Report("REFERENCE GX: MP2 decoder open failed\n");
    mp2_decoder_destroy(decoder);
    return NULL;
  }
  decoder->parser = av_parser_init(CODEC_ID_MP2);
  if (decoder->parser == NULL) {
    SYS_Report("REFERENCE GX: MP2 parser initialization failed\n");
    mp2_decoder_destroy(decoder);
    return NULL;
  }
  return decoder;
}

void mp2_decoder_destroy(Mp2Decoder *decoder) {
  if (decoder == NULL) {
    return;
  }
  if (decoder->parser != NULL) {
    av_parser_close(decoder->parser);
  }
  if (decoder->context != NULL) {
    avcodec_close(decoder->context);
    av_free(decoder->context);
  }
  free(decoder->decoded);
  free(decoder->input);
  free(decoder);
}

bool mp2_decoder_read_pcm(Mp2Decoder *decoder, void *destination,
                          size_t destination_size) {
  if (decoder == NULL || destination == NULL || destination_size == 0) {
    return false;
  }

  uint8_t *output = destination;
  size_t written = 0;
  while (written < destination_size) {
    if (decoder->decoded_offset >= decoder->decoded_size &&
        !decode_frame(decoder)) {
      return false;
    }

    const size_t available =
        decoder->decoded_size - decoder->decoded_offset;
    const size_t remaining = destination_size - written;
    const size_t copy_size = available < remaining ? available : remaining;
    memcpy(output + written, decoder->decoded + decoder->decoded_offset,
           copy_size);
    decoder->decoded_offset += copy_size;
    written += copy_size;
  }
  return true;
}

uint32_t mp2_decoder_frame_count(const Mp2Decoder *decoder) {
  return decoder == NULL ? 0 : decoder->decoded_frames;
}
