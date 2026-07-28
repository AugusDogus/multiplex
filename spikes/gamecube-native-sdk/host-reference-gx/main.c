#include "audio_dma.h"
#include "gateway_client.h"
#include "http_client.h"
#include "media-source.h"
#include "native_ui.h"
#include "mpeg2_decoder.h"
#include "mpeg_ps_demux.h"
#include "multiplex-dvd-demo-program.h"
#include "poster_jpeg.h"
#include "yuv420_gx.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/cond.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/mutex.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define FIFO_SIZE (256 * 1024)
#define LOGICAL_WIDTH 640
#define LOGICAL_HEIGHT 480
#define TILE_WIDTH 160
#define TILE_HEIGHT 120
#define TILE_COLUMNS (LOGICAL_WIDTH / TILE_WIDTH)
#define TILE_ROWS (LOGICAL_HEIGHT / TILE_HEIGHT)
#define TILE_COUNT (TILE_COLUMNS * TILE_ROWS)
#define TILE_BYTES (TILE_WIDTH * TILE_HEIGHT * 4)
#define BUFFER_GUARD_BYTES 64
#define BUFFER_GUARD_VALUE 0xa5
#define APP_STACK_SIZE (512 * 1024)
#define VIDEO_DECODER_STACK_SIZE (256 * 1024)
#define VIDEO_WIDTH 720
#define VIDEO_HEIGHT 480
#define VIDEO_PROFILE_FRAMES 60
#define AUDIO_SAMPLE_RATE 48000
#define MPEG_PTS_RATE 90000
#define VIDEO_RATE_NUMERATOR 30000
#define VIDEO_RATE_DENOMINATOR 1001
#define VIDEO_PREBUFFER_BYTES (128u * 1024u)
#define AUDIO_PREBUFFER_BYTES (32u * 1024u)
#define POSTER_JPEG_CAPACITY (256u * 1024u)
#define HOME_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS
#define BROWSE_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_ITEMS
#define POSTER_TEXTURE_COUNT (HOME_POSTER_COUNT + BROWSE_POSTER_COUNT)

typedef struct {
  uint32_t render_us;
  uint32_t upload_us;
  uint32_t commands;
  uint32_t passes;
  uint32_t signature;
  uint32_t memo_hits;
  uint32_t memo_misses;
} FrameProfile;

static GXRModeObj *video_mode;
static void *framebuffers[2];
static unsigned framebuffer_index;
static void *gx_fifo;
static uint8_t *reference_pixels_allocation;
static uint8_t *reference_scratch_allocation;
static uint8_t *reference_pixels;
static uint8_t *reference_scratch;
static uint8_t *texture_pixels_allocation;
static uint8_t *texture_pixels;
static uint32_t reference_bytes;
static GXTexObj textures[TILE_COUNT];
static GXTexObj poster_textures[POSTER_TEXTURE_COUNT];
static uint8_t *poster_texture_pixels;
static uint16_t poster_texture_count;
static MultiplexVideoSurface video_surface;
static bool native_frame_dirty = true;
static FrameProfile profile;
static uint32_t presentation_frames;
static uint32_t presentation_started;
static uint32_t profile_stage_started;
static uint32_t profile_stage_current;
static uint32_t profile_stage_us[7];
static uint32_t video_frame_count;
static uint32_t video_frame_started;
static uint64_t video_audio_start_samples;
static uint32_t video_audio_start_completions;
static bool video_audio_clock_started;
static int64_t video_pts_offset_samples;
static uint32_t video_decode_total_us;
static uint32_t video_decode_max_us;
static uint32_t video_codec_total_us;
static uint32_t video_codec_max_us;
static uint32_t video_upload_total_us;
static uint32_t video_upload_max_us;
static Mpeg2Decoder *video_decoder;
static lwp_t video_decoder_thread = LWP_THREAD_NULL;
static void *video_decoder_stack;
static mutex_t video_decoder_mutex;
static cond_t video_decoder_condition;
static bool video_decoder_sync_ready;
static bool video_decode_requested;
static bool video_decode_running;
static bool video_decode_ready;
static bool video_decode_failed;
static bool video_decoder_stopping;
static uint32_t video_decode_ready_us;
static uint32_t video_codec_ready_us;
static uint32_t video_upload_ready_us;
static uint32_t video_decode_request_count;
static uint32_t video_decode_completion_count;
static bool video_texture_ready;
static bool video_was_playing;
static AudioDma *audio_output;
static MpegPsDemux *media_demux;

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size);

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  SYS_Report(
      "REFERENCE GX: input action=%u focus=%u count=%u message=%u\n", action,
      focus, count, message);
}

void *multiplex_native_cache_alloc(uint32_t len, uint32_t alignment) {
  if (len == 0 || alignment == 0 || (alignment & (alignment - 1u)) != 0) {
    return NULL;
  }
  if (alignment < sizeof(void *)) {
    alignment = sizeof(void *);
  }
  const uint32_t overhead = alignment - 1u + sizeof(void *);
  if (len > UINT32_MAX - overhead) {
    return NULL;
  }
  uint8_t *allocation = malloc(len + overhead);
  if (allocation == NULL) {
    return NULL;
  }
  const uintptr_t aligned =
      ((uintptr_t)allocation + sizeof(void *) + alignment - 1u) &
      ~(uintptr_t)(alignment - 1u);
  ((void **)aligned)[-1] = allocation;
  return (void *)aligned;
}

void multiplex_native_cache_free(void *memory) {
  if (memory != NULL) {
    free(((void **)memory)[-1]);
  }
}

void multiplex_native_profile_mark(uint32_t stage) {
  const uint32_t now = gettick();
  if (profile_stage_current >= 1 && profile_stage_current <= 6) {
    profile_stage_us[profile_stage_current] +=
        (uint32_t)ticks_to_microsecs(now - profile_stage_started);
  }
  profile_stage_current = stage == 7 ? 0 : stage;
  profile_stage_started = now;
}

static uint32_t hash_bytes(const uint8_t *bytes, uint32_t length) {
  uint32_t hash = 2166136261u;
  for (uint32_t index = 0; index < length; ++index) {
    hash ^= bytes[index];
    hash *= 16777619u;
  }
  return hash;
}

static bool guard_is_intact(const uint8_t *allocation,
                            uint32_t payload_bytes) {
  for (unsigned index = 0; index < BUFFER_GUARD_BYTES; ++index) {
    if (allocation[index] != BUFFER_GUARD_VALUE ||
        allocation[BUFFER_GUARD_BYTES + payload_bytes + index] !=
            BUFFER_GUARD_VALUE) {
      return false;
    }
  }
  return true;
}

static bool allocate_buffers(void) {
  reference_bytes = multiplex_native_reference_pixel_bytes();
  if (reference_bytes != LOGICAL_WIDTH * LOGICAL_HEIGHT * 4u) {
    SYS_Report("REFERENCE GX: unexpected framebuffer size %u\n",
               reference_bytes);
    return false;
  }

  const uint32_t guarded_bytes = reference_bytes + 2u * BUFFER_GUARD_BYTES;
  reference_pixels_allocation = malloc(guarded_bytes);
  reference_scratch_allocation = malloc(guarded_bytes);
  texture_pixels_allocation = malloc(TILE_COUNT * TILE_BYTES + 31u);
  if (reference_pixels_allocation == NULL ||
      reference_scratch_allocation == NULL ||
      texture_pixels_allocation == NULL) {
    SYS_Report("REFERENCE GX: buffer allocation failed\n");
    return false;
  }

  reference_pixels = reference_pixels_allocation + BUFFER_GUARD_BYTES;
  reference_scratch = reference_scratch_allocation + BUFFER_GUARD_BYTES;
  texture_pixels =
      (uint8_t *)(((uintptr_t)texture_pixels_allocation + 31u) &
                  ~(uintptr_t)31u);
  memset(reference_pixels_allocation, BUFFER_GUARD_VALUE, guarded_bytes);
  memset(reference_scratch_allocation, BUFFER_GUARD_VALUE, guarded_bytes);
  memset(reference_pixels, 0, reference_bytes);
  memset(reference_scratch, 0, reference_bytes);
  memset(texture_pixels, 0, TILE_COUNT * TILE_BYTES);
  return true;
}

static void profile_decoded_frame(uint32_t decode_us, uint32_t codec_us,
                                  uint32_t upload_us) {
  video_decode_total_us += decode_us;
  if (decode_us > video_decode_max_us) {
    video_decode_max_us = decode_us;
  }
  video_codec_total_us += codec_us;
  if (codec_us > video_codec_max_us) {
    video_codec_max_us = codec_us;
  }
  video_upload_total_us += upload_us;
  if (upload_us > video_upload_max_us) {
    video_upload_max_us = upload_us;
  }
  if (video_frame_count == 0) {
    video_frame_started = gettick();
  }
  video_frame_count += 1;
  if (video_frame_count == VIDEO_PROFILE_FRAMES) {
    const uint32_t measured_us = elapsed_us(video_frame_started);
    const uint32_t fps_tenths =
        measured_us == 0
            ? 0
            : (uint32_t)(((VIDEO_PROFILE_FRAMES - 1u) * 10000000ull) /
                         measured_us);
    SYS_Report(
        "REFERENCE GX: decoder=%u frames/%uus (%u.%u fps) "
        "work=%u avg/%u max us codec=%u/%u upload=%u/%u\n",
        VIDEO_PROFILE_FRAMES, measured_us, fps_tenths / 10, fps_tenths % 10,
        video_decode_total_us / VIDEO_PROFILE_FRAMES, video_decode_max_us,
        video_codec_total_us / VIDEO_PROFILE_FRAMES, video_codec_max_us,
        video_upload_total_us / VIDEO_PROFILE_FRAMES, video_upload_max_us);
    video_frame_count = 0;
    video_decode_total_us = 0;
    video_decode_max_us = 0;
    video_codec_total_us = 0;
    video_codec_max_us = 0;
    video_upload_total_us = 0;
    video_upload_max_us = 0;
  }
}

static void *run_video_decoder(void *unused) {
  (void)unused;

  LWP_MutexLock(video_decoder_mutex);
  while (!video_decoder_stopping) {
    while (!video_decode_requested && !video_decoder_stopping) {
      LWP_CondWait(video_decoder_condition, video_decoder_mutex);
    }
    if (video_decoder_stopping) {
      break;
    }

    video_decode_requested = false;
    LWP_MutexUnlock(video_decoder_mutex);

    const uint32_t decode_started = gettick();
    Mpeg2Frame frame;
    const bool frame_decoded =
        mpeg2_decoder_next_frame(video_decoder, &frame);
    const uint32_t codec_us = elapsed_us(decode_started);
    const uint32_t upload_started = gettick();
    const bool decoded = frame_decoded && yuv420_gx_upload_back(&frame);
    const uint32_t upload_us = elapsed_us(upload_started);
    const uint32_t decode_us = elapsed_us(decode_started);

    LWP_MutexLock(video_decoder_mutex);
    video_decode_running = false;
    if (video_decoder_stopping) {
      continue;
    }
    if (decoded) {
      video_decode_ready = true;
      video_decode_ready_us = decode_us;
      video_codec_ready_us = codec_us;
      video_upload_ready_us = upload_us;
      video_decode_completion_count += 1;
    } else {
      video_decode_failed = true;
    }
  }
  LWP_MutexUnlock(video_decoder_mutex);
  return NULL;
}

static void stop_video_decoder(void);

static void request_video_decoder_stop(void) {
  if (video_decoder_thread == LWP_THREAD_NULL ||
      !video_decoder_sync_ready) {
    return;
  }
  LWP_MutexLock(video_decoder_mutex);
  video_decoder_stopping = true;
  LWP_CondSignal(video_decoder_condition);
  LWP_MutexUnlock(video_decoder_mutex);
}

static bool start_video_decoder(void *reader_context, MediaRead read,
                                size_t stream_size) {
  video_decode_requested = false;
  video_decode_running = false;
  video_decode_ready = false;
  video_decode_failed = false;
  video_decoder_stopping = false;
  video_decode_ready_us = 0;
  video_codec_ready_us = 0;
  video_upload_ready_us = 0;
  video_decode_request_count = 0;
  video_decode_completion_count = 0;
  video_texture_ready = false;
  video_audio_clock_started = false;
  video_was_playing = false;
  video_frame_count = 0;
  video_decode_total_us = 0;
  video_decode_max_us = 0;
  video_codec_total_us = 0;
  video_codec_max_us = 0;
  video_upload_total_us = 0;
  video_upload_max_us = 0;
  video_decoder = mpeg2_decoder_create(reader_context, read);
  if (video_decoder == NULL) {
    SYS_Report("REFERENCE GX: MPEG-2 decoder initialization failed\n");
    return false;
  }
  if (!yuv420_gx_initialize(VIDEO_WIDTH, VIDEO_HEIGHT)) {
    SYS_Report("REFERENCE GX: YUV texture allocation failed\n");
    mpeg2_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  if (LWP_MutexInit(&video_decoder_mutex, false) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: mutex init\n");
    yuv420_gx_destroy();
    mpeg2_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  if (LWP_CondInit(&video_decoder_condition) != 0) {
    LWP_MutexDestroy(video_decoder_mutex);
    SYS_Report("REFERENCE GX: decoder failure: condition init\n");
    yuv420_gx_destroy();
    mpeg2_decoder_destroy(video_decoder);
    video_decoder = NULL;
    return false;
  }
  video_decoder_sync_ready = true;
  video_decoder_stack = malloc(VIDEO_DECODER_STACK_SIZE);
  if (video_decoder_stack == NULL) {
    SYS_Report("REFERENCE GX: decoder failure: stack allocation\n");
    stop_video_decoder();
    return false;
  }
  if (LWP_CreateThread(&video_decoder_thread, run_video_decoder, NULL,
                       video_decoder_stack, VIDEO_DECODER_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) != 0) {
    SYS_Report("REFERENCE GX: decoder failure: thread creation\n");
    stop_video_decoder();
    return false;
  }
  SYS_Report(
      "REFERENCE GX: decoder=ffmpeg-mplayer-ce codec=mpeg2video "
      "input=%ux%u pixel-format=yuv420p rate=30000/1001 fps size=%u bytes\n",
      VIDEO_WIDTH, VIDEO_HEIGHT, (unsigned)stream_size);
  return true;
}

static void stop_video_decoder(void) {
  if (video_decoder_thread != LWP_THREAD_NULL) {
    request_video_decoder_stop();
    LWP_JoinThread(video_decoder_thread, NULL);
    video_decoder_thread = LWP_THREAD_NULL;
  }
  free(video_decoder_stack);
  video_decoder_stack = NULL;
  if (video_decoder_sync_ready) {
    LWP_CondDestroy(video_decoder_condition);
    LWP_MutexDestroy(video_decoder_mutex);
    video_decoder_sync_ready = false;
  }
  yuv420_gx_destroy();
  mpeg2_decoder_destroy(video_decoder);
  video_decoder = NULL;
}

static void convert_reference_to_rgba8_tiles(void) {
  for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
    for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      uint8_t *tile = texture_pixels + tile_index * TILE_BYTES;

      for (unsigned block_y = 0; block_y < TILE_HEIGHT / 4; ++block_y) {
        for (unsigned block_x = 0; block_x < TILE_WIDTH / 4; ++block_x) {
          uint8_t *block =
              tile + (block_y * (TILE_WIDTH / 4) + block_x) * 64;
          for (unsigned inner_y = 0; inner_y < 4; ++inner_y) {
            for (unsigned inner_x = 0; inner_x < 4; ++inner_x) {
              const unsigned source_x =
                  tile_x * TILE_WIDTH + block_x * 4 + inner_x;
              const unsigned source_y =
                  tile_y * TILE_HEIGHT + block_y * 4 + inner_y;
              const uint8_t *source =
                  reference_pixels +
                  (source_y * LOGICAL_WIDTH + source_x) * 4;
              const unsigned plane_offset = (inner_y * 4 + inner_x) * 2;

              block[plane_offset] = source[3];
              block[plane_offset + 1] = source[0];
              block[32 + plane_offset] = source[1];
              block[32 + plane_offset + 1] = source[2];
            }
          }
        }
      }
    }
  }
  DCFlushRange(texture_pixels, TILE_COUNT * TILE_BYTES);
}

static bool refresh_reference_frame(bool initialize) {
  const uint32_t render_started = gettick();
  const uint32_t memo_hits_before = multiplex_native_reference_memo_hits();
  const uint32_t memo_misses_before =
      multiplex_native_reference_memo_misses();
  memset(profile_stage_us, 0, sizeof(profile_stage_us));
  profile_stage_current = 0;

  const uint32_t commands =
      initialize
          ? multiplex_native_app_init_and_render_reference(
                reference_pixels, reference_bytes, reference_scratch,
                reference_bytes)
          : multiplex_native_app_render_reference(
                reference_pixels, reference_bytes, reference_scratch,
                reference_bytes);
  if (!guard_is_intact(reference_pixels_allocation, reference_bytes) ||
      !guard_is_intact(reference_scratch_allocation, reference_bytes)) {
    SYS_Report("REFERENCE GX: Native renderer buffer guard corrupted\n");
    return false;
  }
  if (commands == 0) {
    SYS_Report("REFERENCE GX: Native renderer returned no commands at "
               "stage %08x\n",
               multiplex_native_reference_render_stage());
    return false;
  }
  profile.commands = commands;
  profile.passes = 1;
  profile.signature = hash_bytes(reference_pixels, reference_bytes);
  profile.render_us = elapsed_us(render_started);
  profile.memo_hits =
      multiplex_native_reference_memo_hits() - memo_hits_before;
  profile.memo_misses =
      multiplex_native_reference_memo_misses() - memo_misses_before;

  const uint32_t upload_started = gettick();
  convert_reference_to_rgba8_tiles();
  profile.upload_us = elapsed_us(upload_started);
  native_frame_dirty = false;
  MultiplexVideoSurface rendered_surface;
  memset(&rendered_surface, 0, sizeof(rendered_surface));
  if (multiplex_native_video_surface(&rendered_surface) != 0) {
    SYS_Report(
        "REFERENCE GX: video-surface x=%d y=%d width=%d height=%d playing=%u\n",
        (int)rendered_surface.x, (int)rendered_surface.y,
        (int)rendered_surface.width, (int)rendered_surface.height,
        rendered_surface.playing);
  }
  SYS_Report(
      "REFERENCE GX: commands=%u passes=%u signature=%08x render=%uus "
      "conversion=%uus stages=%u/%u/%u/%u/%u/%uus memo=%u/%u "
      "cache=%u/%uKiB\n",
      profile.commands, profile.passes, profile.signature, profile.render_us,
      profile.upload_us, profile_stage_us[1], profile_stage_us[2],
      profile_stage_us[3], profile_stage_us[4], profile_stage_us[5],
      profile_stage_us[6], profile.memo_hits, profile.memo_misses,
      multiplex_native_reference_memo_bytes() / 1024u,
      multiplex_native_reference_memo_peak_bytes() / 1024u);
  return true;
}

static GXRModeObj *select_video_mode(void) {
  GXRModeObj *preferred = VIDEO_GetPreferredMode(NULL);
  if (!VIDEO_HaveComponentCable()) {
    return preferred;
  }

  switch (preferred->viTVMode >> 2) {
    case VI_PAL:
      return &TVPal576ProgScale;
    case VI_EURGB60:
      return &TVEurgb60Hz480Prog;
    default:
      return &TVNtsc480Prog;
  }
}

static void configure_ui_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX, GX_LIGHTNULL,
                 GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(1);
  GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX2x4, GX_TG_TEX0, GX_IDENTITY);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORD0, GX_TEXMAP0, GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_REPLACE);
}

static void initialize_video_and_gx(void) {
  VIDEO_Init();
  PAD_Init();
  video_mode = select_video_mode();
  const uint32_t framebuffer_bytes = VIDEO_GetFrameBufferSize(video_mode);
  for (unsigned index = 0; index < 2; ++index) {
    framebuffers[index] =
        MEM_K0_TO_K1(SYS_AllocateFramebuffer(video_mode));
    memset(framebuffers[index], 0, framebuffer_bytes);
  }
  framebuffer_index = 1;

  SYS_Report(
      "REFERENCE GX: video mode=%08x progressive=%u component=%u "
      "fb=%ux%u efb=%u xfb=%u vi=%ux%u xfb_mode=%u fields=%u aa=%u\n",
      video_mode->viTVMode,
      (video_mode->viTVMode & 3) == VI_PROGRESSIVE,
      VIDEO_HaveComponentCable(), video_mode->fbWidth,
      video_mode->xfbHeight, video_mode->efbHeight,
      video_mode->xfbHeight, video_mode->viWidth, video_mode->viHeight,
      video_mode->xfbMode, video_mode->field_rendering, video_mode->aa);

  VIDEO_Configure(video_mode);
  VIDEO_SetNextFramebuffer(framebuffers[0]);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  if ((video_mode->viTVMode & VI_NON_INTERLACE) != 0) {
    VIDEO_WaitVSync();
  }

  gx_fifo = memalign(32, FIFO_SIZE);
  memset(gx_fifo, 0, FIFO_SIZE);
  GX_Init(gx_fifo, FIFO_SIZE);
  GX_SetCopyClear((GXColor){10, 10, 12, 255}, 0x00ffffff);
  GX_SetViewport(0, 0, video_mode->fbWidth, video_mode->efbHeight, 0, 1);
  const float y_scale =
      GX_GetYScaleFactor(video_mode->efbHeight, video_mode->xfbHeight);
  const uint16_t xfb_height = GX_SetDispCopyYScale(y_scale);
  GX_SetDispCopySrc(0, 0, video_mode->fbWidth, video_mode->efbHeight);
  GX_SetDispCopyDst(video_mode->fbWidth, xfb_height);
  GX_SetCopyFilter(video_mode->aa, video_mode->sample_pattern, GX_TRUE,
                   video_mode->vfilter);
  GX_SetFieldMode(video_mode->field_rendering,
                  ((video_mode->viHeight == 2 * video_mode->xfbHeight)
                       ? GX_ENABLE
                       : GX_DISABLE));
  GX_SetPixelFmt(video_mode->aa ? GX_PF_RGB565_Z16 : GX_PF_RGB8_Z24,
                 GX_ZC_LINEAR);
  GX_SetCullMode(GX_CULL_NONE);
  GX_SetZMode(GX_FALSE, GX_ALWAYS, GX_FALSE);
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
  GX_SetAlphaUpdate(GX_TRUE);
  GX_SetColorUpdate(GX_TRUE);

  configure_ui_pipeline();

  Mtx identity;
  guMtxIdentity(identity);
  GX_LoadPosMtxImm(identity, GX_PNMTX0);
  GX_SetCurrentMtx(GX_PNMTX0);
  Mtx44 projection;
  guOrtho(projection, 0.0f, (float)(LOGICAL_HEIGHT - 1), 0.0f,
          (float)(LOGICAL_WIDTH - 1), 0.0f, 1.0f);
  GX_LoadProjectionMtx(projection, GX_ORTHOGRAPHIC);
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
  GX_CopyDisp(framebuffers[0], GX_TRUE);
  GX_DrawDone();
}

static void initialize_textures(void) {
  for (unsigned index = 0; index < TILE_COUNT; ++index) {
    GX_InitTexObj(&textures[index], texture_pixels + index * TILE_BYTES,
                  TILE_WIDTH, TILE_HEIGHT, GX_TF_RGBA8, GX_CLAMP, GX_CLAMP,
                  GX_FALSE);
    GX_InitTexObjLOD(&textures[index], GX_NEAR, GX_NEAR, 0, 0, 0, GX_FALSE,
                     GX_FALSE, GX_ANISO_1);
  }
}

static bool initialize_poster_textures(const char *gateway_url,
                                       uint16_t item_count) {
  if (gateway_url == NULL || item_count == 0 ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS) {
    return false;
  }
  const size_t home_bytes =
      (size_t)item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  const size_t total_bytes =
      (size_t)POSTER_TEXTURE_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  poster_texture_pixels = multiplex_native_cache_alloc(total_bytes, 32);
  size_t encoded_size = 0;
  if (encoded == NULL || poster_texture_pixels == NULL ||
      !multiplex_gateway_load_artwork(gateway_url, encoded,
                                     POSTER_JPEG_CAPACITY, &encoded_size) ||
      !poster_jpeg_decode(encoded, encoded_size, item_count,
                          poster_texture_pixels, home_bytes)) {
    free(encoded);
    multiplex_native_cache_free(poster_texture_pixels);
    poster_texture_pixels = NULL;
    return false;
  }

  for (uint16_t item = 0; item < item_count; ++item) {
    uint8_t *destination = poster_texture_pixels +
                           (size_t)item *
                               MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    GX_InitTexObj(&poster_textures[item], destination,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&poster_textures[item], GX_LINEAR, GX_LINEAR, 0, 0, 0,
                     GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  free(encoded);
  DCFlushRange(poster_texture_pixels, home_bytes);
  poster_texture_count = POSTER_TEXTURE_COUNT;
  SYS_Report("REFERENCE GX: poster-textures count=%u size=%ux%u\n",
             item_count, MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
             MULTIPLEX_GATEWAY_ARTWORK_HEIGHT);
  return true;
}

static bool load_browse_page(const char *gateway_url) {
  uint32_t requested_section = 0;
  uint32_t requested_start = 0;
  if (multiplex_native_app_browse_request(&requested_section,
                                          &requested_start) == 0) {
    return true;
  }
  if (requested_section > UINT16_MAX || requested_start > UINT16_MAX) {
    return false;
  }

  MultiplexGatewayBrowsePage page;
  if (!multiplex_gateway_load_browse(gateway_url, (uint16_t)requested_section,
                                     (uint16_t)requested_start, &page)) {
    return false;
  }
  uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
  size_t encoded_size = 0;
  uint8_t *browse_pixels =
      poster_texture_pixels +
      (size_t)HOME_POSTER_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  const size_t browse_bytes =
      (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (encoded == NULL || poster_texture_pixels == NULL ||
      !multiplex_gateway_load_browse_artwork(
          gateway_url, page.section_id, page.start, encoded,
          POSTER_JPEG_CAPACITY, &encoded_size) ||
      !poster_jpeg_decode(encoded, encoded_size, page.item_count,
                          browse_pixels, browse_bytes)) {
    free(encoded);
    return false;
  }
  free(encoded);
  for (uint16_t item = 0; item < page.item_count; ++item) {
    uint8_t *pixels =
        browse_pixels +
        (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    GX_InitTexObj(&poster_textures[HOME_POSTER_COUNT + item], pixels,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&poster_textures[HOME_POSTER_COUNT + item], GX_LINEAR,
                     GX_LINEAR, 0, 0, 0, GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  DCFlushRange(browse_pixels, browse_bytes);

  if (multiplex_native_app_browse_begin(
          page.section_id, (const uint8_t *)page.title, page.title_length,
          page.start, page.total_size, page.item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page.item_count; ++index) {
    const MultiplexGatewayItem *item = &page.items[index];
    if (multiplex_native_app_browse_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  if (multiplex_native_app_browse_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: browse-page ready section=%u start=%u items=%u\n",
             page.section_id, page.start, page.item_count);
  return true;
}

static bool load_search_page(const char *gateway_url) {
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY] = {0};
  const uint32_t query_length = multiplex_native_app_search_request(
      (uint8_t *)query, sizeof(query) - 1u);
  if (query_length == 0) {
    return true;
  }
  if (query_length >= sizeof(query)) {
    return false;
  }

  MultiplexGatewaySearchPage page;
  if (!multiplex_gateway_load_search(gateway_url, query,
                                     (uint16_t)query_length, &page)) {
    return false;
  }

  uint8_t *browse_pixels =
      poster_texture_pixels +
      (size_t)HOME_POSTER_COUNT * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  if (page.item_count > 0) {
    uint8_t *encoded = calloc(1, POSTER_JPEG_CAPACITY + 64u);
    size_t encoded_size = 0;
    const size_t search_bytes =
        (size_t)page.item_count * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    if (encoded == NULL || poster_texture_pixels == NULL ||
        !multiplex_gateway_load_search_artwork(
            gateway_url, query, (uint16_t)query_length, encoded,
            POSTER_JPEG_CAPACITY, &encoded_size) ||
        !poster_jpeg_decode(encoded, encoded_size, page.item_count,
                            browse_pixels, search_bytes)) {
      free(encoded);
      return false;
    }
    free(encoded);
    for (uint16_t item = 0; item < page.item_count; ++item) {
      uint8_t *pixels =
          browse_pixels +
          (size_t)item * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
      GX_InitTexObj(&poster_textures[HOME_POSTER_COUNT + item], pixels,
                    MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                    MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                    GX_CLAMP, GX_FALSE);
      GX_InitTexObjLOD(&poster_textures[HOME_POSTER_COUNT + item], GX_LINEAR,
                       GX_LINEAR, 0, 0, 0, GX_FALSE, GX_FALSE, GX_ANISO_1);
    }
    DCFlushRange(browse_pixels, search_bytes);
  }

  if (multiplex_native_app_search_begin(
          (const uint8_t *)page.query, page.query_length, page.item_count) ==
      0) {
    return false;
  }
  for (uint16_t index = 0; index < page.item_count; ++index) {
    const MultiplexGatewayItem *item = &page.items[index];
    if (multiplex_native_app_search_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  if (multiplex_native_app_search_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: search-page ready query=%.*s items=%u\n",
             page.query_length, page.query, page.item_count);
  return true;
}

static bool load_item_details(const char *gateway_url) {
  const uint32_t rating_key = multiplex_native_app_details_request();
  if (rating_key == 0) {
    return true;
  }
  MultiplexGatewayDetails details;
  if (!multiplex_gateway_load_details(gateway_url, rating_key, &details)) {
    if (multiplex_native_app_details_fail() == 0) {
      return false;
    }
    SYS_Report("REFERENCE GX: details-page unavailable rating-key=%u\n",
               rating_key);
    return true;
  }

  char facts[MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY] = {0};
  const uint32_t minutes =
      details.duration_ms == 0 ? 0 : (details.duration_ms + 30000u) / 60000u;
  int facts_length = 0;
  if (details.year != 0 && minutes != 0 && details.rating_tenths != 0) {
    facts_length = snprintf(facts, sizeof(facts),
                            "%u | %u min | Rating %u.%u/10", details.year,
                            minutes, details.rating_tenths / 10u,
                            details.rating_tenths % 10u);
  } else if (details.year != 0 && minutes != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u | %u min", details.year,
                            minutes);
  } else if (minutes != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u min", minutes);
  } else if (details.year != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u", details.year);
  }
  if (facts_length < 0 || (size_t)facts_length >= sizeof(facts)) {
    return false;
  }

  if (multiplex_native_app_details_commit(
          (const uint8_t *)details.title, details.title_length,
          (const uint8_t *)details.secondary, details.secondary_length,
          (const uint8_t *)details.media_type, details.media_type_length,
          (const uint8_t *)details.library, details.library_length,
          (const uint8_t *)details.content_rating,
          details.content_rating_length, (const uint8_t *)facts,
          (uint32_t)facts_length, (const uint8_t *)details.summary,
          details.summary_length, (const uint8_t *)details.genres,
          details.genres_length, (const uint8_t *)details.directors,
          details.directors_length, (details.flags & 1u) != 0) == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: details-page ready rating-key=%u title=%s\n",
             rating_key, details.title);
  return true;
}

static void close_media_session(HttpClient **client, MpegPsDemux **demux) {
  if (audio_output != NULL) {
    audio_dma_request_stop(audio_output);
  }
  request_video_decoder_stop();
  if (*demux != NULL) {
    mpeg_ps_demux_stop(*demux);
  }
  audio_dma_destroy(audio_output);
  audio_output = NULL;
  stop_video_decoder();
  if (*demux != NULL) {
    SYS_Report("REFERENCE GX: media producer loops=%u\n",
               mpeg_ps_demux_loop_count(*demux));
    mpeg_ps_demux_destroy(*demux);
    *demux = NULL;
  }
  media_demux = NULL;
  http_client_destroy(*client);
  *client = NULL;
}

static bool start_media_pipeline(MpegPsDemux *demux, uint32_t rating_key) {
  const int64_t pts_delta =
      mpeg_ps_demux_first_video_pts90k(demux) -
      mpeg_ps_demux_first_audio_pts90k(demux);
  if (pts_delta >= 0) {
    video_pts_offset_samples =
        (pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) / MPEG_PTS_RATE;
  } else {
    video_pts_offset_samples =
        -((-pts_delta * AUDIO_SAMPLE_RATE + MPEG_PTS_RATE / 2) /
          MPEG_PTS_RATE);
  }
  if (!start_video_decoder(demux, mpeg_ps_demux_read_video,
                           mpeg_ps_demux_video_size(demux))) {
    return false;
  }
  audio_output = audio_dma_create(demux, mpeg_ps_demux_read_audio);
  if (audio_output == NULL) {
    SYS_Report("REFERENCE GX: audio initialization failed rating-key=%u\n",
               rating_key);
    stop_video_decoder();
    return false;
  }
  if (!mpeg_ps_demux_start(demux)) {
    SYS_Report("REFERENCE GX: media producer initialization failed rating-key=%u\n",
               rating_key);
    audio_dma_destroy(audio_output);
    audio_output = NULL;
    stop_video_decoder();
    return false;
  }
  media_demux = demux;
  return true;
}

static bool open_media_session(
    const MultiplexGatewayPlaybackManifest *manifest, HttpClient **client_out,
    MpegPsDemux **demux_out) {
  HttpClient *client = http_client_open(manifest->media_url);
  if (client == NULL) {
    SYS_Report("REFERENCE GX: HTTP media initialization failed rating-key=%u\n",
               manifest->rating_key);
    return false;
  }
  const MpegPsInfo info = {
      .video_stream_id = 0xe0,
      .audio_stream_id = 0xc0,
      .video_size = manifest->video_bytes,
      .audio_size = manifest->audio_bytes,
      .video_packets = manifest->video_packets,
      .audio_packets = manifest->audio_packets,
      .first_video_pts90k = manifest->first_video_pts90k,
      .first_audio_pts90k = manifest->first_audio_pts90k,
  };
  MpegPsDemux *demux = mpeg_ps_demux_create_reader_with_info(
      client, http_client_size(client), read_http_program, &info);
  if (demux == NULL) {
    SYS_Report("REFERENCE GX: MPEG-PS demux initialization failed rating-key=%u\n",
               manifest->rating_key);
    http_client_destroy(client);
    return false;
  }
  SYS_Report(
      "REFERENCE GX: media-source=http rating-key=%u host=%s port=%u "
      "bytes=%u ranges=%u\n",
      manifest->rating_key, http_client_host(client), http_client_port(client),
      (unsigned)http_client_size(client), http_client_range_count(client));
  http_client_begin_stream(client);
  if (!start_media_pipeline(demux, manifest->rating_key)) {
    mpeg_ps_demux_destroy(demux);
    http_client_destroy(client);
    return false;
  }
  *client_out = client;
  *demux_out = demux;
  return true;
}

static bool open_initial_media_session(HttpClient **client_out,
                                       MpegPsDemux **demux_out) {
  HttpClient *client = NULL;
  MpegPsDemux *demux = NULL;
  if (MULTIPLEX_MEDIA_URL[0] != '\0') {
    client = http_client_open(MULTIPLEX_MEDIA_URL);
    if (client == NULL) {
      SYS_Report("REFERENCE GX: HTTP media initialization failed\n");
      return false;
    }
    if (MULTIPLEX_MEDIA_HAS_INFO != 0) {
      const MpegPsInfo info = {
          .video_stream_id = 0xe0,
          .audio_stream_id = 0xc0,
          .video_size = MULTIPLEX_MEDIA_VIDEO_BYTES,
          .audio_size = MULTIPLEX_MEDIA_AUDIO_BYTES,
          .video_packets = MULTIPLEX_MEDIA_VIDEO_PACKETS,
          .audio_packets = MULTIPLEX_MEDIA_AUDIO_PACKETS,
          .first_video_pts90k = MULTIPLEX_MEDIA_VIDEO_PTS90K,
          .first_audio_pts90k = MULTIPLEX_MEDIA_AUDIO_PTS90K,
      };
      demux = mpeg_ps_demux_create_reader_with_info(
          client, http_client_size(client), read_http_program, &info);
    } else {
      demux = mpeg_ps_demux_create_reader(
          client, http_client_size(client), read_http_program);
    }
    SYS_Report(
        "REFERENCE GX: media-source=http rating-key=0 host=%s port=%u "
        "bytes=%u ranges=%u\n",
        http_client_host(client), http_client_port(client),
        (unsigned)http_client_size(client), http_client_range_count(client));
    http_client_begin_stream(client);
  } else {
    if (MULTIPLEX_GATEWAY_URL[0] != '\0') {
      SYS_Report("REFERENCE GX: gateway playback manifest unavailable\n");
      return false;
    }
    SYS_Report("REFERENCE GX: media-source=embedded bytes=%u\n",
               multiplex_dvd_demo_mpg_size);
    demux = mpeg_ps_demux_create(
        multiplex_dvd_demo_mpg, (size_t)multiplex_dvd_demo_mpg_size);
  }
  if (demux == NULL) {
    SYS_Report("REFERENCE GX: MPEG-PS demux initialization failed\n");
    http_client_destroy(client);
    return false;
  }
  if (!start_media_pipeline(demux, 0)) {
    mpeg_ps_demux_destroy(demux);
    http_client_destroy(client);
    return false;
  }
  *client_out = client;
  *demux_out = demux;
  return true;
}

static bool load_selected_playback(
    const char *gateway_url,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux) {
  const uint32_t rating_key = multiplex_native_app_playback_request();
  if (rating_key == 0) {
    return true;
  }
  const uint32_t offset_ms = multiplex_native_app_playback_offset_request();
  MultiplexGatewayPlaybackManifest requested;
  if (!multiplex_gateway_load_playback_manifest(gateway_url, rating_key,
                                                offset_ms,
                                                &requested)) {
    if (multiplex_native_app_playback_fail() == 0) {
      return false;
    }
    SYS_Report("REFERENCE GX: playback-session unavailable rating-key=%u\n",
               rating_key);
    return true;
  }
  if (*demux == NULL || active_manifest->rating_key != requested.rating_key ||
      active_manifest->segment_start_ms != requested.segment_start_ms) {
    const uint32_t previous_rating_key = active_manifest->rating_key;
    const bool replacing_session = *demux != NULL;
    close_media_session(client, demux);
    if (!open_media_session(&requested, client, demux)) {
      if (multiplex_native_app_playback_fail() == 0) {
        return false;
      }
      SYS_Report("REFERENCE GX: playback-session switch failed requested=%u\n",
                 requested.rating_key);
      return true;
    }
    *active_manifest = requested;
    if (replacing_session) {
      SYS_Report(
          "REFERENCE GX: playback-session switched previous=%u active=%u offset=%u\n",
          previous_rating_key, requested.rating_key,
          requested.segment_start_ms);
    } else {
      SYS_Report(
          "REFERENCE GX: playback-session activated rating-key=%u offset=%u\n",
          requested.rating_key, requested.segment_start_ms);
    }
  }
  if (multiplex_native_app_playback_commit() == 0) {
    return false;
  }
  SYS_Report("REFERENCE GX: playback-session ready rating-key=%u offset=%u\n",
             requested.rating_key, requested.segment_start_ms);
  return true;
}

static uint32_t playback_position_ms(
    const MultiplexGatewayPlaybackManifest *manifest) {
  if (manifest == NULL || manifest->rating_key == 0 || audio_output == NULL) {
    return manifest == NULL ? 0 : manifest->segment_start_ms;
  }
  uint64_t position =
      (uint64_t)manifest->segment_start_ms +
      (audio_dma_samples_played(audio_output) * 1000u) / AUDIO_SAMPLE_RATE;
  if (position > manifest->media_duration_ms) {
    position = manifest->media_duration_ms;
  }
  return (uint32_t)position;
}

static void texture_vertex(float x, float y, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(255, 255, 255, 255);
  GX_TexCoord2f32(u, v);
}

static void configure_color_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX,
                 GX_LIGHTNULL, GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(0);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORDNULL, GX_TEXMAP_NULL,
                 GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_PASSCLR);
}

static void color_vertex(float x, float y, GXColor color) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
}

static void fill_rect(float left, float top, float right, float bottom,
                      GXColor color) {
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  color_vertex(left, top, color);
  color_vertex(right, top, color);
  color_vertex(right, bottom, color);
  color_vertex(left, bottom, color);
  GX_End();
}

static void draw_reference_frame(void) {
  configure_ui_pipeline();
  for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
    for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      const float left = tile_x * TILE_WIDTH;
      const float top = tile_y * TILE_HEIGHT;
      const float right = left + TILE_WIDTH;
      const float bottom = top + TILE_HEIGHT;

      GX_LoadTexObj(&textures[tile_index], GX_TEXMAP0);
      GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
      texture_vertex(left, top, 0.0f, 0.0f);
      texture_vertex(right, top, 1.0f, 0.0f);
      texture_vertex(right, bottom, 1.0f, 1.0f);
      texture_vertex(left, bottom, 0.0f, 1.0f);
      GX_End();
    }
  }
}

static void draw_poster_surfaces(void) {
  if (poster_texture_count == 0) {
    return;
  }
  MultiplexPosterSurface surfaces[4];
  const uint32_t count = multiplex_native_poster_surfaces(surfaces, 4);
  configure_ui_pipeline();
  for (uint32_t index = 0; index < count; ++index) {
    const MultiplexPosterSurface *surface = &surfaces[index];
    if (surface->image_id == 0 || surface->image_id > poster_texture_count) {
      continue;
    }
    GX_LoadTexObj(&poster_textures[surface->image_id - 1u], GX_TEXMAP0);
    GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
    texture_vertex(surface->x, surface->y, 0.0f, 0.0f);
    texture_vertex(surface->x + surface->width, surface->y, 1.0f, 0.0f);
    texture_vertex(surface->x + surface->width,
                   surface->y + surface->height, 1.0f, 1.0f);
    texture_vertex(surface->x, surface->y + surface->height, 0.0f, 1.0f);
    GX_End();
  }
}

static void draw_video_surface(void) {
  memset(&video_surface, 0, sizeof(video_surface));
  if (multiplex_native_video_surface(&video_surface) == 0 ||
      video_surface.width <= 0 || video_surface.height <= 0) {
    audio_dma_update(audio_output, false);
    video_audio_clock_started = false;
    video_was_playing = false;
    return;
  }

  const size_t video_size = mpeg_ps_demux_video_size(media_demux);
  const size_t audio_size = mpeg_ps_demux_audio_size(media_demux);
  const size_t video_prebuffer =
      video_size < VIDEO_PREBUFFER_BYTES ? video_size : VIDEO_PREBUFFER_BYTES;
  const size_t audio_prebuffer =
      audio_size < AUDIO_PREBUFFER_BYTES ? audio_size : AUDIO_PREBUFFER_BYTES;
  const bool source_ready =
      media_demux == NULL ||
      (mpeg_ps_demux_video_bytes_pumped(media_demux) >= video_prebuffer &&
       mpeg_ps_demux_audio_bytes_pumped(media_demux) >= audio_prebuffer);
  const bool playing = video_surface.playing != 0 && source_ready;
  audio_dma_update(audio_output, playing);
  const bool playback_changed = playing != video_was_playing;
  if (playback_changed) {
    video_frame_count = 0;
    video_decode_total_us = 0;
    video_decode_max_us = 0;
    video_codec_total_us = 0;
    video_codec_max_us = 0;
    video_upload_total_us = 0;
    video_upload_max_us = 0;
    video_was_playing = playing;
  }

  bool texture_changed = false;
  uint32_t completed_decode_us = 0;
  uint32_t completed_codec_us = 0;
  uint32_t completed_upload_us = 0;
  LWP_MutexLock(video_decoder_mutex);
  if (video_decode_ready) {
    completed_decode_us = video_decode_ready_us;
    completed_codec_us = video_codec_ready_us;
    completed_upload_us = video_upload_ready_us;
    video_decode_ready = false;
    video_texture_ready = true;
    texture_changed = true;
  }
  bool decoder_failed = video_decode_failed;
  LWP_MutexUnlock(video_decoder_mutex);

  /*
   * Swap before requesting another decode. That makes the former front buffer
   * the worker's back buffer and lets a late clock request catch up in this
   * same presentation frame without racing the GX texture swap.
   */
  if (texture_changed) {
    yuv420_gx_swap();
    profile_decoded_frame(completed_decode_us, completed_codec_us,
                          completed_upload_us);
  }
  const uint64_t audio_samples = audio_dma_samples_played(audio_output);
  if (playing && !video_audio_clock_started) {
    video_audio_start_samples = audio_samples;
    video_audio_start_completions = video_decode_completion_count;
    video_audio_clock_started = true;
  }
  LWP_MutexLock(video_decoder_mutex);
  uint32_t desired_completions = video_decode_completion_count;
  int64_t media_elapsed_samples = -video_pts_offset_samples;
  if (video_audio_clock_started) {
    media_elapsed_samples +=
        (int64_t)(audio_samples - video_audio_start_samples);
  }
  if (playing && media_elapsed_samples >= 0) {
    desired_completions =
        video_audio_start_completions + 1u +
        (uint32_t)(((uint64_t)media_elapsed_samples *
                    VIDEO_RATE_NUMERATOR) /
                   (AUDIO_SAMPLE_RATE * VIDEO_RATE_DENOMINATOR));
  }
  const bool cadence_due =
      (!video_texture_ready &&
       (!playing || media_elapsed_samples >= 0)) ||
      (playing && video_decode_completion_count < desired_completions);
  if (cadence_due && !video_decode_running && !video_decode_ready &&
      !video_decode_failed) {
    video_decode_running = true;
    video_decode_requested = true;
    video_decode_request_count += 1;
    LWP_CondSignal(video_decoder_condition);
  }
  decoder_failed = video_decode_failed;
  if (playback_changed) {
    SYS_Report(
        "REFERENCE GX: playback=%s clock=audio samples=%llu "
        "pts-offset-samples=%lld target=%u decoder requests=%u "
        "completed=%u running=%u ready=%u\n",
        playing ? "playing" : "paused", audio_samples,
        video_pts_offset_samples, desired_completions,
        video_decode_request_count,
        video_decode_completion_count, video_decode_running,
        video_decode_ready);
  }
  LWP_MutexUnlock(video_decoder_mutex);

  if (!video_texture_ready || decoder_failed) {
    return;
  }

  const float left = video_surface.x;
  const float top = video_surface.y;
  const float right = left + video_surface.width;
  const float bottom = top + video_surface.height;
  yuv420_gx_draw(left, top, right, bottom);
}

static void draw_playback_progress(
    const MultiplexGatewayPlaybackManifest *manifest) {
  if (video_surface.visible == 0 || manifest == NULL ||
      manifest->rating_key == 0 || manifest->media_duration_ms == 0) {
    return;
  }
  const uint32_t position_ms = playback_position_ms(manifest);
  const float left = video_surface.x + 10.0f;
  const float right = video_surface.x + video_surface.width - 10.0f;
  const float bottom = video_surface.y + video_surface.height - 8.0f;
  const float top = bottom - 4.0f;
  const float progress =
      (float)position_ms / (float)manifest->media_duration_ms;
  const float filled = left + (right - left) * progress;
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                  GX_LO_CLEAR);
  fill_rect(left, top, right, bottom, (GXColor){24, 24, 27, 210});
  if (filled > left) {
    fill_rect(left, top, filled, bottom, (GXColor){250, 250, 250, 255});
  }
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
}

static void present_frame(
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  if (native_frame_dirty && !refresh_reference_frame(false)) {
    native_frame_dirty = false;
  }

  draw_reference_frame();
  draw_poster_surfaces();
  draw_video_surface();
  draw_playback_progress(playback_manifest);
  GX_CopyDisp(framebuffers[framebuffer_index], GX_TRUE);
  GX_DrawDone();
  VIDEO_SetNextFramebuffer(framebuffers[framebuffer_index]);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  framebuffer_index ^= 1;

  if (presentation_frames == 0) {
    presentation_started = gettick();
  }
  presentation_frames += 1;
  if (presentation_frames == 120) {
    const uint32_t measured_us = elapsed_us(presentation_started);
    const uint32_t fps_tenths =
        measured_us == 0
            ? 0
            : (uint32_t)((120ull * 10000000ull) / measured_us);
    SYS_Report("REFERENCE GX: presentation=120 frames/%uus (%u.%u fps)\n",
               measured_us, fps_tenths / 10, fps_tenths % 10);
    if (media_demux != NULL) {
      SYS_Report("REFERENCE GX: stream-progress video=%u audio=%u loops=%u\n",
                 mpeg_ps_demux_video_bytes_pumped(media_demux),
                 mpeg_ps_demux_audio_bytes_pumped(media_demux),
                 mpeg_ps_demux_loop_count(media_demux));
      if (playback_manifest != NULL && playback_manifest->rating_key != 0) {
        SYS_Report(
            "REFERENCE GX: timeline rating-key=%u position=%u duration=%u "
            "segment-start=%u segment-duration=%u\n",
            playback_manifest->rating_key,
            playback_position_ms(playback_manifest),
            playback_manifest->media_duration_ms,
            playback_manifest->segment_start_ms,
            playback_manifest->segment_duration_ms);
      }
    }
    presentation_frames = 0;
  }
}

static void pause_audio_for_player_input(
    uint32_t pressed,
    const MultiplexGatewayPlaybackManifest *playback_manifest) {
  if ((pressed &
       (PAD_BUTTON_A | PAD_BUTTON_B | PAD_TRIGGER_L | PAD_TRIGGER_R)) != 0) {
    MultiplexVideoSurface current_surface;
    memset(&current_surface, 0, sizeof(current_surface));
    if (multiplex_native_video_surface(&current_surface) != 0) {
      /*
       * The exact player repaint takes longer than one VBlank. Stop the media
       * clock before dispatching pause/resume/exit; resume stays paused until
       * the new UI frame is ready and draw_video_surface restarts both clocks.
       */
      const uint32_t position_ms = playback_position_ms(playback_manifest);
      multiplex_native_app_playback_position(position_ms);
      audio_dma_update(audio_output, false);
      SYS_Report("REFERENCE GX: timeline synced for input position=%u\n",
                 position_ms);
    }
  }
}

static bool continue_playback_if_needed(
    const char *gateway_url,
    MultiplexGatewayPlaybackManifest *active_manifest, HttpClient **client,
    MpegPsDemux **demux) {
  if (gateway_url == NULL || gateway_url[0] == '\0' || active_manifest == NULL ||
      active_manifest->rating_key == 0 || !video_was_playing ||
      audio_output == NULL) {
    return true;
  }
  const uint32_t position_ms = playback_position_ms(active_manifest);
  const uint64_t segment_end =
      (uint64_t)active_manifest->segment_start_ms +
      active_manifest->segment_duration_ms;
  if ((uint64_t)position_ms < segment_end) {
    return true;
  }
  audio_dma_update(audio_output, false);
  if (segment_end >= active_manifest->media_duration_ms) {
    multiplex_native_app_playback_position(active_manifest->media_duration_ms);
    if (multiplex_native_app_playback_complete() == 0) {
      return false;
    }
    native_frame_dirty = true;
    SYS_Report("REFERENCE GX: playback-complete rating-key=%u duration=%u\n",
               active_manifest->rating_key,
               active_manifest->media_duration_ms);
    return true;
  }
  const uint32_t next_offset_ms = (uint32_t)segment_end;
  if (multiplex_native_app_playback_continue(next_offset_ms) == 0) {
    return false;
  }
  SYS_Report(
      "REFERENCE GX: playback-continuation requested rating-key=%u offset=%u\n",
      active_manifest->rating_key, next_offset_ms);
  if (!load_selected_playback(gateway_url, active_manifest, client, demux)) {
    return false;
  }
  native_frame_dirty = true;
  return true;
}

static bool read_http_program(void *context, size_t offset,
                              uint8_t *destination, size_t size) {
  return http_client_read_at(context, offset, destination, size);
}

static void *run_app(void *unused) {
  (void)unused;
  initialize_video_and_gx();
  if (!allocate_buffers()) {
    return (void *)(uintptr_t)1;
  }

  MpegPsDemux *demux = NULL;
  HttpClient *client = NULL;
  MultiplexGatewayPlaybackManifest playback_manifest;
  memset(&playback_manifest, 0, sizeof(playback_manifest));
  MultiplexGatewayCatalog catalog;
  memset(&catalog, 0, sizeof(catalog));
  const bool has_catalog =
      MULTIPLEX_GATEWAY_URL[0] != '\0' &&
      multiplex_gateway_load_catalog(MULTIPLEX_GATEWAY_URL, &catalog);
  if (has_catalog &&
      !initialize_poster_textures(MULTIPLEX_GATEWAY_URL,
                                  catalog.total_item_count)) {
    SYS_Report("REFERENCE GX: gateway artwork unavailable; using placeholders\n");
  }
  multiplex_native_app_init();
  if (has_catalog) {
    if (multiplex_native_app_catalog_begin(
            (const uint8_t *)catalog.server_name,
            catalog.server_name_length, catalog.row_count,
            catalog.library_count) == 0) {
      SYS_Report("REFERENCE GX: failed to bind gateway catalog to app\n");
      return (void *)(uintptr_t)1;
    }
    for (uint16_t index = 0; index < catalog.library_count; ++index) {
      const MultiplexGatewayLibrary *library = &catalog.libraries[index];
      if (multiplex_native_app_catalog_library(
              index, library->section_id, library->media_type,
              (const uint8_t *)library->title, library->title_length) == 0) {
        SYS_Report("REFERENCE GX: failed to bind library %u\n", index);
        return (void *)(uintptr_t)1;
      }
    }
    for (uint16_t row_index = 0; row_index < catalog.row_count; ++row_index) {
      const MultiplexGatewayRow *row = &catalog.rows[row_index];
      if (multiplex_native_app_catalog_row(
              row_index, (const uint8_t *)row->title, row->title_length,
              row->item_count) == 0) {
        SYS_Report("REFERENCE GX: failed to bind catalog row %u\n", row_index);
        return (void *)(uintptr_t)1;
      }
      for (uint16_t item_index = 0; item_index < row->item_count;
           ++item_index) {
        const MultiplexGatewayItem *item =
            &catalog.items[row->item_offset + item_index];
        if (multiplex_native_app_catalog_item(
                row_index, item_index, item->rating_key,
                (const uint8_t *)item->title, item->title_length,
                (const uint8_t *)item->subtitle, item->subtitle_length,
                item->artwork_slot, item->duration_ms, item->view_offset_ms,
                item->progress_percent) == 0) {
          SYS_Report("REFERENCE GX: failed to bind catalog item %u/%u\n",
                     row_index, item_index);
          return (void *)(uintptr_t)1;
        }
      }
    }
    if (multiplex_native_app_catalog_commit() == 0) {
      SYS_Report("REFERENCE GX: failed to commit gateway catalog\n");
      return (void *)(uintptr_t)1;
    }
  }
  const bool has_playback_manifest =
      MULTIPLEX_GATEWAY_URL[0] != '\0' &&
      multiplex_gateway_load_playback_manifest(MULTIPLEX_GATEWAY_URL, 0,
                                               0, &playback_manifest);
  if (has_playback_manifest) {
    SYS_Report(
        "REFERENCE GX: playback-session deferred rating-key=%u until selected\n",
        playback_manifest.rating_key);
  } else if (!open_initial_media_session(&client, &demux)) {
    return (void *)(uintptr_t)1;
  }
  initialize_textures();
  if (!refresh_reference_frame(false)) {
    close_media_session(&client, &demux);
    return (void *)(uintptr_t)1;
  }

  while (SYS_MainLoop()) {
    if (demux != NULL && mpeg_ps_demux_failed(demux)) {
      SYS_Report("REFERENCE GX: media producer failure\n");
      break;
    }
    PAD_ScanPads();
    const uint32_t pressed = PAD_ButtonsDown(0);
    if (pressed != 0) {
      SYS_Report("REFERENCE GX: controller buttons %08x\n", pressed);
    }
    pause_audio_for_player_input(pressed, &playback_manifest);
    bool app_changed = false;
    if ((pressed & PAD_BUTTON_LEFT) != 0 &&
        multiplex_native_app_input(0) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_RIGHT) != 0 &&
        multiplex_native_app_input(1) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_UP) != 0 &&
        multiplex_native_app_input(8) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_DOWN) != 0 &&
        multiplex_native_app_input(9) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_A) != 0 &&
        multiplex_native_app_input(2) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_B) != 0 &&
        multiplex_native_app_input(3) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_Y) != 0 &&
        multiplex_native_app_input(4) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_BUTTON_X) != 0 &&
        multiplex_native_app_input(5) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_R) != 0 &&
        multiplex_native_app_input(6) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_L) != 0 &&
        multiplex_native_app_input(7) != 0) {
      app_changed = true;
    }
    if ((pressed & PAD_TRIGGER_Z) != 0 &&
        multiplex_native_app_input(10) != 0) {
      app_changed = true;
    }
    if (app_changed) {
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_browse_page(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: browse-page load failed\n");
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_search_page(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: search-page load failed\n");
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_item_details(MULTIPLEX_GATEWAY_URL)) {
        SYS_Report("REFERENCE GX: details-page load failed\n");
      }
      if (MULTIPLEX_GATEWAY_URL[0] != '\0' &&
          !load_selected_playback(MULTIPLEX_GATEWAY_URL,
                                  &playback_manifest, &client, &demux)) {
        SYS_Report("REFERENCE GX: playback-session load failed\n");
      }
      native_frame_dirty = true;
    }
    if ((pressed & PAD_BUTTON_START) != 0) {
      break;
    }
    present_frame(&playback_manifest);
    if (!continue_playback_if_needed(MULTIPLEX_GATEWAY_URL,
                                     &playback_manifest, &client, &demux)) {
      SYS_Report("REFERENCE GX: playback continuation failed\n");
      break;
    }
  }

  close_media_session(&client, &demux);
  multiplex_native_cache_free(poster_texture_pixels);
  poster_texture_pixels = NULL;
  poster_texture_count = 0;
  return NULL;
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  void *app_stack = malloc(APP_STACK_SIZE);
  if (app_stack == NULL) {
    SYS_Report("REFERENCE GX: failed to allocate %u-byte app stack\n",
               APP_STACK_SIZE);
    return 1;
  }

  lwp_t app_thread = LWP_THREAD_NULL;
  if (LWP_CreateThread(&app_thread, run_app, NULL, app_stack, APP_STACK_SIZE,
                       LWP_PRIO_NORMAL) != 0) {
    SYS_Report("REFERENCE GX: failed to create app thread\n");
    free(app_stack);
    return 1;
  }

  void *result = NULL;
  const int join_status = LWP_JoinThread(app_thread, &result);
  free(app_stack);
  if (join_status != 0) {
    SYS_Report("REFERENCE GX: failed to join app thread\n");
    return 1;
  }
  return (int)(uintptr_t)result;
}
