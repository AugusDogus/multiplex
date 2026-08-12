/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Thin GameCube adapter around the fixed-point audio decoders bundled by the
 * pinned MPlayer CE tree.
 */

#include "audio_decoder.h"

#include <gccore.h>
#include <malloc.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/mem.h>

#define AUDIO_CHANNELS 2
#define AUDIO_SAMPLE_RATE 48000
#define AUDIO_INPUT_SIZE (8 * 1024)

extern AVCodec ff_mp2_decoder;
extern AVCodecParser ff_mpegaudio_parser;
extern AVCodec ff_aac_decoder;
extern AVCodecParser ff_aac_parser;

struct AudioDecoder {
  AudioCodec selected_codec;
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

const char *audio_codec_name(AudioCodec codec) {
  return codec == AUDIO_CODEC_AAC ? "aac" : "mp2";
}

static enum CodecID ffmpeg_codec_id(AudioCodec codec) {
  return codec == AUDIO_CODEC_AAC ? CODEC_ID_AAC : CODEC_ID_MP2;
}

static bool refill_input(AudioDecoder *decoder) {
  decoder->input_size =
      decoder->read(decoder->reader_context, decoder->input, AUDIO_INPUT_SIZE);
  decoder->input_offset = 0;
  if (decoder->input_size == 0 || decoder->input_size > AUDIO_INPUT_SIZE) {
    return false;
  }
  memset(decoder->input + decoder->input_size, 0, FF_INPUT_BUFFER_PADDING_SIZE);
  return true;
}

static bool decode_frame(AudioDecoder *decoder) {
  for (unsigned attempts = 0; attempts < 64; ++attempts) {
    if (decoder->input_offset >= decoder->input_size &&
        !refill_input(decoder)) {
      SYS_Report("REFERENCE GX: %s input stopped at byte %llu\n",
                 audio_codec_name(decoder->selected_codec),
                 decoder->stream_offset);
      return false;
    }
    const uint8_t *input = decoder->input + decoder->input_offset;
    const int input_size = (int)(decoder->input_size - decoder->input_offset);
    uint8_t *frame_data = NULL;
    int frame_size = 0;
    const int parsed =
        av_parser_parse2(decoder->parser, decoder->context, &frame_data,
                         &frame_size, input, input_size, AV_NOPTS_VALUE,
                         AV_NOPTS_VALUE, (int64_t)decoder->stream_offset);
    if (parsed < 0 || parsed > input_size) {
      SYS_Report("REFERENCE GX: %s parser failed at byte %u\n",
                 audio_codec_name(decoder->selected_codec),
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
      SYS_Report("REFERENCE GX: %s decode failed at byte %u frame=%u\n",
                 audio_codec_name(decoder->selected_codec),
                 (unsigned)decoder->stream_offset, decoder->decoded_frames);
      return false;
    }
    if (consumed != frame_size) {
      SYS_Report("REFERENCE GX: %s decoder consumed %d of %d parsed bytes\n",
                 audio_codec_name(decoder->selected_codec), consumed,
                 frame_size);
      return false;
    }

    if (output_size == 0) {
      continue;
    }
    if (output_size < 0 || output_size > AVCODEC_MAX_AUDIO_FRAME_SIZE ||
        decoder->context->sample_rate != AUDIO_SAMPLE_RATE ||
        decoder->context->channels != AUDIO_CHANNELS ||
        decoder->context->sample_fmt != AV_SAMPLE_FMT_S16) {
      SYS_Report(
          "REFERENCE GX: unexpected %s frame bytes=%d rate=%d channels=%d "
          "format=%d\n",
          audio_codec_name(decoder->selected_codec), output_size,
          decoder->context->sample_rate, decoder->context->channels,
          decoder->context->sample_fmt);
      return false;
    }

    decoder->decoded_size = (size_t)output_size;
    decoder->decoded_offset = 0;
    decoder->decoded_frames += 1;
    return true;
  }

  SYS_Report("REFERENCE GX: %s decoder exceeded progress limit\n",
             audio_codec_name(decoder->selected_codec));
  return false;
}

AudioDecoder *audio_decoder_create(AudioCodec codec, void *reader_context,
                                   MediaRead read) {
  if (reader_context == NULL || read == NULL) {
    return NULL;
  }

  AudioDecoder *decoder = calloc(1, sizeof(*decoder));
  if (decoder == NULL) {
    return NULL;
  }
  decoder->selected_codec = codec;
  decoder->reader_context = reader_context;
  decoder->read = read;
  decoder->input =
      memalign(32, AUDIO_INPUT_SIZE + FF_INPUT_BUFFER_PADDING_SIZE);
  decoder->decoded = memalign(32, AVCODEC_MAX_AUDIO_FRAME_SIZE);
  if (decoder->input == NULL || decoder->decoded == NULL) {
    audio_decoder_destroy(decoder);
    return NULL;
  }

  avcodec_init();
  if (codec == AUDIO_CODEC_AAC) {
    avcodec_register(&ff_aac_decoder);
    av_register_codec_parser(&ff_aac_parser);
  } else {
    avcodec_register(&ff_mp2_decoder);
    av_register_codec_parser(&ff_mpegaudio_parser);
  }
  decoder->codec = avcodec_find_decoder(ffmpeg_codec_id(codec));
  decoder->context = avcodec_alloc_context();
  if (decoder->codec == NULL || decoder->context == NULL) {
    audio_decoder_destroy(decoder);
    return NULL;
  }
  decoder->context->codec_type = AVMEDIA_TYPE_AUDIO;
  decoder->context->codec_id = ffmpeg_codec_id(codec);
  if (avcodec_open(decoder->context, decoder->codec) < 0) {
    SYS_Report("REFERENCE GX: %s decoder open failed\n",
               audio_codec_name(codec));
    audio_decoder_destroy(decoder);
    return NULL;
  }
  decoder->parser = av_parser_init(ffmpeg_codec_id(codec));
  if (decoder->parser == NULL) {
    SYS_Report("REFERENCE GX: %s parser initialization failed\n",
               audio_codec_name(codec));
    audio_decoder_destroy(decoder);
    return NULL;
  }
  return decoder;
}

void audio_decoder_destroy(AudioDecoder *decoder) {
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

bool audio_decoder_read_pcm(AudioDecoder *decoder, void *destination,
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

    const size_t available = decoder->decoded_size - decoder->decoded_offset;
    const size_t remaining = destination_size - written;
    const size_t copy_size = available < remaining ? available : remaining;
    memcpy(output + written, decoder->decoded + decoder->decoded_offset,
           copy_size);
    decoder->decoded_offset += copy_size;
    written += copy_size;
  }
  return true;
}

uint32_t audio_decoder_frame_count(const AudioDecoder *decoder) {
  return decoder == NULL ? 0 : decoder->decoded_frames;
}
