#include "media_player.h"

#include <audsrv.h>
#include <dma.h>
#include <dma_tags.h>
#include <draw.h>
#include <fcntl.h>
#include <gif_tags.h>
#include <graph.h>
#include <gs_gp.h>
#include <gs_psm.h>
#include <kernel.h>
#include <libmpeg.h>
#include <libpad.h>
#include <malloc.h>
#include <packet.h>
#include <string.h>

typedef struct {
  MPEGSequenceInfo *sequence;
  void *pixels;
  packet_t *transfer;
  packet_t *draw;
  int texture_address;
} PlayerDisplay;

static const uint8_t *video_bytes;
static size_t video_size;
static size_t video_offset;

static size_t count_pictures(const uint8_t *bytes, size_t size) {
  size_t pictures = 0;
  for (size_t offset = 0; offset + 4u <= size; ++offset) {
    if (bytes[offset] == 0 && bytes[offset + 1u] == 0 &&
        bytes[offset + 2u] == 1 && bytes[offset + 3u] == 0) {
      ++pictures;
    }
  }
  return pictures;
}

static int feed_video(void *unused) {
  (void)unused;
  if (video_offset >= video_size) {
    return 0;
  }
  size_t length = video_size - video_offset;
  if (length > 2048) {
    length = 2048;
  }
  dma_channel_wait(DMA_CHANNEL_toIPU, 0);
  dma_channel_send_normal(DMA_CHANNEL_toIPU,
                          (void *)(video_bytes + video_offset), 2048 >> 4u, 0,
                          0);
  video_offset += length;
  return 1;
}

static void *initialize_sequence(void *context, MPEGSequenceInfo *sequence) {
  PlayerDisplay *display = context;
  const int pixel_size = sequence->m_Width * sequence->m_Height * 4;
  char *pixels = memalign(64, pixel_size);
  if (pixels == NULL) {
    return NULL;
  }
  const int macroblock_width = sequence->m_Width >> 4;
  const int macroblock_height = sequence->m_Height >> 4;
  const int texture_buffer_width = (sequence->m_Width + 63) >> 6;
  const int texture_width = draw_log2(sequence->m_Width);
  const int texture_height = draw_log2(sequence->m_Height);
  display->texture_address >>= 6;
  display->sequence = sequence;
  display->pixels = pixels;
  SyncDCache(pixels, pixels + pixel_size);

  display->transfer =
      packet_init((10 + 12 * macroblock_width * macroblock_height) >> 1,
                  PACKET_NORMAL);
  qword_t *packet = display->transfer->data;
  DMATAG_CNT(packet, 3, 0, 0, 0);
  ++packet;
  PACK_GIFTAG(packet, GIF_SET_TAG(2, 0, 0, 0, 0, 1), GIF_REG_AD);
  ++packet;
  PACK_GIFTAG(packet, GS_SET_TRXREG(16, 16), GS_REG_TRXREG);
  ++packet;
  PACK_GIFTAG(packet,
              GS_SET_BITBLTBUF(0, 0, 0, display->texture_address,
                               texture_buffer_width, GS_PSM_32),
              GS_REG_BITBLTBUF);
  ++packet;
  char *image = pixels;
  for (int y = 0; y < sequence->m_Height; y += 16) {
    for (int x = 0; x < sequence->m_Width; x += 16, image += 1024) {
      DMATAG_CNT(packet, 4, 0, 0, 0);
      ++packet;
      PACK_GIFTAG(packet, GIF_SET_TAG(2, 0, 0, 0, 0, 1), GIF_REG_AD);
      ++packet;
      PACK_GIFTAG(packet, GS_SET_TRXPOS(0, 0, x, y, 0), GS_REG_TRXPOS);
      ++packet;
      PACK_GIFTAG(packet, GS_SET_TRXDIR(0), GS_REG_TRXDIR);
      ++packet;
      PACK_GIFTAG(packet, GIF_SET_TAG(64, 1, 0, 0, 2, 0), 0);
      ++packet;
      DMATAG_REF(packet, 64, (unsigned)image, 0, 0, 0);
      ++packet;
    }
  }
  display->transfer->qwc = packet - display->transfer->data;

  display->draw = packet_init(7, PACKET_NORMAL);
  packet = display->draw->data;
  PACK_GIFTAG(packet, GIF_SET_TAG(6, 1, 0, 0, 0, 1), GIF_REG_AD);
  ++packet;
  PACK_GIFTAG(packet,
              GS_SET_TEX0(display->texture_address, texture_buffer_width,
                          GS_PSM_32, texture_width, texture_height, 1, 1, 0, 0,
                          0, 0, 0),
              GS_REG_TEX0_1);
  ++packet;
  PACK_GIFTAG(packet, GS_SET_PRIM(6, 0, 1, 0, 0, 0, 1, 0, 0), GS_REG_PRIM);
  ++packet;
  PACK_GIFTAG(packet, GS_SET_UV(0, 0), GS_REG_UV);
  ++packet;
  PACK_GIFTAG(packet, GS_SET_XYZ(2048 << 4, 2048 << 4, 0), GS_REG_XYZ2);
  ++packet;
  PACK_GIFTAG(packet,
              GS_SET_UV(sequence->m_Width << 4, sequence->m_Height << 4),
              GS_REG_UV);
  ++packet;
  PACK_GIFTAG(packet,
              GS_SET_XYZ((640 + 2048) << 4, (480 + 2048) << 4, 0),
              GS_REG_XYZ2);
  ++packet;
  display->draw->qwc = packet - display->draw->data;
  return pixels;
}

int multiplex_ps2_play_media(const uint8_t *video, size_t input_video_size,
                             const uint8_t *audio, size_t audio_size) {
  if (video == NULL || input_video_size == 0 || audio == NULL ||
      audio_size == 0) {
    return 0;
  }
  video_bytes = video;
  video_size = input_video_size;
  video_offset = 0;
  const size_t picture_count = count_pictures(video, input_video_size);
  if (picture_count < 2u) {
    return 0;
  }

  framebuffer_t frame = {.width = 640,
                         .height = 480,
                         .mask = 0,
                         .psm = GS_PSM_32,
                         .address = 0};
  frame.address = graph_vram_allocate(frame.width, frame.height, frame.psm,
                                      GRAPH_ALIGN_PAGE);
  zbuffer_t z = {.enable = 0, .mask = 0, .method = 0, .zsm = 0, .address = 0};
  packet_t *setup = packet_init(100, PACKET_NORMAL);
  if (setup == NULL) {
    return 0;
  }
  dma_channel_initialize(DMA_CHANNEL_toIPU, NULL, 0);
  dma_channel_initialize(DMA_CHANNEL_GIF, NULL, 0);
  dma_channel_fast_waits(DMA_CHANNEL_GIF);
  graph_initialize(0, 640, 480, GS_PSM_32, 0, 0);
  PlayerDisplay display = {0};
  display.texture_address = graph_vram_allocate(0, 0, GS_PSM_32,
                                                GRAPH_ALIGN_BLOCK);
  qword_t *packet = setup->data;
  packet = draw_setup_environment(packet, 0, &frame, &z);
  packet = draw_clear(packet, 0, 0, 0, 640.0f, 480.0f, 0, 0, 0);
  dma_channel_send_normal(DMA_CHANNEL_GIF, setup->data, packet - setup->data,
                          0, 0);

  audsrv_fmt_t format = {.freq = 48000, .bits = 16, .channels = 2};
  if (audsrv_init() != AUDSRV_ERR_NOERROR ||
      audsrv_set_format(&format) != AUDSRV_ERR_NOERROR) {
    return 0;
  }
  s64 current_pts = 0;
  MPEG_Initialize(feed_video, NULL, initialize_sequence, &display,
                  &current_pts);
  size_t audio_offset = 0;
  s64 picture_pts = 0;
  size_t frames = 0;
  const size_t frame_limit = picture_count < 3u ? picture_count - 1u : 2u;
  while (frames < frame_limit && MPEG_Picture(display.pixels, &picture_pts)) {
    size_t audio_chunk = audio_size - audio_offset;
    if (audio_chunk > 6400) {
      audio_chunk = 6400;
    }
    if (audio_chunk > 0 && audsrv_wait_audio((int)audio_chunk) == 0) {
      audsrv_play_audio((const char *)audio + audio_offset, (int)audio_chunk);
      audio_offset += audio_chunk;
    }
    dma_wait_fast();
    dma_channel_send_chain(DMA_CHANNEL_GIF, display.transfer->data,
                           display.transfer->qwc, 0, 0);
    graph_wait_vsync();
    graph_wait_vsync();
    dma_channel_send_normal(DMA_CHANNEL_GIF, display.draw->data,
                            display.draw->qwc, 0, 0);
    ++frames;
  }
  return frames > 0;
}
