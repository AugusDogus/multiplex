#include "poster_jpeg.h"

#include "gateway_client.h"

#include <gccore.h>
#include <ogc/mutex.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/mem.h>

extern AVCodec ff_mjpeg_decoder;

#define ATLAS_COLUMNS MULTIPLEX_GATEWAY_MAX_HOME_ITEMS

static mutex_t poster_decoder_mutex;
static bool poster_decoder_mutex_ready;

bool poster_jpeg_initialize(void) {
  if (poster_decoder_mutex_ready) {
    return true;
  }
  if (LWP_MutexInit(&poster_decoder_mutex, false) != 0) {
    SYS_Report("REFERENCE GX: poster JPEG decoder mutex unavailable\n");
    return false;
  }
  poster_decoder_mutex_ready = true;
  avcodec_init();
  avcodec_register(&ff_mjpeg_decoder);
  return true;
}

void poster_jpeg_shutdown(void) {
  if (poster_decoder_mutex_ready) {
    LWP_MutexDestroy(poster_decoder_mutex);
    poster_decoder_mutex_ready = false;
  }
}

static uint8_t clamp_byte(int value) {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return (uint8_t)value;
}

static uint16_t yuv_to_rgb565(uint8_t y, uint8_t u, uint8_t v,
                              bool full_range) {
  const int chroma_u = (int)u - 128;
  const int chroma_v = (int)v - 128;
  int red;
  int green;
  int blue;
  if (full_range) {
    red = (int)y + ((359 * chroma_v) >> 8);
    green = (int)y - ((88 * chroma_u + 183 * chroma_v) >> 8);
    blue = (int)y + ((454 * chroma_u) >> 8);
  } else {
    const int luma = (int)y - 16;
    red = (298 * luma + 409 * chroma_v + 128) >> 8;
    green = (298 * luma - 100 * chroma_u - 208 * chroma_v + 128) >> 8;
    blue = (298 * luma + 516 * chroma_u + 128) >> 8;
  }
  const uint8_t r = clamp_byte(red);
  const uint8_t g = clamp_byte(green);
  const uint8_t b = clamp_byte(blue);
  return (uint16_t)(((uint16_t)(r & 0xf8u) << 8u) |
                    ((uint16_t)(g & 0xfcu) << 3u) | (b >> 3u));
}

static void convert_cell(const AVFrame *picture, uint16_t item,
                         unsigned columns, unsigned crop_x, unsigned crop_y,
                         int chroma_h_shift, int chroma_v_shift,
                         bool full_range,
                         uint8_t *destination) {
  const unsigned cell_x =
      crop_x + (item % columns) * MULTIPLEX_GATEWAY_ARTWORK_WIDTH;
  const unsigned cell_y =
      crop_y + (item / columns) * MULTIPLEX_GATEWAY_ARTWORK_HEIGHT;
  for (unsigned y = 0; y < MULTIPLEX_GATEWAY_ARTWORK_HEIGHT; ++y) {
    for (unsigned x = 0; x < MULTIPLEX_GATEWAY_ARTWORK_WIDTH; ++x) {
      const unsigned source_x = cell_x + x;
      const unsigned source_y = cell_y + y;
      const uint8_t luma =
          picture->data[0][source_y * picture->linesize[0] + source_x];
      const uint8_t chroma_u = picture->data[1][
          (source_y >> chroma_v_shift) * picture->linesize[1] +
          (source_x >> chroma_h_shift)];
      const uint8_t chroma_v = picture->data[2][
          (source_y >> chroma_v_shift) * picture->linesize[2] +
          (source_x >> chroma_h_shift)];
      const uint16_t pixel =
          yuv_to_rgb565(luma, chroma_u, chroma_v, full_range);
      const size_t tile =
          ((size_t)(y / 4u) * (MULTIPLEX_GATEWAY_ARTWORK_WIDTH / 4u) +
           x / 4u) *
          32u;
      const size_t offset = tile + ((y & 3u) * 4u + (x & 3u)) * 2u;
      destination[offset] = (uint8_t)(pixel >> 8u);
      destination[offset + 1u] = (uint8_t)pixel;
    }
  }
}

static bool decode_jpeg(const uint8_t *encoded, size_t encoded_size,
                        uint16_t item_count, unsigned columns,
                        bool allow_center_crop, uint8_t *texture_pixels,
                        size_t texture_capacity) {
  const size_t required =
      (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (encoded == NULL || encoded_size == 0 || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS || columns == 0 ||
      columns > ATLAS_COLUMNS ||
      texture_pixels == NULL || texture_capacity < required ||
      encoded_size > INT32_MAX) {
    return false;
  }

  if (!poster_decoder_mutex_ready) {
    return false;
  }
  LWP_MutexLock(poster_decoder_mutex);
  AVCodec *codec = avcodec_find_decoder(CODEC_ID_MJPEG);
  AVCodecContext *context = avcodec_alloc_context();
  AVFrame *picture = avcodec_alloc_frame();
  bool decoded = false;
  if (codec == NULL || context == NULL || picture == NULL ||
      avcodec_open(context, codec) < 0) {
    SYS_Report("REFERENCE GX: poster JPEG decoder open failed\n");
    goto cleanup;
  }

  AVPacket packet;
  av_init_packet(&packet);
  packet.data = (uint8_t *)encoded;
  packet.size = (int)encoded_size;
  int got_picture = 0;
  const int consumed =
      avcodec_decode_video2(context, picture, &got_picture, &packet);
  const unsigned expected_width =
      columns * MULTIPLEX_GATEWAY_ARTWORK_WIDTH;
  const unsigned expected_rows =
      (item_count + columns - 1u) / columns;
  const unsigned expected_height =
      expected_rows * MULTIPLEX_GATEWAY_ARTWORK_HEIGHT;
  const bool dimensions_match =
      allow_center_crop
          ? context->width >= (int)expected_width &&
                context->height >= (int)expected_height
          : context->width == (int)expected_width &&
                context->height == (int)expected_height;
  const bool full_range =
      context->pix_fmt == PIX_FMT_YUVJ420P ||
      context->pix_fmt == PIX_FMT_YUVJ422P ||
      context->pix_fmt == PIX_FMT_YUVJ444P ||
      context->pix_fmt == PIX_FMT_YUVJ440P;
  const bool planar_yuv =
      full_range || context->pix_fmt == PIX_FMT_YUV420P ||
      context->pix_fmt == PIX_FMT_YUV422P ||
      context->pix_fmt == PIX_FMT_YUV444P ||
      context->pix_fmt == PIX_FMT_YUV440P;
  if (consumed < 0 || got_picture == 0 || !dimensions_match || !planar_yuv ||
      picture->data[0] == NULL || picture->data[1] == NULL ||
      picture->data[2] == NULL) {
    SYS_Report(
        "REFERENCE GX: invalid poster JPEG consumed=%d got=%d size=%dx%d format=%d expected=%ux%u\n",
        consumed, got_picture, context->width, context->height,
        context->pix_fmt, expected_width, expected_height);
    goto cleanup;
  }

  int chroma_h_shift = 0;
  int chroma_v_shift = 0;
  avcodec_get_chroma_sub_sample(context->pix_fmt, &chroma_h_shift,
                                &chroma_v_shift);
  const unsigned crop_x =
      allow_center_crop
          ? ((unsigned)context->width - expected_width) / 2u
          : 0u;
  const unsigned crop_y =
      allow_center_crop
          ? ((unsigned)context->height - expected_height) / 2u
          : 0u;
  for (uint16_t item = 0; item < item_count; ++item) {
    convert_cell(picture, item, columns, crop_x, crop_y, chroma_h_shift,
                 chroma_v_shift, full_range,
                 texture_pixels +
                     (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  }
  decoded = true;
  SYS_Report(
      "REFERENCE GX: poster-jpeg decoded=%u size=%dx%d format=%d consumed=%d\n",
      item_count, context->width, context->height, context->pix_fmt,
      consumed);

cleanup:
  if (context != NULL) {
    avcodec_close(context);
    av_free(context);
  }
  if (picture != NULL) {
    av_free(picture);
  }
  LWP_MutexUnlock(poster_decoder_mutex);
  return decoded;
}

bool poster_jpeg_decode(const uint8_t *encoded, size_t encoded_size,
                        uint16_t item_count, uint8_t *texture_pixels,
                        size_t texture_capacity) {
  return decode_jpeg(encoded, encoded_size, item_count,
                     MULTIPLEX_GATEWAY_MAX_ITEMS, false, texture_pixels,
                     texture_capacity);
}

bool poster_jpeg_decode_columns(const uint8_t *encoded, size_t encoded_size,
                                uint16_t item_count, unsigned columns,
                                uint8_t *texture_pixels,
                                size_t texture_capacity) {
  return decode_jpeg(encoded, encoded_size, item_count, columns, false,
                     texture_pixels, texture_capacity);
}

bool poster_jpeg_decode_single(const uint8_t *encoded, size_t encoded_size,
                               uint8_t *texture_pixels,
                               size_t texture_capacity) {
  return decode_jpeg(encoded, encoded_size, 1, 1, true, texture_pixels,
                     texture_capacity);
}
