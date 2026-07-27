#include "native_ui.h"
#include "mpeg2_decoder.h"
#include "multiplex-dvd-demo.h"
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
#define VIDEO_FRAME_INTERVAL_US 33367
#define VIDEO_PROFILE_FRAMES 60

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
static MultiplexVideoSurface video_surface;
static bool native_frame_dirty = true;
static FrameProfile profile;
static uint32_t presentation_frames;
static uint32_t presentation_started;
static uint32_t profile_stage_started;
static uint32_t profile_stage_current;
static uint32_t profile_stage_us[7];
static uint32_t video_frame_index;
static uint32_t video_frame_count;
static uint32_t video_frame_started;
static uint64_t video_next_decode_time;
static bool video_clock_started;
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

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
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
    if (decoded) {
      video_decode_ready = true;
      video_decode_ready_us = decode_us;
      video_codec_ready_us = codec_us;
      video_upload_ready_us = upload_us;
      video_frame_index += 1;
      video_decode_completion_count += 1;
      if (video_decode_completion_count % 30u == 0u) {
        SYS_Report(
            "REFERENCE GX: MPEG-2 progress=%u frames last-decode=%uus\n",
            video_decode_completion_count, decode_us);
      }
    } else {
      video_decode_failed = true;
    }
  }
  LWP_MutexUnlock(video_decoder_mutex);
  return NULL;
}

static void stop_video_decoder(void);

static bool start_video_decoder(void) {
  video_decoder =
      mpeg2_decoder_create(multiplex_dvd_demo_m2v,
                           (size_t)multiplex_dvd_demo_m2v_size);
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
      VIDEO_WIDTH, VIDEO_HEIGHT, multiplex_dvd_demo_m2v_size);
  return true;
}

static void stop_video_decoder(void) {
  if (video_decoder_thread != LWP_THREAD_NULL) {
    LWP_MutexLock(video_decoder_mutex);
    video_decoder_stopping = true;
    LWP_CondSignal(video_decoder_condition);
    LWP_MutexUnlock(video_decoder_mutex);
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

static void texture_vertex(float x, float y, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(255, 255, 255, 255);
  GX_TexCoord2f32(u, v);
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

static void draw_video_surface(void) {
  memset(&video_surface, 0, sizeof(video_surface));
  if (multiplex_native_video_surface(&video_surface) == 0 ||
      video_surface.width <= 0 || video_surface.height <= 0) {
    video_clock_started = false;
    video_was_playing = false;
    return;
  }

  const bool playing = video_surface.playing != 0;
  const bool playback_changed = playing != video_was_playing;
  if (playback_changed) {
    video_frame_count = 0;
    video_decode_total_us = 0;
    video_decode_max_us = 0;
    video_codec_total_us = 0;
    video_codec_max_us = 0;
    video_upload_total_us = 0;
    video_upload_max_us = 0;
    video_clock_started = false;
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
  const uint64_t now = gettime();
  if (playing && !video_clock_started) {
    video_next_decode_time = now;
    video_clock_started = true;
  }
  const bool cadence_due =
      !video_texture_ready ||
      (playing && now >= video_next_decode_time);
  LWP_MutexLock(video_decoder_mutex);
  if (cadence_due && !video_decode_running && !video_decode_ready &&
      !video_decode_failed) {
    video_decode_running = true;
    video_decode_requested = true;
    video_decode_request_count += 1;
    if (playing) {
      video_next_decode_time +=
          microsecs_to_ticks(VIDEO_FRAME_INTERVAL_US);
    }
    LWP_CondSignal(video_decoder_condition);
  }
  decoder_failed = video_decode_failed;
  if (playback_changed) {
    SYS_Report(
        "REFERENCE GX: playback=%s decoder requests=%u completed=%u "
        "running=%u ready=%u\n",
        playing ? "playing" : "paused", video_decode_request_count,
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

static void present_frame(void) {
  if (native_frame_dirty && !refresh_reference_frame(false)) {
    native_frame_dirty = false;
  }

  draw_reference_frame();
  draw_video_surface();
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
    presentation_frames = 0;
  }
}

static void *run_app(void *unused) {
  (void)unused;
  initialize_video_and_gx();
  if (!allocate_buffers()) {
    return (void *)(uintptr_t)1;
  }
  if (!start_video_decoder()) {
    return (void *)(uintptr_t)1;
  }
  initialize_textures();
  if (!refresh_reference_frame(true)) {
    stop_video_decoder();
    return (void *)(uintptr_t)1;
  }

  while (SYS_MainLoop()) {
    PAD_ScanPads();
    const uint32_t pressed = PAD_ButtonsDown(0);
    if (pressed != 0) {
      SYS_Report("REFERENCE GX: controller buttons %08x\n", pressed);
    }
    if ((pressed & (PAD_BUTTON_LEFT | PAD_BUTTON_UP)) != 0 &&
        multiplex_native_app_input(0) != 0) {
      native_frame_dirty = true;
    }
    if ((pressed & (PAD_BUTTON_RIGHT | PAD_BUTTON_DOWN)) != 0 &&
        multiplex_native_app_input(1) != 0) {
      native_frame_dirty = true;
    }
    if ((pressed & PAD_BUTTON_A) != 0 &&
        multiplex_native_app_input(2) != 0) {
      native_frame_dirty = true;
    }
    if ((pressed & PAD_BUTTON_B) != 0 &&
        multiplex_native_app_input(3) != 0) {
      native_frame_dirty = true;
    }
    if ((pressed & PAD_BUTTON_START) != 0) {
      break;
    }
    present_frame();
  }

  stop_video_decoder();
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
