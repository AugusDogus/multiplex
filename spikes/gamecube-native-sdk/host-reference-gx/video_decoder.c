#include "video_decoder.h"

#include <gccore.h>
#include <malloc.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/log.h>
#include <libavutil/mem.h>

/*
 * Register only the decoder used by this host. avcodec_register_all() retains
 * every enabled codec in the old MPlayer CE archive and needlessly bloats the
 * DOL.
 */
extern AVCodec ff_mpeg2video_decoder;
extern AVCodec ff_h264_decoder;
extern AVCodecParser ff_h264_parser;

#define VIDEO_INPUT_SIZE (32 * 1024)

struct VideoDecoder {
  VideoCodec selected_codec;
  void *reader_context;
  MediaRead read;
  uint8_t *input;
  size_t input_size;
  size_t input_offset;
  uint64_t stream_offset;
  AVCodec *codec;
  AVCodecContext *context;
  AVCodecParserContext *parser;
  AVFrame *picture;
  uint32_t decoded_frames;
};

static void report_ffmpeg(void *context, int level, const char *format,
                          va_list arguments) {
  (void)context;
  if (level > AV_LOG_WARNING) {
    return;
  }

  char message[256];
  vsnprintf(message, sizeof(message), format, arguments);
  SYS_Report("REFERENCE GX: ffmpeg: %s", message);
}

const char *video_codec_name(VideoCodec codec) {
  return codec == VIDEO_CODEC_H264 ? "h264" : "mpeg2video";
}

static enum CodecID ffmpeg_codec_id(VideoCodec codec) {
  return codec == VIDEO_CODEC_H264 ? CODEC_ID_H264 : CODEC_ID_MPEG2VIDEO;
}

static bool open_decoder(VideoDecoder *decoder) {
  decoder->context = avcodec_alloc_context();
  decoder->picture = avcodec_alloc_frame();
  if (decoder->context == NULL || decoder->picture == NULL) {
    SYS_Report("REFERENCE GX: %s decoder allocation failed\n",
               video_codec_name(decoder->selected_codec));
    return false;
  }

  decoder->context->codec_type = AVMEDIA_TYPE_VIDEO;
  decoder->context->codec_id = ffmpeg_codec_id(decoder->selected_codec);
  /*
   * MPlayer CE exposes this as lavdopts=fast=1. For MPEG-2 it selects the
   * unchecked fast intra-block decoder while retaining the artifact-free
   * non-intra path chosen by the GameCube port.
   */
  decoder->context->flags2 |= CODEC_FLAG2_FAST;
  if (decoder->selected_codec == VIDEO_CODEC_H264) {
    /*
     * WiiMC-GCN's GameCube guidance uses skiploopfilter=all for H.264. Keep
     * every display frame because this player's audio clock assumes a fixed
     * frame cadence, but omit deblocking on all pictures to recover the CPU
     * time the 485 MHz Gekko needs for real-time audio and video decoding.
     */
    decoder->context->skip_loop_filter = AVDISCARD_ALL;
  }
  if ((decoder->codec->capabilities & CODEC_CAP_TRUNCATED) != 0) {
    decoder->context->flags |= CODEC_FLAG_TRUNCATED;
  }
  if (avcodec_open(decoder->context, decoder->codec) < 0) {
    SYS_Report("REFERENCE GX: %s decoder open failed\n",
               video_codec_name(decoder->selected_codec));
    return false;
  }
  return true;
}

static bool refill_input(VideoDecoder *decoder) {
  decoder->input_size = decoder->read(
      decoder->reader_context, decoder->input, VIDEO_INPUT_SIZE);
  decoder->input_offset = 0;
  if (decoder->input_size == 0 ||
      decoder->input_size > VIDEO_INPUT_SIZE) {
    return false;
  }
  memset(decoder->input + decoder->input_size, 0,
         FF_INPUT_BUFFER_PADDING_SIZE);
  return true;
}

VideoDecoder *video_decoder_create(VideoCodec codec, void *reader_context,
                                   MediaRead read) {
  if (reader_context == NULL || read == NULL) {
    return NULL;
  }

  VideoDecoder *decoder = calloc(1, sizeof(*decoder));
  if (decoder == NULL) {
    return NULL;
  }
  decoder->selected_codec = codec;
  decoder->reader_context = reader_context;
  decoder->read = read;
  decoder->input =
      memalign(32, VIDEO_INPUT_SIZE + FF_INPUT_BUFFER_PADDING_SIZE);
  if (decoder->input == NULL) {
    free(decoder);
    return NULL;
  }

  avcodec_init();
  if (codec == VIDEO_CODEC_H264) {
    avcodec_register(&ff_h264_decoder);
    av_register_codec_parser(&ff_h264_parser);
  } else {
    avcodec_register(&ff_mpeg2video_decoder);
  }
  av_log_set_level(AV_LOG_WARNING);
  av_log_set_callback(report_ffmpeg);
  decoder->codec = avcodec_find_decoder(ffmpeg_codec_id(codec));
  if (decoder->codec == NULL || !open_decoder(decoder)) {
    video_decoder_destroy(decoder);
    return NULL;
  }
  if (codec == VIDEO_CODEC_H264) {
    decoder->parser = av_parser_init(CODEC_ID_H264);
    if (decoder->parser == NULL) {
      SYS_Report("REFERENCE GX: H.264 parser initialization failed\n");
      video_decoder_destroy(decoder);
      return NULL;
    }
  }
  return decoder;
}

void video_decoder_destroy(VideoDecoder *decoder) {
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
  if (decoder->picture != NULL) {
    av_free(decoder->picture);
  }
  free(decoder->input);
  free(decoder);
}

bool video_decoder_next_frame(VideoDecoder *decoder, VideoFrame *frame) {
  if (decoder == NULL || frame == NULL) {
    return false;
  }

  for (unsigned attempts = 0; attempts < 256; ++attempts) {
    if (decoder->input_offset >= decoder->input_size &&
        !refill_input(decoder)) {
      SYS_Report("REFERENCE GX: %s input stopped at byte %llu\n",
                 video_codec_name(decoder->selected_codec),
                 decoder->stream_offset);
      return false;
    }

    uint8_t *packet_data = decoder->input + decoder->input_offset;
    int packet_size = (int)(decoder->input_size - decoder->input_offset);
    if (decoder->parser != NULL) {
      uint8_t *parsed_data = NULL;
      int parsed_size = 0;
      const int consumed = av_parser_parse2(
          decoder->parser, decoder->context, &parsed_data, &parsed_size,
          packet_data, packet_size, AV_NOPTS_VALUE, AV_NOPTS_VALUE,
          (int64_t)decoder->stream_offset);
      if (consumed < 0 || consumed > packet_size ||
          (consumed == 0 && parsed_size == 0)) {
        SYS_Report("REFERENCE GX: %s parser failed at byte %u\n",
                   video_codec_name(decoder->selected_codec),
                   (unsigned)decoder->stream_offset);
        return false;
      }
      decoder->input_offset += (size_t)consumed;
      decoder->stream_offset += (uint64_t)consumed;
      if (parsed_size == 0) {
        continue;
      }
      packet_data = parsed_data;
      packet_size = parsed_size;
    }

    AVPacket packet;
    av_init_packet(&packet);
    packet.data = packet_data;
    packet.size = packet_size;

    int got_picture = 0;
    const int consumed = avcodec_decode_video2(
        decoder->context, decoder->picture, &got_picture, &packet);
    if (consumed < 0) {
      SYS_Report(
          "REFERENCE GX: %s decode failed at byte %u after %u frames\n",
          video_codec_name(decoder->selected_codec),
          (unsigned)decoder->stream_offset, decoder->decoded_frames);
      return false;
    }
    if (decoder->parser == NULL && consumed != 0) {
      decoder->input_offset += (size_t)consumed;
      decoder->stream_offset += (uint64_t)consumed;
    }

    if (got_picture != 0) {
      if (decoder->context->width <= 0 || decoder->context->width > 1024 ||
          decoder->context->height <= 0 || decoder->context->height > 1024 ||
          (decoder->context->width & 1) != 0 ||
          (decoder->context->height & 1) != 0 ||
          decoder->context->pix_fmt != PIX_FMT_YUV420P ||
          decoder->picture->data[0] == NULL ||
          decoder->picture->data[1] == NULL ||
          decoder->picture->data[2] == NULL) {
        SYS_Report(
            "REFERENCE GX: unexpected %s frame %dx%d pixel-format=%d\n",
            video_codec_name(decoder->selected_codec),
            decoder->context->width, decoder->context->height,
            decoder->context->pix_fmt);
        return false;
      }
      for (unsigned plane = 0; plane < 3; ++plane) {
        frame->planes[plane] = decoder->picture->data[plane];
        frame->strides[plane] = decoder->picture->linesize[plane];
      }
      frame->width = (unsigned)decoder->context->width;
      frame->height = (unsigned)decoder->context->height;
      decoder->decoded_frames += 1;
      return true;
    }
    if (decoder->parser == NULL && consumed == 0) {
      SYS_Report("REFERENCE GX: %s decoder made no input progress\n",
                 video_codec_name(decoder->selected_codec));
      return false;
    }
  }

  SYS_Report("REFERENCE GX: %s decoder exceeded progress limit\n",
             video_codec_name(decoder->selected_codec));
  return false;
}

uint64_t video_decoder_stream_offset(const VideoDecoder *decoder) {
  return decoder == NULL ? 0 : decoder->stream_offset;
}
