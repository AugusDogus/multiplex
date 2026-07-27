#include "mpeg2_decoder.h"

#include <gccore.h>
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

struct Mpeg2Decoder {
  uint8_t *stream;
  size_t stream_size;
  size_t stream_offset;
  AVCodec *codec;
  AVCodecContext *context;
  AVFrame *picture;
  bool flushing;
  uint32_t decoded_frames;
  uint32_t loops;
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

static bool open_decoder(Mpeg2Decoder *decoder) {
  decoder->context = avcodec_alloc_context();
  decoder->picture = avcodec_alloc_frame();
  if (decoder->context == NULL || decoder->picture == NULL) {
    SYS_Report("REFERENCE GX: MPEG-2 decoder allocation failed\n");
    return false;
  }

  decoder->context->codec_type = AVMEDIA_TYPE_VIDEO;
  decoder->context->codec_id = CODEC_ID_MPEG2VIDEO;
  /*
   * MPlayer CE exposes this as lavdopts=fast=1. For MPEG-2 it selects the
   * unchecked fast intra-block decoder while retaining the artifact-free
   * non-intra path chosen by the GameCube port.
   */
  decoder->context->flags2 |= CODEC_FLAG2_FAST;
  if ((decoder->codec->capabilities & CODEC_CAP_TRUNCATED) != 0) {
    decoder->context->flags |= CODEC_FLAG_TRUNCATED;
  }
  if (avcodec_open(decoder->context, decoder->codec) < 0) {
    SYS_Report("REFERENCE GX: MPEG-2 decoder open failed\n");
    return false;
  }
  decoder->stream_offset = 0;
  decoder->flushing = false;
  return true;
}

static void rewind_decoder(Mpeg2Decoder *decoder) {
  avcodec_flush_buffers(decoder->context);
  decoder->stream_offset = 0;
  decoder->flushing = false;
  decoder->loops += 1;
  SYS_Report("REFERENCE GX: MPEG-2 stream loop=%u decoded=%u frames\n",
             decoder->loops, decoder->decoded_frames);
}

Mpeg2Decoder *mpeg2_decoder_create(const uint8_t *stream, size_t stream_size) {
  if (stream == NULL || stream_size == 0 ||
      stream_size > SIZE_MAX - FF_INPUT_BUFFER_PADDING_SIZE) {
    return NULL;
  }

  Mpeg2Decoder *decoder = calloc(1, sizeof(*decoder));
  if (decoder == NULL) {
    return NULL;
  }
  decoder->stream = malloc(stream_size + FF_INPUT_BUFFER_PADDING_SIZE);
  if (decoder->stream == NULL) {
    free(decoder);
    return NULL;
  }
  memcpy(decoder->stream, stream, stream_size);
  memset(decoder->stream + stream_size, 0, FF_INPUT_BUFFER_PADDING_SIZE);
  decoder->stream_size = stream_size;

  avcodec_init();
  avcodec_register(&ff_mpeg2video_decoder);
  av_log_set_level(AV_LOG_WARNING);
  av_log_set_callback(report_ffmpeg);
  decoder->codec = avcodec_find_decoder(CODEC_ID_MPEG2VIDEO);
  if (decoder->codec == NULL || !open_decoder(decoder)) {
    mpeg2_decoder_destroy(decoder);
    return NULL;
  }
  return decoder;
}

void mpeg2_decoder_destroy(Mpeg2Decoder *decoder) {
  if (decoder == NULL) {
    return;
  }
  if (decoder->context != NULL) {
    avcodec_close(decoder->context);
    av_free(decoder->context);
  }
  if (decoder->picture != NULL) {
    av_free(decoder->picture);
  }
  free(decoder->stream);
  free(decoder);
}

bool mpeg2_decoder_next_frame(Mpeg2Decoder *decoder, Mpeg2Frame *frame) {
  if (decoder == NULL || frame == NULL) {
    return false;
  }

  for (unsigned attempts = 0; attempts < 256; ++attempts) {
    AVPacket packet;
    av_init_packet(&packet);
    if (decoder->stream_offset < decoder->stream_size) {
      packet.data = decoder->stream + decoder->stream_offset;
      packet.size = (int)(decoder->stream_size - decoder->stream_offset);
    } else {
      packet.data = NULL;
      packet.size = 0;
      decoder->flushing = true;
    }

    int got_picture = 0;
    const int consumed = avcodec_decode_video2(
        decoder->context, decoder->picture, &got_picture, &packet);
    if (consumed < 0) {
      SYS_Report(
          "REFERENCE GX: MPEG-2 decode failed at byte %u after %u frames\n",
          (unsigned)decoder->stream_offset, decoder->decoded_frames);
      return false;
    }
    if (!decoder->flushing) {
      if (consumed == 0) {
        SYS_Report("REFERENCE GX: MPEG-2 decoder made no input progress\n");
        return false;
      }
      decoder->stream_offset += (size_t)consumed;
    }

    if (got_picture != 0) {
      if (decoder->context->width != 720 ||
          decoder->context->height != 480 ||
          decoder->context->pix_fmt != PIX_FMT_YUV420P ||
          decoder->picture->data[0] == NULL ||
          decoder->picture->data[1] == NULL ||
          decoder->picture->data[2] == NULL) {
        SYS_Report(
            "REFERENCE GX: unexpected MPEG-2 frame %dx%d pixel-format=%d\n",
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

    if (decoder->flushing) {
      rewind_decoder(decoder);
    }
  }

  SYS_Report("REFERENCE GX: MPEG-2 decoder exceeded progress limit\n");
  return false;
}
