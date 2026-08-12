#include "presentation.h"
#include "gateway_client.h"
#include "geist_atlas.h"
#include "native_ui.h"

#include <malloc.h>
#include <math.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/mutex.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define FIFO_SIZE (256u * 1024u)
#define LOGICAL_WIDTH 640u
#define LOGICAL_HEIGHT 480u
#define TILE_WIDTH 160u
#define TILE_HEIGHT 120u
#define TILE_COLUMNS (LOGICAL_WIDTH / TILE_WIDTH)
#define TILE_ROWS (LOGICAL_HEIGHT / TILE_HEIGHT)
#define TILE_BYTES (TILE_WIDTH * TILE_HEIGHT * 4u)
#define UI_ENTRY_FRAMES 6u
#define POSTER_FOCUS_FRAMES 1u
#define HOME_MOTION_FRAMES 9u
#define HOME_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS
#define HOME_CONTENT_TOP 64.0f
#define HOME_ACTIVE_CARD_TOP 84.0f
#define HOME_ACTIVE_SHELF_BOTTOM 232.0f
#define HOME_CARD_STRIDE 80.0f
#define HOME_SHELF_STRIDE 168.0f
#define HOME_CAROUSEL_LEFT 20.0f
#define HOME_CAROUSEL_RIGHT 620.0f
#define BROWSE_GRID_TOP 118.0f
#define BROWSE_ROW_STRIDE 155.0f
#define UI_COMMAND_CAPACITY 1024u
#define UI_TEXT_COMMAND_CAPACITY 96u
#define UI_SHAPE_COMMAND_CAPACITY 896u
#define UI_TEXT_CAPACITY 4096u
#define MULTIPLEX_PRESENTATION_TILE_COUNT 16u
#define MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT                            \
  (MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS + MULTIPLEX_GATEWAY_MAX_BROWSE_ITEMS)
#define MULTIPLEX_PRESENTATION_POSTER_SURFACE_CAPACITY 24u
#define PLAYER_CONTROLS_IDLE_MS 4000u
#define PLAYER_CONTROLS_FADE_MS 180u

typedef struct {
  MultiplexNativeDrawCommand text_commands[UI_TEXT_COMMAND_CAPACITY];
  MultiplexNativeDrawCommand shape_commands[UI_SHAPE_COMMAND_CAPACITY];
  uint32_t text_sequences[UI_TEXT_COMMAND_CAPACITY];
  uint32_t shape_sequences[UI_SHAPE_COMMAND_CAPACITY];
  uint8_t text[UI_TEXT_CAPACITY];
  uint32_t text_command_count;
  uint32_t shape_command_count;
  uint32_t text_length;
} NativeUiPacket;

typedef MultiplexReferenceFrameStatus (*MultiplexPresentationRenderFunction)(
    MultiplexReferenceFrame *, bool, MultiplexReferenceFrameRender *, uint32_t);

typedef enum {
  MULTIPLEX_PRESENTATION_MOTION_NONE = 0,
  MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL = 1,
  MULTIPLEX_PRESENTATION_MOTION_VERTICAL = 2,
} MultiplexPresentationMotion;

typedef struct {
  uint32_t render_us;
  uint32_t upload_us;
  uint32_t commands;
  uint32_t passes;
  uint32_t signature;
  uint32_t memo_hits;
  uint32_t memo_misses;
  uint32_t text_us;
} MultiplexPresentationProfile;

struct MultiplexPresentation {
  GXRModeObj *video_mode;
  void *framebuffers[2];
  unsigned framebuffer_index;
  void *gx_fifo;
  uint8_t *allocation;
  uint8_t *pixels;
  GXTexObj *textures;
  GXTexObj font_texture;
  unsigned tile_count;
  size_t tile_bytes;
  MultiplexReferenceFrame reference_frame;
  mutex_t renderer_mutex;
  bool renderer_mutex_ready;
  lwp_t renderer_thread;
  void *renderer_stack;
  bool renderer_complete;
  bool renderer_audit;
  MultiplexPresentationRenderFunction renderer_render_function;
  MultiplexReferenceFrameRender renderer_render;
  MultiplexReferenceFrameStatus renderer_status;
  uint32_t renderer_stage;
  uint32_t renderer_render_us;
  bool reference_tile_active[MULTIPLEX_PRESENTATION_TILE_COUNT];
  GXTexObj poster_textures[MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT];
  uint8_t *poster_texture_pixels;
  uint16_t poster_texture_count;
  uint32_t
      poster_texture_rating_keys[MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT];
  bool poster_write_active;
  uint16_t poster_write_offset;
  uint16_t poster_write_count;
  uint32_t poster_write_generation;
  uint8_t *poster_write_snapshot;
  uint32_t *poster_write_snapshot_rating_keys;
  uint16_t poster_write_snapshot_count;
  MultiplexVideoSurface video_surface;
  MultiplexPlayerControlsSurface player_controls_surface;
  MultiplexModalSurface modal_surface;
  MultiplexPosterSurface
      poster_surfaces[MULTIPLEX_PRESENTATION_POSTER_SURFACE_CAPACITY];
  uint32_t poster_surface_count;
  float focused_poster_x;
  float focused_poster_y;
  uint8_t poster_focus_frame;
  uint32_t presented_screen;
  bool asynchronous_reference_enabled;
  bool asynchronous_reference_requested;
  bool native_frame_dirty;
  MultiplexReferenceFrameStatus last_render_status;
  uint32_t last_render_stage;
  bool last_render_asynchronous;
  bool network_activity_visible;
  bool blocking_activity_visible;
  uint32_t network_activity_frame;
  uint32_t screen_transition_frame;
  uint8_t ui_entry_frame;
  uint8_t ui_frame_alpha;
  bool player_controls_overlay_visible;
  bool player_startup_backdrop_visible;
  uint64_t player_controls_last_input_ms;
  uint64_t player_controls_fade_started_ms;
  NativeUiPacket presented_ui_packet;
  NativeUiPacket home_motion_previous_packet;
  MultiplexPosterSurface home_motion_previous_surfaces
      [MULTIPLEX_PRESENTATION_POSTER_SURFACE_CAPACITY];
  uint32_t home_motion_previous_surface_count;
  MultiplexPresentationMotion home_motion_kind;
  int8_t home_motion_direction;
  uint8_t home_motion_frame;
  int8_t browse_motion_pending_direction;
  bool ui_draw_clip_active;
  float ui_draw_clip_left;
  float ui_draw_clip_top;
  float ui_draw_clip_right;
  float ui_draw_clip_bottom;
  float ui_draw_translation_x;
  float ui_draw_translation_y;
  uint32_t presentation_frames;
  uint32_t presentation_started;
  MultiplexPresentationProfile profile;
  uint32_t profile_stage_started;
  uint32_t profile_stage_current;
  uint32_t profile_stage_us[7];
  uint32_t diagnostic_presentation_fps_tenths;
  MultiplexPresentationFrameInput frame_input;
};

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

MultiplexPresentation *multiplex_presentation_create(void) {
  MultiplexPresentation *presentation = calloc(1, sizeof(*presentation));
  if (presentation == NULL) {
    return NULL;
  }
  presentation->renderer_thread = LWP_THREAD_NULL;
  presentation->presented_screen = UINT32_MAX;
  presentation->focused_poster_x = -1.0f;
  presentation->focused_poster_y = -1.0f;
  presentation->poster_focus_frame = POSTER_FOCUS_FRAMES;
  presentation->ui_entry_frame = UI_ENTRY_FRAMES;
  presentation->ui_frame_alpha = 255u;
  presentation->player_controls_overlay_visible = true;
  presentation->home_motion_frame = HOME_MOTION_FRAMES;
  presentation->native_frame_dirty = true;
  presentation->last_render_status = MULTIPLEX_REFERENCE_FRAME_OK;
  return presentation;
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
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
}

static bool initialize_video(MultiplexPresentation *presentation) {
  if (presentation == NULL) {
    return false;
  }

  VIDEO_Init();
  presentation->video_mode = select_video_mode();
  if (presentation->video_mode == NULL) {
    SYS_Report("REFERENCE GX: no compatible video mode\n");
    return false;
  }
  const uint32_t framebuffer_bytes =
      VIDEO_GetFrameBufferSize(presentation->video_mode);
  for (unsigned index = 0; index < 2; ++index) {
    void *framebuffer = SYS_AllocateFramebuffer(presentation->video_mode);
    if (framebuffer == NULL) {
      SYS_Report("REFERENCE GX: framebuffer %u allocation failed\n", index);
      return false;
    }
    presentation->framebuffers[index] = MEM_K0_TO_K1(framebuffer);
    memset(presentation->framebuffers[index], 0, framebuffer_bytes);
  }
  presentation->framebuffer_index = 1;
  SYS_Report(
      "REFERENCE GX: video mode=%08x progressive=%u component=%u "
      "fb=%ux%u efb=%u xfb=%u vi=%ux%u xfb_mode=%u fields=%u aa=%u\n",
      presentation->video_mode->viTVMode,
      (presentation->video_mode->viTVMode & 3) == VI_PROGRESSIVE,
      VIDEO_HaveComponentCable(), presentation->video_mode->fbWidth,
      presentation->video_mode->xfbHeight, presentation->video_mode->efbHeight,
      presentation->video_mode->xfbHeight, presentation->video_mode->viWidth,
      presentation->video_mode->viHeight, presentation->video_mode->xfbMode,
      presentation->video_mode->field_rendering, presentation->video_mode->aa);

  VIDEO_Configure(presentation->video_mode);
  VIDEO_SetNextFramebuffer(presentation->framebuffers[0]);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  if ((presentation->video_mode->viTVMode & VI_NON_INTERLACE) != 0) {
    VIDEO_WaitVSync();
  }
  presentation->gx_fifo = memalign(32, FIFO_SIZE);
  if (presentation->gx_fifo == NULL) {
    SYS_Report("REFERENCE GX: %u-byte GX FIFO allocation failed\n", FIFO_SIZE);
    return false;
  }
  memset(presentation->gx_fifo, 0, FIFO_SIZE);
  GX_Init(presentation->gx_fifo, FIFO_SIZE);
  GX_SetCopyClear((GXColor){10, 10, 12, 255}, 0x00ffffff);
  GX_SetViewport(0, 0, presentation->video_mode->fbWidth,
                 presentation->video_mode->efbHeight, 0, 1);
  const float y_scale = GX_GetYScaleFactor(presentation->video_mode->efbHeight,
                                           presentation->video_mode->xfbHeight);
  const uint16_t xfb_height = GX_SetDispCopyYScale(y_scale);
  GX_SetDispCopySrc(0, 0, presentation->video_mode->fbWidth,
                    presentation->video_mode->efbHeight);
  GX_SetDispCopyDst(presentation->video_mode->fbWidth, xfb_height);
  GX_SetCopyFilter(presentation->video_mode->aa,
                   presentation->video_mode->sample_pattern, GX_TRUE,
                   presentation->video_mode->vfilter);
  GX_SetFieldMode(presentation->video_mode->field_rendering,
                  presentation->video_mode->viHeight ==
                          2 * presentation->video_mode->xfbHeight
                      ? GX_ENABLE
                      : GX_DISABLE);
  GX_SetPixelFmt(presentation->video_mode->aa ? GX_PF_RGB565_Z16
                                              : GX_PF_RGB8_Z24,
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
  guOrtho(projection, 0.0f, (float)(LOGICAL_HEIGHT - 1u), 0.0f,
          (float)(LOGICAL_WIDTH - 1u), 0.0f, 1.0f);
  GX_LoadProjectionMtx(projection, GX_ORTHOGRAPHIC);
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
  GX_CopyDisp(presentation->framebuffers[0], GX_TRUE);
  GX_DrawDone();
  return true;
}

static bool command_intersects_rect(const MultiplexNativeDrawCommand *command,
                                    float x, float y, float width,
                                    float height) {
  float left = command->x, top = command->y;
  float right = left + command->width, bottom = top + command->height;
  if (command->kind == MULTIPLEX_NATIVE_DRAW_LINE ||
      command->kind == MULTIPLEX_NATIVE_DRAW_PATH_LINE) {
    left = fminf(command->x, command->x2);
    top = fminf(command->y, command->y2);
    right = fmaxf(command->x, command->x2);
    bottom = fmaxf(command->y, command->y2);
    if (command->kind == MULTIPLEX_NATIVE_DRAW_PATH_LINE) {
      left -= command->stroke_width;
      top -= command->stroke_width;
      right += command->stroke_width;
      bottom += command->stroke_width;
    }
  }
  if (command->kind == MULTIPLEX_NATIVE_DRAW_FILL_TRIANGLE) {
    left = fminf(command->x, fminf(command->x2, command->width));
    top = fminf(command->y, fminf(command->y2, command->height));
    right = fmaxf(command->x, fmaxf(command->x2, command->width));
    bottom = fmaxf(command->y, fmaxf(command->y2, command->height));
  }
  return right >= x && left <= x + width && bottom >= y && top <= y + height;
}

static uint32_t copy_atlas_text(uint8_t *destination, uint32_t capacity,
                                const uint8_t *source, uint32_t length) {
  uint32_t input = 0, output = 0;
  while (input < length && output < capacity) {
    const uint8_t byte = source[input];
    if (byte < 0x80u) {
      destination[output++] = byte;
      ++input;
      continue;
    }
    if (input + 2u < length && byte == 0xe2u && source[input + 1u] == 0x80u) {
      const uint8_t punctuation = source[input + 2u];
      if (punctuation == 0xa6u) {
        if (capacity - output < 3u)
          break;
        destination[output++] = '.';
        destination[output++] = '.';
        destination[output++] = '.';
      } else if (punctuation == 0x98u || punctuation == 0x99u)
        destination[output++] = '\'';
      else if (punctuation == 0x9cu || punctuation == 0x9du)
        destination[output++] = '"';
      else if (punctuation == 0x93u || punctuation == 0x94u)
        destination[output++] = '-';
      else if (punctuation == 0xa2u)
        destination[output++] = '*';
      else
        destination[output++] = '?';
      input += 3u;
      continue;
    }
    destination[output++] = '?';
    ++input;
    while (input < length && (source[input] & 0xc0u) == 0x80u)
      ++input;
  }
  return output;
}

static void capture_ui_packet(NativeUiPacket *packet) {
  MultiplexNativeDrawCommand commands[UI_COMMAND_CAPACITY];
  memset(packet, 0, sizeof(*packet));
  const uint32_t count =
      multiplex_native_app_render(commands, UI_COMMAND_CAPACITY);
  const uint32_t screen = multiplex_native_app_screen();
  MultiplexPlayerControlsSurface controls = {0};
  MultiplexModalSurface modal = {0};
  if (screen == MULTIPLEX_SCREEN_PLAYER) {
    multiplex_native_player_controls_surface(&controls);
    multiplex_native_modal_surface(&modal);
  }
  for (uint32_t index = 0; index < count; ++index) {
    const MultiplexNativeDrawCommand *command = &commands[index];
    const bool shape =
        screen != MULTIPLEX_SCREEN_PLAYER ||
        (controls.visible != 0 &&
         command_intersects_rect(command, controls.x, controls.y,
                                 controls.width, controls.height)) ||
        (modal.visible != 0 &&
         command_intersects_rect(command, modal.x, modal.y, modal.width,
                                 modal.height));
    if (shape && command->kind != MULTIPLEX_NATIVE_DRAW_TEXT &&
        command->kind != MULTIPLEX_NATIVE_DRAW_GLYPH &&
        command->kind != MULTIPLEX_NATIVE_DRAW_SHADOW &&
        packet->shape_command_count < UI_SHAPE_COMMAND_CAPACITY) {
      packet->shape_sequences[packet->shape_command_count] = index;
      packet->shape_commands[packet->shape_command_count++] = *command;
    }
    if ((command->kind != MULTIPLEX_NATIVE_DRAW_TEXT &&
         command->kind != MULTIPLEX_NATIVE_DRAW_GLYPH) ||
        packet->text_command_count >= UI_TEXT_COMMAND_CAPACITY)
      continue;
    MultiplexNativeDrawCommand copy = *command;
    if (copy.kind == MULTIPLEX_NATIVE_DRAW_TEXT) {
      if (copy.text_ptr == NULL || copy.text_len == 0)
        continue;
      uint8_t *destination = packet->text + packet->text_length;
      copy.text_len =
          copy_atlas_text(destination, UI_TEXT_CAPACITY - packet->text_length,
                          copy.text_ptr, copy.text_len);
      if (copy.text_len == 0)
        continue;
      copy.text_ptr = destination;
      packet->text_length += copy.text_len;
    }
    packet->text_sequences[packet->text_command_count] = index;
    packet->text_commands[packet->text_command_count++] = copy;
  }
}

static void copy_ui_packet(NativeUiPacket *destination,
                           const NativeUiPacket *packet) {
  memset(destination, 0, sizeof(*destination));
  memcpy(destination->text, packet->text, packet->text_length);
  memcpy(destination->shape_commands, packet->shape_commands,
         packet->shape_command_count * sizeof(MultiplexNativeDrawCommand));
  memcpy(destination->text_sequences, packet->text_sequences,
         packet->text_command_count * sizeof(uint32_t));
  memcpy(destination->shape_sequences, packet->shape_sequences,
         packet->shape_command_count * sizeof(uint32_t));
  destination->text_length = packet->text_length;
  destination->text_command_count = packet->text_command_count;
  destination->shape_command_count = packet->shape_command_count;
  for (uint32_t index = 0; index < packet->text_command_count; ++index) {
    destination->text_commands[index] = packet->text_commands[index];
    if (packet->text_commands[index].kind == MULTIPLEX_NATIVE_DRAW_TEXT) {
      const size_t offset =
          (size_t)(packet->text_commands[index].text_ptr - packet->text);
      destination->text_commands[index].text_ptr = destination->text + offset;
    }
  }
}

static void *run_renderer(void *context) {
  MultiplexPresentation *presentation = context;
  const uint32_t started = gettick();
  MultiplexReferenceFrameRender render = {0};
  const MultiplexReferenceFrameStatus status =
      presentation->renderer_render_function(&presentation->reference_frame,
                                             false, &render, 0);
  const uint32_t elapsed =
      (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
  LWP_MutexLock(presentation->renderer_mutex);
  presentation->renderer_status = status;
  presentation->renderer_render = render;
  presentation->renderer_stage = multiplex_native_reference_render_stage();
  presentation->renderer_render_us = elapsed;
  presentation->renderer_complete = true;
  LWP_MutexUnlock(presentation->renderer_mutex);
  return NULL;
}

static bool allocate_tiles(MultiplexPresentation *presentation,
                           unsigned tile_count, size_t tile_bytes) {
  if (presentation == NULL || tile_count == 0 || tile_bytes == 0) {
    return false;
  }
  if ((size_t)tile_count > (SIZE_MAX - 31u) / tile_bytes) {
    return false;
  }
  presentation->allocation = malloc(tile_count * tile_bytes + 31u);
  if (presentation->allocation == NULL) {
    return false;
  }
  presentation->pixels =
      (uint8_t *)(((uintptr_t)presentation->allocation + 31u) &
                  ~(uintptr_t)31u);
  presentation->textures = calloc(tile_count, sizeof(*presentation->textures));
  if (presentation->textures == NULL) {
    free(presentation->allocation);
    presentation->allocation = NULL;
    presentation->pixels = NULL;
    return false;
  }
  presentation->tile_count = tile_count;
  presentation->tile_bytes = tile_bytes;
  presentation->renderer_thread = LWP_THREAD_NULL;
  if (LWP_MutexInit(&presentation->renderer_mutex, false) != 0) {
    free(presentation->textures);
    free(presentation->allocation);
    presentation->textures = NULL;
    presentation->allocation = NULL;
    presentation->pixels = NULL;
    return false;
  }
  presentation->renderer_mutex_ready = true;
  memset(presentation->pixels, 0, tile_count * tile_bytes);
  return true;
}

static void initialize_tiles(MultiplexPresentation *presentation,
                             unsigned tile_width, unsigned tile_height) {
  if (presentation == NULL || presentation->textures == NULL) {
    return;
  }
  for (unsigned index = 0; index < presentation->tile_count; ++index) {
    GX_InitTexObj(&presentation->textures[index],
                  presentation->pixels + index * presentation->tile_bytes,
                  tile_width, tile_height, GX_TF_RGBA8, GX_CLAMP, GX_CLAMP,
                  GX_FALSE);
    GX_InitTexObjLOD(&presentation->textures[index], GX_NEAR, GX_NEAR, 0, 0, 0,
                     GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
}

static void initialize_font(MultiplexPresentation *presentation, void *atlas,
                            unsigned atlas_width, unsigned atlas_height) {
  if (presentation == NULL || presentation->textures == NULL || atlas == NULL) {
    return;
  }
  GX_InitTexObj(&presentation->font_texture, atlas, atlas_width, atlas_height,
                GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&presentation->font_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0,
                   GX_FALSE, GX_FALSE, GX_ANISO_1);
}

static void initialize_textures(MultiplexPresentation *presentation) {
  if (presentation == NULL) {
    return;
  }
  DCFlushRange(geist_atlas, GEIST_ATLAS_WIDTH * GEIST_ATLAS_HEIGHT);
  initialize_tiles(presentation, TILE_WIDTH, TILE_HEIGHT);
  initialize_font(presentation, geist_atlas, GEIST_ATLAS_WIDTH,
                  GEIST_ATLAS_HEIGHT);
}

static void stop_renderer(MultiplexPresentation *presentation);
static void cleanup_runtime_resources(MultiplexPresentation *presentation);

MultiplexPresentationOpenResult
multiplex_presentation_open(MultiplexPresentation *presentation) {
  if (presentation == NULL || !initialize_video(presentation)) {
    cleanup_runtime_resources(presentation);
    return MULTIPLEX_PRESENTATION_OPEN_VIDEO_FAILED;
  }
  if (!allocate_tiles(presentation, MULTIPLEX_PRESENTATION_TILE_COUNT,
                      TILE_BYTES)) {
    cleanup_runtime_resources(presentation);
    return MULTIPLEX_PRESENTATION_OPEN_RESOURCES_FAILED;
  }
  const MultiplexReferenceFrameStatus status =
      multiplex_reference_frame_initialize(&presentation->reference_frame,
                                           LOGICAL_WIDTH * LOGICAL_HEIGHT * 4u);
  if (status != MULTIPLEX_REFERENCE_FRAME_OK) {
    SYS_Report("REFERENCE GX: Native frame initialization failed: %s\n",
               multiplex_reference_frame_status_name(status));
    cleanup_runtime_resources(presentation);
    return MULTIPLEX_PRESENTATION_OPEN_RESOURCES_FAILED;
  }
  initialize_textures(presentation);
  return MULTIPLEX_PRESENTATION_OPEN_READY;
}

static void cleanup_runtime_resources(MultiplexPresentation *presentation) {
  if (presentation == NULL) {
    return;
  }
  stop_renderer(presentation);
  multiplex_reference_frame_destroy(&presentation->reference_frame);
  if (presentation->renderer_mutex_ready) {
    LWP_MutexDestroy(presentation->renderer_mutex);
  }
  free(presentation->textures);
  free(presentation->allocation);
  free(presentation->poster_texture_pixels);
  free(presentation->poster_write_snapshot);
  free(presentation->poster_write_snapshot_rating_keys);
  free(presentation->gx_fifo);
  presentation->textures = NULL;
  presentation->allocation = NULL;
  presentation->pixels = NULL;
  presentation->poster_texture_pixels = NULL;
  presentation->poster_texture_count = 0;
  presentation->poster_write_snapshot = NULL;
  presentation->poster_write_snapshot_rating_keys = NULL;
  presentation->poster_write_snapshot_count = 0;
  presentation->poster_write_active = false;
  presentation->gx_fifo = NULL;
  presentation->renderer_mutex_ready = false;
  presentation->renderer_thread = LWP_THREAD_NULL;
}

void multiplex_presentation_destroy(MultiplexPresentation **presentation) {
  if (presentation == NULL || *presentation == NULL) {
    return;
  }
  MultiplexPresentation *owned = *presentation;
  cleanup_runtime_resources(owned);
  for (unsigned index = 0; index < 2; ++index) {
    if (owned->framebuffers[index] != NULL) {
      free(MEM_K1_TO_K0(owned->framebuffers[index]));
      owned->framebuffers[index] = NULL;
    }
  }
  owned->video_mode = NULL;
  free(owned);
  *presentation = NULL;
}

MultiplexPresentationBorrowedFatalVideo
multiplex_presentation_finalize_for_fatal(MultiplexPresentation *presentation) {
  MultiplexPresentationBorrowedFatalVideo video = {0};
  if (presentation == NULL) {
    return video;
  }
  cleanup_runtime_resources(presentation);
  video.mode = presentation->video_mode;
  video.framebuffer =
      presentation->framebuffers[presentation->framebuffer_index & 1u];
  return video;
}

static bool renderer_running(const MultiplexPresentation *presentation) {
  if (presentation == NULL || !presentation->renderer_mutex_ready) {
    return false;
  }
  LWP_MutexLock(presentation->renderer_mutex);
  const bool running = presentation->renderer_thread != LWP_THREAD_NULL;
  LWP_MutexUnlock(presentation->renderer_mutex);
  return running;
}

static bool
launch_renderer(MultiplexPresentation *presentation, size_t stack_size,
                int priority, bool audit,
                MultiplexPresentationRenderFunction render_function) {
  if (presentation == NULL || !presentation->renderer_mutex_ready ||
      stack_size == 0 || render_function == NULL) {
    return false;
  }
  LWP_MutexLock(presentation->renderer_mutex);
  if (presentation->renderer_thread != LWP_THREAD_NULL) {
    LWP_MutexUnlock(presentation->renderer_mutex);
    return true;
  }
  presentation->renderer_stack = malloc(stack_size);
  if (presentation->renderer_stack == NULL) {
    LWP_MutexUnlock(presentation->renderer_mutex);
    return false;
  }
  presentation->renderer_complete = false;
  presentation->renderer_audit = audit;
  presentation->renderer_render_function = render_function;
  const int result = LWP_CreateThread(
      &presentation->renderer_thread, run_renderer, presentation,
      presentation->renderer_stack, stack_size, priority);
  if (result != 0) {
    free(presentation->renderer_stack);
    presentation->renderer_stack = NULL;
    presentation->renderer_thread = LWP_THREAD_NULL;
    presentation->renderer_render_function = NULL;
    LWP_MutexUnlock(presentation->renderer_mutex);
    return false;
  }
  LWP_MutexUnlock(presentation->renderer_mutex);
  return true;
}

static bool poll_renderer(MultiplexPresentation *presentation,
                          MultiplexReferenceFrameRender *render,
                          MultiplexReferenceFrameStatus *status,
                          uint32_t *stage, uint32_t *render_us, bool *audit) {
  if (presentation == NULL || !presentation->renderer_mutex_ready) {
    return false;
  }
  LWP_MutexLock(presentation->renderer_mutex);
  if (presentation->renderer_thread == LWP_THREAD_NULL ||
      !presentation->renderer_complete) {
    LWP_MutexUnlock(presentation->renderer_mutex);
    return false;
  }
  const lwp_t thread = presentation->renderer_thread;
  LWP_MutexUnlock(presentation->renderer_mutex);
  LWP_JoinThread(thread, NULL);
  LWP_MutexLock(presentation->renderer_mutex);
  if (render != NULL)
    *render = presentation->renderer_render;
  if (status != NULL)
    *status = presentation->renderer_status;
  if (stage != NULL)
    *stage = presentation->renderer_stage;
  if (render_us != NULL)
    *render_us = presentation->renderer_render_us;
  if (audit != NULL)
    *audit = presentation->renderer_audit;
  presentation->renderer_thread = LWP_THREAD_NULL;
  presentation->renderer_render_function = NULL;
  free(presentation->renderer_stack);
  presentation->renderer_stack = NULL;
  LWP_MutexUnlock(presentation->renderer_mutex);
  return true;
}

static void stop_renderer(MultiplexPresentation *presentation) {
  if (presentation == NULL || !presentation->renderer_mutex_ready) {
    return;
  }
  LWP_MutexLock(presentation->renderer_mutex);
  const lwp_t thread = presentation->renderer_thread;
  LWP_MutexUnlock(presentation->renderer_mutex);
  if (thread != LWP_THREAD_NULL) {
    LWP_JoinThread(thread, NULL);
    LWP_MutexLock(presentation->renderer_mutex);
    presentation->renderer_thread = LWP_THREAD_NULL;
    presentation->renderer_render_function = NULL;
    free(presentation->renderer_stack);
    presentation->renderer_stack = NULL;
    LWP_MutexUnlock(presentation->renderer_mutex);
  }
}

static uint8_t *tile_pixels(MultiplexPresentation *presentation,
                            unsigned tile_index) {
  return presentation != NULL && tile_index < presentation->tile_count
             ? presentation->pixels + tile_index * presentation->tile_bytes
             : NULL;
}

static GXTexObj *tile_texture(MultiplexPresentation *presentation,
                              unsigned tile_index) {
  return presentation != NULL && presentation->textures != NULL &&
                 tile_index < presentation->tile_count
             ? &presentation->textures[tile_index]
             : NULL;
}

static void load_font(const MultiplexPresentation *presentation) {
  if (presentation != NULL && presentation->textures != NULL) {
    GX_LoadTexObj(&presentation->font_texture, GX_TEXMAP0);
  }
}

void multiplex_presentation_profile_mark(MultiplexPresentation *presentation,
                                         uint32_t stage) {
  if (presentation == NULL) {
    return;
  }
  const uint32_t now = gettick();
  if (presentation->profile_stage_current >= 1 &&
      presentation->profile_stage_current <= 6) {
    presentation->profile_stage_us[presentation->profile_stage_current] +=
        (uint32_t)ticks_to_microsecs(now - presentation->profile_stage_started);
  }
  presentation->profile_stage_current = stage == 7 ? 0 : stage;
  presentation->profile_stage_started = now;
}

void multiplex_presentation_request_refresh(MultiplexPresentation *presentation,
                                            bool asynchronous) {
  if (presentation == NULL) {
    return;
  }
  presentation->native_frame_dirty = true;
  presentation->asynchronous_reference_requested |= asynchronous;
}

void multiplex_presentation_set_async_enabled(
    MultiplexPresentation *presentation, bool enabled) {
  if (presentation != NULL) {
    presentation->asynchronous_reference_enabled = enabled;
  }
}

void multiplex_presentation_set_network_activity(
    MultiplexPresentation *presentation, bool visible) {
  if (presentation == NULL) {
    return;
  }
  presentation->network_activity_visible = visible;
  if (visible) {
    presentation->network_activity_frame = 0;
  }
}

void multiplex_presentation_set_blocking_activity(
    MultiplexPresentation *presentation, bool visible) {
  if (presentation != NULL) {
    presentation->blocking_activity_visible = visible;
  }
}

static bool ensure_poster_storage(MultiplexPresentation *presentation) {
  if (presentation == NULL) {
    return false;
  }
  if (presentation->poster_texture_pixels != NULL) {
    return true;
  }
  const size_t bytes = (size_t)MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT *
                       MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
  presentation->poster_texture_pixels = memalign(32, bytes);
  if (presentation->poster_texture_pixels == NULL) {
    return false;
  }
  memset(presentation->poster_texture_pixels, 0, bytes);
  DCFlushRange(presentation->poster_texture_pixels, bytes);
  return true;
}

static uint8_t *poster_pixels(MultiplexPresentation *presentation,
                              uint16_t slot) {
  return presentation != NULL &&
                 slot < MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT &&
                 presentation->poster_texture_pixels != NULL
             ? presentation->poster_texture_pixels +
                   (size_t)slot * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES
             : NULL;
}

static bool
poster_write_matches(const MultiplexPresentation *presentation,
                     const MultiplexPresentationPosterWrite *write) {
  return presentation != NULL && write != NULL &&
         presentation->poster_write_active &&
         write->token == presentation->poster_write_generation &&
         write->pixels == presentation->poster_texture_pixels +
                              (size_t)presentation->poster_write_offset *
                                  MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
}

void multiplex_presentation_posters_cancel(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write) {
  if (presentation == NULL || write == NULL) {
    return;
  }
  if (poster_write_matches(presentation, write)) {
    free(presentation->poster_write_snapshot);
    free(presentation->poster_write_snapshot_rating_keys);
    presentation->poster_write_snapshot = NULL;
    presentation->poster_write_snapshot_rating_keys = NULL;
    presentation->poster_write_snapshot_count = 0;
    presentation->poster_write_active = false;
  }
  memset(write, 0, sizeof(*write));
}

bool multiplex_presentation_posters_begin(
    MultiplexPresentation *presentation, uint16_t offset, uint16_t count,
    MultiplexPresentationPosterWriteMode mode,
    MultiplexPresentationPosterWrite *write) {
  if (presentation == NULL || write == NULL || count == 0 ||
      mode > MULTIPLEX_PRESENTATION_POSTERS_REUSE ||
      offset >= MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT ||
      count > MULTIPLEX_PRESENTATION_POSTER_TEXTURE_COUNT - offset ||
      presentation->poster_write_active ||
      !ensure_poster_storage(presentation)) {
    return false;
  }
  memset(write, 0, sizeof(*write));
  presentation->poster_write_offset = offset;
  presentation->poster_write_count = count;
  presentation->poster_write_generation += 1u;
  if (presentation->poster_write_generation == 0) {
    presentation->poster_write_generation = 1u;
  }
  presentation->poster_write_active = true;
  write->pixels = poster_pixels(presentation, offset);
  write->token = presentation->poster_write_generation;
  if (mode == MULTIPLEX_PRESENTATION_POSTERS_REUSE &&
      presentation->poster_texture_count > offset) {
    const uint16_t available = presentation->poster_texture_count - offset;
    presentation->poster_write_snapshot_count =
        available < count ? available : count;
    const size_t pixel_bytes =
        (size_t)presentation->poster_write_snapshot_count *
        MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES;
    presentation->poster_write_snapshot = malloc(pixel_bytes);
    presentation->poster_write_snapshot_rating_keys = malloc(
        (size_t)presentation->poster_write_snapshot_count * sizeof(uint32_t));
    if (presentation->poster_write_snapshot != NULL &&
        presentation->poster_write_snapshot_rating_keys != NULL) {
      memcpy(presentation->poster_write_snapshot, write->pixels, pixel_bytes);
      for (uint16_t index = 0;
           index < presentation->poster_write_snapshot_count; ++index) {
        const uint16_t slot = offset + index;
        presentation->poster_write_snapshot_rating_keys[index] =
            slot < presentation->poster_texture_count
                ? presentation->poster_texture_rating_keys[slot]
                : 0;
      }
    } else {
      free(presentation->poster_write_snapshot);
      free(presentation->poster_write_snapshot_rating_keys);
      presentation->poster_write_snapshot = NULL;
      presentation->poster_write_snapshot_rating_keys = NULL;
      presentation->poster_write_snapshot_count = 0;
    }
  }
  return true;
}

bool multiplex_presentation_posters_reuse(
    MultiplexPresentation *presentation,
    const MultiplexPresentationPosterWrite *write, uint16_t index,
    uint32_t rating_key) {
  if (!poster_write_matches(presentation, write) ||
      index >= presentation->poster_write_count) {
    return false;
  }
  const uint16_t target = presentation->poster_write_offset + index;
  const uint16_t end =
      presentation->poster_write_offset + presentation->poster_write_count;
  for (uint16_t slot = 0; slot < presentation->poster_texture_count; ++slot) {
    const bool stable = slot < presentation->poster_write_offset ||
                        slot >= end || slot == target;
    if (stable &&
        presentation->poster_texture_rating_keys[slot] == rating_key) {
      if (slot != target) {
        memcpy(poster_pixels(presentation, target),
               poster_pixels(presentation, slot),
               MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
      }
      return true;
    }
  }
  if (presentation->poster_write_snapshot_rating_keys != NULL) {
    for (uint16_t slot = 0; slot < presentation->poster_write_snapshot_count;
         ++slot) {
      if (presentation->poster_write_snapshot_rating_keys[slot] == rating_key) {
        memcpy(poster_pixels(presentation, target),
               presentation->poster_write_snapshot +
                   (size_t)slot * MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES,
               MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
        return true;
      }
    }
  }
  return false;
}

bool multiplex_presentation_posters_commit(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write, const uint32_t *rating_keys) {
  if (!poster_write_matches(presentation, write) || rating_keys == NULL) {
    return false;
  }
  for (uint16_t index = 0; index < presentation->poster_write_count; ++index) {
    const uint16_t slot = presentation->poster_write_offset + index;
    uint8_t *pixels = poster_pixels(presentation, slot);
    GX_InitTexObj(&presentation->poster_textures[slot], pixels,
                  MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
                  MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, GX_TF_RGB565, GX_CLAMP,
                  GX_CLAMP, GX_FALSE);
    GX_InitTexObjLOD(&presentation->poster_textures[slot], GX_LINEAR, GX_LINEAR,
                     0, 0, 0, GX_FALSE, GX_FALSE, GX_ANISO_1);
  }
  DCFlushRange(write->pixels, (size_t)presentation->poster_write_count *
                                  MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  GX_InvalidateTexAll();
  for (uint16_t index = 0; index < presentation->poster_write_count; ++index) {
    presentation->poster_texture_rating_keys[presentation->poster_write_offset +
                                             index] = rating_keys[index];
  }
  const uint16_t end =
      presentation->poster_write_offset + presentation->poster_write_count;
  if (presentation->poster_texture_count < end) {
    presentation->poster_texture_count = end;
  }
  multiplex_presentation_posters_cancel(presentation, write);
  return true;
}

bool multiplex_presentation_poster_matches(
    const MultiplexPresentation *presentation, uint16_t slot,
    uint32_t rating_key) {
  return presentation != NULL && slot < presentation->poster_texture_count &&
         presentation->poster_texture_rating_keys[slot] == rating_key;
}

MultiplexPresentationStatus
multiplex_presentation_status(const MultiplexPresentation *presentation) {
  MultiplexPresentationStatus status = {0};
  if (presentation == NULL) {
    return status;
  }
  status.screen = presentation->presented_screen;
  status.video_visible = presentation->video_surface.visible != 0 &&
                         presentation->video_surface.width > 0.0f &&
                         presentation->video_surface.height > 0.0f;
  status.video_playing = presentation->video_surface.playing != 0;
  const uint32_t screen = multiplex_native_app_screen();
  if (screen == MULTIPLEX_SCREEN_HOME || screen == MULTIPLEX_SCREEN_BROWSE ||
      screen == MULTIPLEX_SCREEN_SEARCH_RESULTS) {
    for (uint32_t index = 0; index < presentation->poster_surface_count;
         ++index) {
      const MultiplexPosterSurface *surface =
          &presentation->poster_surfaces[index];
      if (surface->focused != 0 && surface->image_id != 0 &&
          surface->image_id <= presentation->poster_texture_count) {
        status.focused_rating_key =
            presentation->poster_texture_rating_keys[surface->image_id - 1u];
        break;
      }
    }
  }
  return status;
}

MultiplexPresentationRenderDiagnostic multiplex_presentation_render_diagnostic(
    const MultiplexPresentation *presentation) {
  MultiplexPresentationRenderDiagnostic diagnostic = {0};
  if (presentation != NULL) {
    diagnostic.status = presentation->last_render_status;
    diagnostic.stage = presentation->last_render_stage;
    diagnostic.asynchronous = presentation->last_render_asynchronous;
  }
  return diagnostic;
}

static void texture_vertex(float x, float y, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(255, 255, 255, 255);
  GX_TexCoord2f32(u, v);
}

static void load_ui_translation_xy(MultiplexPresentation *presentation, float x,
                                   float y) {
  Mtx transform;
  presentation->ui_draw_translation_x = x;
  presentation->ui_draw_translation_y = y;
  guMtxTrans(transform, x, y, 0.0f);
  GX_LoadPosMtxImm(transform, GX_PNMTX0);
}

static void load_ui_translation(MultiplexPresentation *presentation, float y) {
  load_ui_translation_xy(presentation, 0.0f, y);
}

static void set_ui_draw_clip(MultiplexPresentation *presentation, float left,
                             float top, float right, float bottom) {
  presentation->ui_draw_clip_active = true;
  presentation->ui_draw_clip_left = left;
  presentation->ui_draw_clip_top = top;
  presentation->ui_draw_clip_right = right;
  presentation->ui_draw_clip_bottom = bottom;
}

static void clear_ui_draw_clip(MultiplexPresentation *presentation) {
  presentation->ui_draw_clip_active = false;
}

static void configure_color_pipeline(void) {
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetNumChans(1);
  GX_SetChanCtrl(GX_COLOR0A0, GX_DISABLE, GX_SRC_REG, GX_SRC_VTX, GX_LIGHTNULL,
                 GX_DF_NONE, GX_AF_NONE);
  GX_SetNumTexGens(0);
  GX_SetNumTevStages(1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_PASSCLR);
}

static void configure_font_pipeline(MultiplexPresentation *presentation) {
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
  GX_SetTevColorIn(GX_TEVSTAGE0, GX_CC_ZERO, GX_CC_ZERO, GX_CC_ZERO,
                   GX_CC_RASC);
  GX_SetTevColorOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_TRUE,
                   GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE0, GX_CA_ZERO, GX_CA_TEXA, GX_CA_RASA,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_TRUE,
                   GX_TEVPREV);
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  load_font(presentation);
}

static GXColor command_color(MultiplexPresentation *presentation,
                             uint32_t rgba) {
  GXColor color = {
      .r = (uint8_t)(rgba >> 24u),
      .g = (uint8_t)(rgba >> 16u),
      .b = (uint8_t)(rgba >> 8u),
      .a = (uint8_t)rgba,
  };
  if (presentation->presented_screen == MULTIPLEX_SCREEN_PLAYER) {
    color.a =
        (uint8_t)(((uint16_t)color.a * presentation->ui_frame_alpha + 127u) /
                  255u);
  }
  return color;
}

static void set_text_scissor(MultiplexPresentation *presentation,
                             const MultiplexNativeDrawCommand *command) {
  if (command->has_clip == 0 && !presentation->ui_draw_clip_active) {
    GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                  presentation->video_mode->efbHeight);
    return;
  }
  float left = command->has_clip != 0
                   ? command->clip_x + presentation->ui_draw_translation_x
                   : 0.0f;
  float top = command->has_clip != 0
                  ? command->clip_y + presentation->ui_draw_translation_y
                  : 0.0f;
  float right =
      command->has_clip != 0 ? left + command->clip_width : LOGICAL_WIDTH;
  float bottom =
      command->has_clip != 0 ? top + command->clip_height : LOGICAL_HEIGHT;
  if (presentation->ui_draw_clip_active) {
    left = fmaxf(left, presentation->ui_draw_clip_left);
    top = fmaxf(top, presentation->ui_draw_clip_top);
    right = fminf(right, presentation->ui_draw_clip_right);
    bottom = fminf(bottom, presentation->ui_draw_clip_bottom);
  }
  if (left < 0.0f)
    left = 0.0f;
  if (top < 0.0f)
    top = 0.0f;
  if (right > LOGICAL_WIDTH)
    right = LOGICAL_WIDTH;
  if (bottom > LOGICAL_HEIGHT)
    bottom = LOGICAL_HEIGHT;
  if (right <= left || bottom <= top) {
    GX_SetScissor(0, 0, 0, 0);
    return;
  }
  const float scale_x =
      presentation->video_mode->fbWidth / (float)LOGICAL_WIDTH;
  const float scale_y =
      presentation->video_mode->efbHeight / (float)LOGICAL_HEIGHT;
  GX_SetScissor((uint32_t)(left * scale_x), (uint32_t)(top * scale_y),
                (uint32_t)((right - left) * scale_x),
                (uint32_t)((bottom - top) * scale_y));
}

static void set_poster_scissor(MultiplexPresentation *presentation,
                               const MultiplexPosterSurface *surface) {
  if (surface->has_clip == 0 && !presentation->ui_draw_clip_active) {
    GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                  presentation->video_mode->efbHeight);
    return;
  }
  float left = surface->has_clip != 0
                   ? surface->clip_x + presentation->ui_draw_translation_x
                   : 0.0f;
  float top = surface->has_clip != 0
                  ? surface->clip_y + presentation->ui_draw_translation_y
                  : 0.0f;
  float right =
      surface->has_clip != 0 ? left + surface->clip_width : LOGICAL_WIDTH;
  float bottom =
      surface->has_clip != 0 ? top + surface->clip_height : LOGICAL_HEIGHT;
  if (presentation->ui_draw_clip_active) {
    left = fmaxf(left, presentation->ui_draw_clip_left);
    top = fmaxf(top, presentation->ui_draw_clip_top);
    right = fminf(right, presentation->ui_draw_clip_right);
    bottom = fminf(bottom, presentation->ui_draw_clip_bottom);
  }
  left = fmaxf(0.0f, left);
  top = fmaxf(0.0f, top);
  right = fminf(LOGICAL_WIDTH, right);
  bottom = fminf(LOGICAL_HEIGHT, bottom);
  if (right <= left || bottom <= top) {
    GX_SetScissor(0, 0, 0, 0);
    return;
  }
  const float scale_x =
      presentation->video_mode->fbWidth / (float)LOGICAL_WIDTH;
  const float scale_y =
      presentation->video_mode->efbHeight / (float)LOGICAL_HEIGHT;
  GX_SetScissor((uint32_t)(left * scale_x), (uint32_t)(top * scale_y),
                (uint32_t)((right - left) * scale_x),
                (uint32_t)((bottom - top) * scale_y));
}

static unsigned geist_size_index(float size) {
  unsigned closest = 0;
  float closest_distance = fabsf(size - (float)geist_sizes[0]);
  for (unsigned index = 1; index < GEIST_SIZE_COUNT; ++index) {
    const float distance = fabsf(size - (float)geist_sizes[index]);
    if (distance < closest_distance) {
      closest = index;
      closest_distance = distance;
    }
  }
  return closest;
}

static void font_vertex(float x, float y, GXColor color, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
  GX_TexCoord2f32(u, v);
}

static void
draw_native_text_command(MultiplexPresentation *presentation,
                         const MultiplexNativeDrawCommand *command) {
  if (command->text_ptr == NULL || command->text_len == 0) {
    return;
  }
  const GXColor color = command_color(presentation, command->color_rgba);
  if (color.a == 0) {
    return;
  }
  const unsigned size_index = geist_size_index(command->font_size);
  const float atlas_size = (float)geist_sizes[size_index];
  const float scale = command->font_size / atlas_size;
  const float start_x = command->has_clip != 0 && command->clip_x > command->x
                            ? command->clip_x
                            : command->x;
  float cursor_x = start_x;
  float baseline = command->y;
  uint32_t draw_length = command->text_len;
  uint32_t trailing_dots = 0;
  if (command->has_clip != 0) {
    const float available = command->clip_x + command->clip_width - start_x;
    float total_width = 0.0f;
    for (uint32_t index = 0; index < command->text_len; ++index) {
      uint8_t character = command->text_ptr[index];
      if (character == '\n')
        continue;
      if (character < GEIST_FIRST_CHARACTER ||
          character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
        character = '?';
      }
      const GeistGlyphMetric *metric =
          &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
      total_width += ((float)metric->advance_64 / 64.0f) * scale;
    }
    if (total_width > available) {
      const GeistGlyphMetric *dot =
          &geist_metrics[size_index]['.' - GEIST_FIRST_CHARACTER];
      const float dot_width = ((float)dot->advance_64 / 64.0f) * scale;
      trailing_dots = available >= dot_width * 3.0f
                          ? 3u
                          : (available >= dot_width ? 1u : 0u);
      const float content_width = available - dot_width * trailing_dots;
      float prefix_width = 0.0f;
      draw_length = 0;
      while (draw_length < command->text_len) {
        uint8_t character = command->text_ptr[draw_length];
        if (character == '\n')
          break;
        if (character < GEIST_FIRST_CHARACTER ||
            character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
          character = '?';
        }
        const GeistGlyphMetric *metric =
            &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
        const float advance = ((float)metric->advance_64 / 64.0f) * scale;
        if (prefix_width + advance > content_width)
          break;
        prefix_width += advance;
        ++draw_length;
      }
      while (draw_length > 0 && command->text_ptr[draw_length - 1u] == '.') {
        --draw_length;
      }
    }
  }
  uint32_t glyph_count = 0;
  for (uint32_t index = 0; index < draw_length; ++index) {
    uint8_t character = command->text_ptr[index];
    if (character == '\n')
      continue;
    if (character < GEIST_FIRST_CHARACTER ||
        character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
      character = '?';
    }
    const GeistGlyphMetric *metric =
        &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
    if (metric->width > 0 && metric->height > 0)
      ++glyph_count;
  }
  glyph_count += trailing_dots;
  if (glyph_count == 0 || glyph_count > UINT16_MAX / 4u) {
    return;
  }

  GX_Begin(GX_QUADS, GX_VTXFMT0, (uint16_t)(glyph_count * 4u));
  for (uint32_t index = 0; index < draw_length; ++index) {
    uint8_t character = command->text_ptr[index];
    if (character == '\n') {
      cursor_x = start_x;
      baseline += command->font_size * 1.25f;
      continue;
    }
    if (character < GEIST_FIRST_CHARACTER ||
        character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
      character = '?';
    }
    const GeistGlyphMetric *metric =
        &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
    if (metric->width > 0 && metric->height > 0) {
      const float left = cursor_x + (float)metric->bearing_x * scale;
      const float top = baseline + (float)metric->bearing_y * scale;
      const float right = left + (float)metric->width * scale;
      const float bottom = top + (float)metric->height * scale;
      const float u0 = (float)metric->u / (float)GEIST_ATLAS_WIDTH;
      const float v0 = (float)metric->v / (float)GEIST_ATLAS_HEIGHT;
      const float u1 =
          (float)(metric->u + metric->width) / (float)GEIST_ATLAS_WIDTH;
      const float v1 =
          (float)(metric->v + metric->height) / (float)GEIST_ATLAS_HEIGHT;
      font_vertex(left, top, color, u0, v0);
      font_vertex(right, top, color, u1, v0);
      font_vertex(right, bottom, color, u1, v1);
      font_vertex(left, bottom, color, u0, v1);
    }
    cursor_x += ((float)metric->advance_64 / 64.0f) * scale;
  }
  const GeistGlyphMetric *dot =
      &geist_metrics[size_index]['.' - GEIST_FIRST_CHARACTER];
  for (uint32_t index = 0; index < trailing_dots; ++index) {
    if (dot->width > 0 && dot->height > 0) {
      const float left = cursor_x + (float)dot->bearing_x * scale;
      const float top = baseline + (float)dot->bearing_y * scale;
      const float right = left + (float)dot->width * scale;
      const float bottom = top + (float)dot->height * scale;
      const float u0 = (float)dot->u / (float)GEIST_ATLAS_WIDTH;
      const float v0 = (float)dot->v / (float)GEIST_ATLAS_HEIGHT;
      const float u1 = (float)(dot->u + dot->width) / (float)GEIST_ATLAS_WIDTH;
      const float v1 =
          (float)(dot->v + dot->height) / (float)GEIST_ATLAS_HEIGHT;
      font_vertex(left, top, color, u0, v0);
      font_vertex(right, top, color, u1, v0);
      font_vertex(right, bottom, color, u1, v1);
      font_vertex(left, bottom, color, u0, v1);
    }
    cursor_x += ((float)dot->advance_64 / 64.0f) * scale;
  }
  GX_End();
}

static void draw_native_text_command_at(MultiplexPresentation *presentation,
                                        const NativeUiPacket *packet,
                                        uint32_t index) {
  const MultiplexNativeDrawCommand *command = &packet->text_commands[index];
  set_text_scissor(presentation, command);
  if (command->kind == MULTIPLEX_NATIVE_DRAW_GLYPH) {
    uint8_t character = '?';
    for (uint32_t glyph_index = 0; glyph_index < GEIST_CHARACTER_COUNT;
         ++glyph_index) {
      if (geist_glyph_ids[glyph_index] == command->glyph_id) {
        character = (uint8_t)(GEIST_FIRST_CHARACTER + glyph_index);
        break;
      }
    }
    MultiplexNativeDrawCommand glyph = *command;
    glyph.text_ptr = &character;
    glyph.text_len = 1;
    draw_native_text_command(presentation, &glyph);
  } else if (command->kind == MULTIPLEX_NATIVE_DRAW_TEXT) {
    draw_native_text_command(presentation, command);
  }
}

static void color_vertex(float x, float y, GXColor color) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
}

static void fill_circle(float center_x, float center_y, float radius,
                        GXColor color) {
  static const float unit_circle[9][2] = {
      {1.0f, 0.0f},  {0.7071068f, 0.7071068f},
      {0.0f, 1.0f},  {-0.7071068f, 0.7071068f},
      {-1.0f, 0.0f}, {-0.7071068f, -0.7071068f},
      {0.0f, -1.0f}, {0.7071068f, -0.7071068f},
      {1.0f, 0.0f},
  };
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 10);
  color_vertex(center_x, center_y, color);
  for (unsigned index = 0; index < 9; ++index) {
    color_vertex(center_x + unit_circle[index][0] * radius,
                 center_y + unit_circle[index][1] * radius, color);
  }
  GX_End();
}

static void draw_activity_dots(float center_y, uint32_t frame) {
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  const uint32_t active = (frame / 10u) % 3u;
  for (uint32_t index = 0; index < 3; ++index) {
    const uint8_t alpha = index == active ? 230u : 72u;
    fill_circle(312.0f + index * 8.0f, center_y, 2.0f,
                (GXColor){212, 212, 216, alpha});
  }
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
}

static void fill_rect(float left, float top, float right, float bottom,
                      GXColor color);

static void draw_activity(MultiplexPresentation *presentation) {
  if (presentation->network_activity_visible) {
    draw_activity_dots(380.0f, presentation->network_activity_frame);
    presentation->network_activity_frame += 1;
    return;
  }
  if (presentation->blocking_activity_visible) {
    draw_activity_dots(462.0f, 0);
    return;
  }
  if (renderer_running(presentation) &&
      presentation->screen_transition_frame >= 8u) {
    draw_activity_dots(462.0f, presentation->screen_transition_frame - 8u);
  }
  if (renderer_running(presentation)) {
    presentation->screen_transition_frame += 1;
  }
}

static void draw_stats_for_nerds(MultiplexPresentation *presentation) {
  if (presentation->video_surface.visible == 0 ||
      multiplex_native_app_stats_for_nerds_enabled() == 0) {
    return;
  }
  const MultiplexPlaybackMetrics *metrics =
      &presentation->frame_input.playback.metrics;

  const struct mallinfo heap = mallinfo();
  char text[256];
  const int length = snprintf(
      text, sizeof(text),
      "UI %u.%u  VIDEO %u.%u  CODEC %u/%u ms  UPLOAD %u ms\n"
      "NET %u KiB/s  QUEUE V%u A%u KiB  AUDIO %u/18 U%u\n"
      "HEAP %u KiB free  TOP %u KiB",
      presentation->diagnostic_presentation_fps_tenths / 10u,
      presentation->diagnostic_presentation_fps_tenths % 10u,
      metrics->decoder_fps_tenths / 10u, metrics->decoder_fps_tenths % 10u,
      metrics->codec_average_us / 1000u, metrics->codec_max_us / 1000u,
      metrics->upload_average_us / 1000u, metrics->network_kib_per_second,
      metrics->queued_video_bytes / 1024u, metrics->queued_audio_bytes / 1024u,
      metrics->audio_ready_buffers, metrics->audio_underruns,
      (uint32_t)heap.fordblks / 1024u, (uint32_t)heap.keepcost / 1024u);
  if (length <= 0) {
    return;
  }
  const size_t available =
      (size_t)length < sizeof(text) ? (size_t)length : sizeof(text) - 1u;

  configure_color_pipeline();
  fill_rect(8.0f, 8.0f, 632.0f, 74.0f, (GXColor){0, 0, 0, 220});
  configure_font_pipeline(presentation);
  const MultiplexNativeDrawCommand command = {
      .kind = MULTIPLEX_NATIVE_DRAW_TEXT,
      .x = 16.0f,
      .y = 17.0f,
      .color_rgba = 0xffffffffu,
      .text_ptr = (const uint8_t *)text,
      .text_len = (uint32_t)available,
      .font_size = 13.0f,
  };
  draw_native_text_command(presentation, &command);
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

static const float rounded_arc[5][2] = {
    {1.0f, 0.0f},
    {0.9238795f, 0.3826834f},
    {0.7071068f, 0.7071068f},
    {0.3826834f, 0.9238795f},
    {0.0f, 1.0f},
};

static void fill_rounded_corner(float center_x, float center_y, float radius,
                                float x_sign, float y_sign, GXColor color) {
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 6);
  color_vertex(center_x, center_y, color);
  for (unsigned index = 0; index < 5; ++index) {
    color_vertex(center_x + x_sign * rounded_arc[index][0] * radius,
                 center_y + y_sign * rounded_arc[index][1] * radius, color);
  }
  GX_End();
}

static void fill_rounded_color_rect(float left, float top, float right,
                                    float bottom, float radius, GXColor color) {
  const float width = right - left;
  const float height = bottom - top;
  const float maximum = (width < height ? width : height) * 0.5f;
  if (radius > maximum)
    radius = maximum;
  if (radius < 1.0f) {
    fill_rect(left, top, right, bottom, color);
    return;
  }
  fill_rect(left + radius, top, right - radius, bottom, color);
  fill_rect(left, top + radius, right, bottom - radius, color);
  fill_rounded_corner(left + radius, top + radius, radius, -1.0f, -1.0f, color);
  fill_rounded_corner(right - radius, top + radius, radius, 1.0f, -1.0f, color);
  fill_rounded_corner(right - radius, bottom - radius, radius, 1.0f, 1.0f,
                      color);
  fill_rounded_corner(left + radius, bottom - radius, radius, -1.0f, 1.0f,
                      color);
}

static void stroke_rounded_corner(float center_x, float center_y,
                                  float outer_radius, float inner_radius,
                                  float x_sign, float y_sign, GXColor color) {
  GX_Begin(GX_TRIANGLESTRIP, GX_VTXFMT0, 10);
  for (unsigned index = 0; index < 5; ++index) {
    color_vertex(center_x + x_sign * rounded_arc[index][0] * outer_radius,
                 center_y + y_sign * rounded_arc[index][1] * outer_radius,
                 color);
    color_vertex(center_x + x_sign * rounded_arc[index][0] * inner_radius,
                 center_y + y_sign * rounded_arc[index][1] * inner_radius,
                 color);
  }
  GX_End();
}

static void stroke_rounded_color_rect(float left, float top, float right,
                                      float bottom, float radius, float stroke,
                                      GXColor color) {
  const float width = right - left;
  const float height = bottom - top;
  const float maximum = (width < height ? width : height) * 0.5f;
  if (radius > maximum)
    radius = maximum;
  if (stroke < 1.0f)
    stroke = 1.0f;
  if (stroke * 2.0f >= width || stroke * 2.0f >= height || radius < 1.0f) {
    fill_rect(left, top, right, top + stroke, color);
    fill_rect(left, bottom - stroke, right, bottom, color);
    fill_rect(left, top + stroke, left + stroke, bottom - stroke, color);
    fill_rect(right - stroke, top + stroke, right, bottom - stroke, color);
    return;
  }
  const float inner_radius = radius > stroke ? radius - stroke : 0.0f;
  fill_rect(left + radius, top, right - radius, top + stroke, color);
  fill_rect(left + radius, bottom - stroke, right - radius, bottom, color);
  fill_rect(left, top + radius, left + stroke, bottom - radius, color);
  fill_rect(right - stroke, top + radius, right, bottom - radius, color);
  stroke_rounded_corner(left + radius, top + radius, radius, inner_radius,
                        -1.0f, -1.0f, color);
  stroke_rounded_corner(right - radius, top + radius, radius, inner_radius,
                        1.0f, -1.0f, color);
  stroke_rounded_corner(right - radius, bottom - radius, radius, inner_radius,
                        1.0f, 1.0f, color);
  stroke_rounded_corner(left + radius, bottom - radius, radius, inner_radius,
                        -1.0f, 1.0f, color);
}

static float native_stroke_radius(const NativeUiPacket *packet,
                                  uint32_t command_index,
                                  const MultiplexNativeDrawCommand *stroke) {
  if (stroke->radius >= 1.0f)
    return stroke->radius;
  for (uint32_t index = command_index; index > 0; --index) {
    const MultiplexNativeDrawCommand *fill =
        &packet->shape_commands[index - 1u];
    if (fill->kind != MULTIPLEX_NATIVE_DRAW_FILL_ROUNDED_RECT)
      continue;
    const float left_inset = fill->x - stroke->x;
    const float top_inset = fill->y - stroke->y;
    const float right_inset = stroke->x + stroke->width - fill->x - fill->width;
    const float bottom_inset =
        stroke->y + stroke->height - fill->y - fill->height;
    if (left_inset < 0.0f || top_inset < 0.0f || right_inset < 0.0f ||
        bottom_inset < 0.0f || left_inset > 4.0f || top_inset > 4.0f ||
        right_inset > 4.0f || bottom_inset > 4.0f) {
      continue;
    }
    const float inset =
        fmaxf(fmaxf(left_inset, top_inset), fmaxf(right_inset, bottom_inset));
    return fill->radius + inset;
  }
  return 0.0f;
}

static bool details_backdrop_active(MultiplexPresentation *presentation) {
  if (presentation->presented_screen != MULTIPLEX_SCREEN_DETAILS ||
      presentation->poster_surface_count == 0 ||
      presentation->poster_texture_count == 0) {
    return false;
  }
  const uint32_t image_id = presentation->poster_surfaces[0].image_id;
  return image_id != 0 && image_id <= presentation->poster_texture_count;
}

static bool is_ambient_background(MultiplexPresentation *presentation,
                                  const MultiplexNativeDrawCommand *command) {
  return (details_backdrop_active(presentation) ||
          presentation->player_startup_backdrop_visible) &&
         command->kind == MULTIPLEX_NATIVE_DRAW_FILL_RECT &&
         command->x <= 0.0f && command->y <= 0.0f &&
         command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT;
}

static void draw_native_shape_command_at(MultiplexPresentation *presentation,
                                         const NativeUiPacket *packet,
                                         uint32_t index) {
  const MultiplexNativeDrawCommand *command = &packet->shape_commands[index];
  if (is_ambient_background(presentation, command))
    return;
  set_text_scissor(presentation, command);
  GXColor color = command_color(presentation, command->color_rgba);
  if (presentation->modal_surface.visible != 0 &&
      command->kind == MULTIPLEX_NATIVE_DRAW_FILL_RECT && command->x <= 0.0f &&
      command->y <= 0.0f && command->width >= LOGICAL_WIDTH &&
      command->height >= LOGICAL_HEIGHT && color.a > 0u && color.a < 96u) {
    color.a = 176u;
  }
  const float left = command->x;
  const float top = command->y;
  const float right = left + command->width;
  const float bottom = top + command->height;
  switch (command->kind) {
  case MULTIPLEX_NATIVE_DRAW_FILL_RECT:
    fill_rect(left, top, right, bottom, color);
    break;
  case MULTIPLEX_NATIVE_DRAW_FILL_ROUNDED_RECT:
    fill_rounded_color_rect(left, top, right, bottom, command->radius, color);
    break;
  case MULTIPLEX_NATIVE_DRAW_STROKE_RECT:
    stroke_rounded_color_rect(left, top, right, bottom,
                              native_stroke_radius(packet, index, command),
                              command->stroke_width, color);
    break;
  case MULTIPLEX_NATIVE_DRAW_LINE: {
    const float stroke =
        command->stroke_width < 1.0f ? 1.0f : command->stroke_width;
    if (fabsf(command->x2 - command->x) >= fabsf(command->y2 - command->y)) {
      fill_rect(fminf(command->x, command->x2),
                fminf(command->y, command->y2) - stroke * 0.5f,
                fmaxf(command->x, command->x2),
                fminf(command->y, command->y2) + stroke * 0.5f, color);
    } else {
      fill_rect(fminf(command->x, command->x2) - stroke * 0.5f,
                fminf(command->y, command->y2),
                fminf(command->x, command->x2) + stroke * 0.5f,
                fmaxf(command->y, command->y2), color);
    }
    break;
  }
  case MULTIPLEX_NATIVE_DRAW_PATH_LINE: {
    const float dx = command->x2 - command->x;
    const float dy = command->y2 - command->y;
    const float length = sqrtf(dx * dx + dy * dy);
    if (length <= 0.001f) {
      break;
    }
    unsigned line_width = (unsigned)(command->stroke_width * 6.0f + 0.5f);
    if (line_width < 6u)
      line_width = 6u;
    if (line_width > 255u)
      line_width = 255u;
    GX_SetLineWidth((uint8_t)line_width, GX_TO_ZERO);
    GX_Begin(GX_LINES, GX_VTXFMT0, 2);
    color_vertex(command->x, command->y, color);
    color_vertex(command->x2, command->y2, color);
    GX_End();
    break;
  }
  case MULTIPLEX_NATIVE_DRAW_FILL_TRIANGLE:
    GX_Begin(GX_TRIANGLES, GX_VTXFMT0, 3);
    color_vertex(command->x, command->y, color);
    color_vertex(command->x2, command->y2, color);
    color_vertex(command->width, command->height, color);
    GX_End();
    break;
  default:
    break;
  }
}

static void draw_ambient_poster(MultiplexPresentation *presentation,
                                uint32_t texture_index, uint8_t scrim_alpha,
                                uint8_t left_scrim_alpha) {
  configure_ui_pipeline();
  GX_LoadTexObj(&presentation->poster_textures[texture_index], GX_TEXMAP0);

  /* Cover the screen with the center of the portrait. The heavy scrim turns
   * the cached poster into ambient color without competing with the content. */
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  texture_vertex(0.0f, 0.0f, 0.0f, 0.25f);
  texture_vertex(LOGICAL_WIDTH, 0.0f, 1.0f, 0.25f);
  texture_vertex(LOGICAL_WIDTH, LOGICAL_HEIGHT, 1.0f, 0.75f);
  texture_vertex(0.0f, LOGICAL_HEIGHT, 0.0f, 0.75f);
  GX_End();

  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  fill_rect(0.0f, 0.0f, LOGICAL_WIDTH, LOGICAL_HEIGHT,
            (GXColor){10, 10, 12, scrim_alpha});
  if (left_scrim_alpha != 0) {
    fill_rect(0.0f, 0.0f, 205.0f, LOGICAL_HEIGHT,
              (GXColor){10, 10, 12, left_scrim_alpha});
  }
}

static void draw_details_backdrop(MultiplexPresentation *presentation) {
  if (details_backdrop_active(presentation)) {
    draw_ambient_poster(presentation,
                        presentation->poster_surfaces[0].image_id - 1u, 224u,
                        44u);
  }
}

static int32_t
poster_texture_for_rating_key(MultiplexPresentation *presentation,
                              uint32_t rating_key) {
  if (rating_key == 0) {
    return -1;
  }
  for (uint16_t index = 0; index < presentation->poster_texture_count;
       ++index) {
    if (presentation->poster_texture_rating_keys[index] == rating_key) {
      return (int32_t)index;
    }
  }
  return -1;
}

static void draw_player_startup_backdrop(MultiplexPresentation *presentation) {
  const MultiplexPlaybackSnapshot *playback =
      &presentation->frame_input.playback;
  presentation->player_startup_backdrop_visible = false;
  if (presentation->presented_screen != MULTIPLEX_SCREEN_PLAYER ||
      playback->frame_ready) {
    return;
  }
  uint32_t rating_key = playback->rating_key;
  if (rating_key == 0 && (presentation->frame_input.startup_rating_key != 0)) {
    rating_key = presentation->frame_input.startup_rating_key;
  }
  const int32_t texture_index =
      poster_texture_for_rating_key(presentation, rating_key);
  if (texture_index < 0) {
    return;
  }
  presentation->player_startup_backdrop_visible = true;
  draw_ambient_poster(presentation, (uint32_t)texture_index, 176u, 0u);
}

static void draw_reference_frame(MultiplexPresentation *presentation) {
  configure_ui_pipeline();
  for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
    for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      const float left = tile_x * TILE_WIDTH;
      const float top = tile_y * TILE_HEIGHT;
      const float right = left + TILE_WIDTH;
      const float bottom = top + TILE_HEIGHT;

      GXTexObj *texture = tile_texture(presentation, tile_index);
      GX_LoadTexObj(texture, GX_TEXMAP0);
      GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
      texture_vertex(left, top, 0.0f, 0.0f);
      texture_vertex(right, top, 1.0f, 0.0f);
      texture_vertex(right, bottom, 1.0f, 1.0f);
      texture_vertex(left, bottom, 0.0f, 1.0f);
      GX_End();
    }
  }
}

static void poster_texture_vertex(const MultiplexPosterSurface *surface,
                                  float x, float y) {
  texture_vertex(x, y, (x - surface->x) / surface->width,
                 (y - surface->y) / surface->height);
}

static void draw_poster_rect(const MultiplexPosterSurface *surface, float left,
                             float top, float right, float bottom) {
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  poster_texture_vertex(surface, left, top);
  poster_texture_vertex(surface, right, top);
  poster_texture_vertex(surface, right, bottom);
  poster_texture_vertex(surface, left, bottom);
  GX_End();
}

static void draw_poster_corner(const MultiplexPosterSurface *surface,
                               float center_x, float center_y, float radius,
                               float x_sign, float y_sign) {
  static const float arc[5][2] = {
      {1.0f, 0.0f},
      {0.9238795f, 0.3826834f},
      {0.7071068f, 0.7071068f},
      {0.3826834f, 0.9238795f},
      {0.0f, 1.0f},
  };
  GX_Begin(GX_TRIANGLEFAN, GX_VTXFMT0, 6);
  poster_texture_vertex(surface, center_x, center_y);
  for (unsigned index = 0; index < 5; ++index) {
    poster_texture_vertex(surface, center_x + x_sign * arc[index][0] * radius,
                          center_y + y_sign * arc[index][1] * radius);
  }
  GX_End();
}

static void draw_rounded_poster(const MultiplexPosterSurface *surface) {
  const float maximum =
      (surface->width < surface->height ? surface->width : surface->height) *
      0.5f;
  float radius = surface->radius;
  if (radius > maximum) {
    radius = maximum;
  }
  if (radius < 1.0f) {
    draw_poster_rect(surface, surface->x, surface->y,
                     surface->x + surface->width, surface->y + surface->height);
    return;
  }

  const float left = surface->x;
  const float top = surface->y;
  const float right = left + surface->width;
  const float bottom = top + surface->height;
  draw_poster_rect(surface, left + radius, top, right - radius, bottom);
  draw_poster_rect(surface, left, top + radius, right, bottom - radius);
  draw_poster_corner(surface, left + radius, top + radius, radius, -1.0f,
                     -1.0f);
  draw_poster_corner(surface, right - radius, top + radius, radius, 1.0f,
                     -1.0f);
  draw_poster_corner(surface, right - radius, bottom - radius, radius, 1.0f,
                     1.0f);
  draw_poster_corner(surface, left + radius, bottom - radius, radius, -1.0f,
                     1.0f);
}

static MultiplexPosterSurface
poster_display_surface(const MultiplexPosterSurface *surface) {
  MultiplexPosterSurface display = *surface;
  if (surface->width < 68.0f)
    display.width = 68.0f;
  if (surface->height < 102.0f)
    display.height = 102.0f;
  return display;
}

static MultiplexPosterSurface
poster_clip_surface(const MultiplexPosterSurface *surface) {
  MultiplexPosterSurface clip = *surface;
  if (surface->width < 68.0f || surface->height < 102.0f) {
    clip.has_clip = 1u;
    clip.clip_x = surface->x;
    clip.clip_y = surface->y;
    clip.clip_width = surface->width;
    clip.clip_height = surface->height;
  }
  return clip;
}

static void draw_poster_surfaces(MultiplexPresentation *presentation) {
  if (presentation->poster_texture_count == 0) {
    return;
  }
  configure_ui_pipeline();
  for (uint32_t index = 0; index < presentation->poster_surface_count;
       ++index) {
    const MultiplexPosterSurface *surface =
        &presentation->poster_surfaces[index];
    if (surface->image_id == 0 ||
        surface->image_id > presentation->poster_texture_count) {
      continue;
    }
    const MultiplexPosterSurface clip = poster_clip_surface(surface);
    const MultiplexPosterSurface display = poster_display_surface(surface);
    set_poster_scissor(presentation, &clip);
    GX_LoadTexObj(&presentation->poster_textures[surface->image_id - 1u],
                  GX_TEXMAP0);
    if (surface->focused != 0) {
      const float progress = POSTER_FOCUS_FRAMES <= 1u
                                 ? 1.0f
                                 : (float)presentation->poster_focus_frame /
                                       (float)(POSTER_FOCUS_FRAMES - 1u);
      const float remaining = 1.0f - progress;
      const float eased = 1.0f - remaining * remaining * remaining;
      MultiplexPosterSurface lifted = display;
      lifted.x -= eased * 2.0f;
      lifted.y -= eased * 3.0f;
      lifted.width += eased * 4.0f;
      lifted.height += eased * 4.0f;
      lifted.radius += eased;
      draw_rounded_poster(&lifted);
    } else {
      draw_rounded_poster(&display);
    }
  }
  for (uint32_t index = 0; index < presentation->poster_surface_count;
       ++index) {
    const MultiplexPosterSurface *surface =
        &presentation->poster_surfaces[index];
    set_poster_scissor(presentation, surface);
    if (surface->focused == 0 || surface->card_width <= 0 ||
        surface->card_height <= 0) {
      continue;
    }
    configure_color_pipeline();
    GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                    GX_LO_CLEAR);
    const float progress = POSTER_FOCUS_FRAMES <= 1u
                               ? 1.0f
                               : (float)presentation->poster_focus_frame /
                                     (float)(POSTER_FOCUS_FRAMES - 1u);
    const float remaining = 1.0f - progress;
    const float eased = 1.0f - remaining * remaining * remaining;
    const float poster_left = surface->x - eased * 2.0f;
    const float poster_top = surface->y - eased * 3.0f;
    const float poster_right = surface->x + surface->width + eased * 2.0f;
    const float poster_bottom = surface->y + surface->height + eased;
    stroke_rounded_color_rect(poster_left, poster_top, poster_right,
                              poster_bottom, surface->radius + eased, 1.5f,
                              (GXColor){255, 255, 255, 176});
    break;
  }
  if (presentation->poster_focus_frame < POSTER_FOCUS_FRAMES) {
    presentation->poster_focus_frame += 1u;
  }
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
}

static void draw_packet_shapes_region(MultiplexPresentation *presentation,
                                      const NativeUiPacket *packet, float top,
                                      float bottom, float x, float y) {
  set_ui_draw_clip(presentation, 0.0f, top, LOGICAL_WIDTH, bottom);
  load_ui_translation_xy(presentation, x, y);
  if (packet->shape_command_count == 0)
    return;
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  for (uint32_t index = 0; index < packet->shape_command_count; ++index) {
    const MultiplexNativeDrawCommand *command = &packet->shape_commands[index];
    const bool full_screen = command->x <= 0.0f && command->y <= 0.0f &&
                             command->width >= LOGICAL_WIDTH &&
                             command->height >= LOGICAL_HEIGHT;
    const float center_y =
        command->kind == MULTIPLEX_NATIVE_DRAW_LINE ||
                command->kind == MULTIPLEX_NATIVE_DRAW_PATH_LINE
            ? (command->y + command->y2) * 0.5f
            : command->y + command->height * 0.5f;
    if (full_screen || center_y < top || center_y >= bottom)
      continue;
    draw_native_shape_command_at(presentation, packet, index);
  }
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
}

static void draw_packet_posters_region(MultiplexPresentation *presentation,
                                       const MultiplexPosterSurface *surfaces,
                                       uint32_t count, float top, float bottom,
                                       float x, float y) {
  set_ui_draw_clip(presentation, HOME_CAROUSEL_LEFT, top, HOME_CAROUSEL_RIGHT,
                   bottom);
  load_ui_translation_xy(presentation, x, y);
  if (presentation->poster_texture_count == 0)
    return;
  configure_ui_pipeline();
  for (uint32_t index = 0; index < count; ++index) {
    const MultiplexPosterSurface *surface = &surfaces[index];
    const float center_y = surface->y + surface->height * 0.5f;
    if (center_y < top || center_y >= bottom || surface->image_id == 0 ||
        surface->image_id > presentation->poster_texture_count) {
      continue;
    }
    const MultiplexPosterSurface clip = poster_clip_surface(surface);
    const MultiplexPosterSurface display = poster_display_surface(surface);
    set_poster_scissor(presentation, &clip);
    GX_LoadTexObj(&presentation->poster_textures[surface->image_id - 1u],
                  GX_TEXMAP0);
    draw_rounded_poster(&display);
  }
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
}

static void draw_packet_text_region(MultiplexPresentation *presentation,
                                    const NativeUiPacket *packet, float top,
                                    float bottom, float x, float y) {
  set_ui_draw_clip(presentation, 0.0f, top, LOGICAL_WIDTH, bottom);
  load_ui_translation_xy(presentation, x, y);
  if (packet->text_command_count == 0)
    return;
  configure_font_pipeline(presentation);
  for (uint32_t index = 0; index < packet->text_command_count; ++index) {
    const MultiplexNativeDrawCommand *command = &packet->text_commands[index];
    if (command->y < top || command->y >= bottom)
      continue;
    draw_native_text_command_at(presentation, packet, index);
  }
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
}

static void draw_home_background(MultiplexPresentation *presentation) {
  load_ui_translation_xy(presentation, 0.0f, 0.0f);
  clear_ui_draw_clip(presentation);
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  for (uint32_t index = 0;
       index < presentation->presented_ui_packet.shape_command_count; ++index) {
    const MultiplexNativeDrawCommand *command =
        &presentation->presented_ui_packet.shape_commands[index];
    if (command->x <= 0.0f && command->y <= 0.0f &&
        command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT) {
      draw_native_shape_command_at(presentation,
                                   &presentation->presented_ui_packet, index);
    }
  }
}

static void draw_home_motion(MultiplexPresentation *presentation) {
  const float progress = HOME_MOTION_FRAMES <= 1u
                             ? 1.0f
                             : (float)presentation->home_motion_frame /
                                   (float)(HOME_MOTION_FRAMES - 1u);
  const float eased = progress * progress * (3.0f - 2.0f * progress);
  const float direction = (float)presentation->home_motion_direction;
  if (presentation->presented_screen == MULTIPLEX_SCREEN_BROWSE) {
    const float current_y = direction * BROWSE_ROW_STRIDE * (1.0f - eased);
    draw_home_background(presentation);
    draw_packet_shapes_region(presentation, &presentation->presented_ui_packet,
                              0.0f, BROWSE_GRID_TOP, 0.0f, 0.0f);
    draw_packet_shapes_region(presentation, &presentation->presented_ui_packet,
                              BROWSE_GRID_TOP, LOGICAL_HEIGHT, 0.0f, current_y);
    draw_packet_posters_region(presentation, presentation->poster_surfaces,
                               presentation->poster_surface_count,
                               BROWSE_GRID_TOP, LOGICAL_HEIGHT, 0.0f,
                               current_y);
    draw_packet_text_region(presentation, &presentation->presented_ui_packet,
                            0.0f, BROWSE_GRID_TOP, 0.0f, 0.0f);
    draw_packet_text_region(presentation, &presentation->presented_ui_packet,
                            BROWSE_GRID_TOP, LOGICAL_HEIGHT, 0.0f, current_y);
    clear_ui_draw_clip(presentation);
    load_ui_translation_xy(presentation, 0.0f, 0.0f);
    GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                  presentation->video_mode->efbHeight);
    if (presentation->home_motion_frame + 1u >= HOME_MOTION_FRAMES) {
      presentation->home_motion_frame = HOME_MOTION_FRAMES;
      presentation->home_motion_kind = MULTIPLEX_PRESENTATION_MOTION_NONE;
      SYS_Report("REFERENCE GX: browse motion complete\n");
    } else {
      presentation->home_motion_frame += 1u;
    }
    return;
  }
  float previous_x = 0.0f;
  float previous_y = 0.0f;
  float current_x = 0.0f;
  float moving_top = HOME_CONTENT_TOP;
  float moving_bottom = LOGICAL_HEIGHT;

  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    previous_x = -direction * HOME_CARD_STRIDE * eased;
    current_x = direction * HOME_CARD_STRIDE * (1.0f - eased);
    moving_top = HOME_ACTIVE_CARD_TOP;
    moving_bottom = HOME_ACTIVE_SHELF_BOTTOM;
  } else {
    previous_y = -direction * HOME_SHELF_STRIDE * eased;
  }

  draw_home_background(presentation);
  draw_packet_shapes_region(presentation, &presentation->presented_ui_packet,
                            0.0f, moving_top, 0.0f, 0.0f);
  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_shapes_region(presentation, &presentation->presented_ui_packet,
                              moving_bottom, LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_shapes_region(presentation,
                            &presentation->home_motion_previous_packet,
                            moving_top, moving_bottom, previous_x, previous_y);
  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_shapes_region(presentation, &presentation->presented_ui_packet,
                              moving_top, moving_bottom, current_x, 0.0f);
  }

  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_posters_region(presentation, presentation->poster_surfaces,
                               presentation->poster_surface_count,
                               moving_bottom, LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_posters_region(presentation,
                             presentation->home_motion_previous_surfaces,
                             presentation->home_motion_previous_surface_count,
                             moving_top, moving_bottom, previous_x, previous_y);
  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_posters_region(presentation, presentation->poster_surfaces,
                               presentation->poster_surface_count, moving_top,
                               moving_bottom, current_x, 0.0f);
  }

  draw_packet_text_region(presentation, &presentation->presented_ui_packet,
                          0.0f, moving_top, 0.0f, 0.0f);
  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_text_region(presentation, &presentation->presented_ui_packet,
                            moving_bottom, LOGICAL_HEIGHT, 0.0f, 0.0f);
  }
  draw_packet_text_region(presentation,
                          &presentation->home_motion_previous_packet,
                          moving_top, moving_bottom, previous_x, previous_y);
  if (presentation->home_motion_kind ==
      MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL) {
    draw_packet_text_region(presentation, &presentation->presented_ui_packet,
                            moving_top, moving_bottom, current_x, 0.0f);
  }

  clear_ui_draw_clip(presentation);
  load_ui_translation_xy(presentation, 0.0f, 0.0f);
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
  if (presentation->home_motion_frame + 1u >= HOME_MOTION_FRAMES) {
    presentation->home_motion_frame = HOME_MOTION_FRAMES;
    presentation->home_motion_kind = MULTIPLEX_PRESENTATION_MOTION_NONE;
    SYS_Report("REFERENCE GX: home motion complete\n");
  } else {
    presentation->home_motion_frame += 1u;
  }
}

static uint32_t modal_layer_sequence(MultiplexPresentation *presentation,
                                     const NativeUiPacket *packet) {
  if (presentation->modal_surface.visible == 0)
    return UINT32_MAX;
  for (uint32_t index = 0; index < packet->shape_command_count; ++index) {
    const MultiplexNativeDrawCommand *command = &packet->shape_commands[index];
    const uint8_t alpha = (uint8_t)command->color_rgba;
    if (command->kind == MULTIPLEX_NATIVE_DRAW_FILL_RECT &&
        command->x <= 0.0f && command->y <= 0.0f &&
        command->width >= LOGICAL_WIDTH && command->height >= LOGICAL_HEIGHT &&
        alpha > 0u && alpha < 96u) {
      return packet->shape_sequences[index];
    }
  }
  return UINT32_MAX;
}

static void draw_video_surface(MultiplexPresentation *presentation,
                               const MultiplexPlaybackSnapshot *playback) {
  if (presentation->video_surface.visible == 0 || !playback->frame_ready ||
      playback->playback_failed || presentation->video_surface.width <= 0.0f ||
      presentation->video_surface.height <= 0.0f) {
    return;
  }
  float x = presentation->video_surface.x;
  float y = presentation->video_surface.y;
  float width = presentation->video_surface.width;
  float height = presentation->video_surface.height;
  if (playback->content_width > 0 && playback->content_height > 0) {
    const float width_scale = width / (float)playback->content_width;
    const float height_scale = height / (float)playback->content_height;
    const float scale = width_scale < height_scale ? width_scale : height_scale;
    const float fitted_width = (float)playback->content_width * scale;
    const float fitted_height = (float)playback->content_height * scale;
    x += (width - fitted_width) * 0.5f;
    y += (height - fitted_height) * 0.5f;
    width = fitted_width;
    height = fitted_height;
  }
  multiplex_video_surface_draw(playback->surface, x, y, x + width, y + height);
}

static void draw_playback_progress(MultiplexPresentation *presentation) {
  const MultiplexPlaybackSnapshot *playback =
      &presentation->frame_input.playback;
  if (presentation->video_surface.visible == 0 || playback->rating_key == 0 ||
      playback->duration_ms == 0) {
    return;
  }
  if (presentation->player_controls_surface.visible == 0 ||
      presentation->player_controls_surface.width <= 0 ||
      presentation->player_controls_surface.height <= 0) {
    return;
  }
  const float left = presentation->player_controls_surface.x + 1.0f;
  const float right = presentation->player_controls_surface.x +
                      presentation->player_controls_surface.width - 1.0f;
  const float top = presentation->player_controls_surface.y;
  const float bottom = top + 4.0f;
  const float progress =
      (float)playback->position_ms / (float)playback->duration_ms;
  const float filled = left + (right - left) * progress;
  configure_color_pipeline();
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  fill_rect(left, top, right, bottom, (GXColor){24, 24, 27, 210});
  if (filled > left) {
    fill_rect(left, top, filled, bottom, (GXColor){250, 250, 250, 255});
  }
  GX_SetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
}

typedef enum {
  UI_PIPELINE_NONE = 0,
  UI_PIPELINE_SHAPE = 1,
  UI_PIPELINE_TEXT = 2,
} UiPipeline;

static void draw_native_packet_ordered(MultiplexPresentation *presentation,
                                       const NativeUiPacket *packet) {
  uint32_t shape_index = 0;
  uint32_t text_index = 0;
  const uint32_t modal_sequence = modal_layer_sequence(presentation, packet);
  uint32_t poster_sequence = UINT32_MAX;
  if (packet->text_command_count != 0) {
    poster_sequence = packet->text_sequences[0];
  }
  if (modal_sequence < poster_sequence)
    poster_sequence = modal_sequence;

  bool posters_drawn = presentation->poster_surface_count == 0;
  bool progress_drawn = false;
  UiPipeline pipeline = UI_PIPELINE_NONE;
  while (shape_index < packet->shape_command_count ||
         text_index < packet->text_command_count) {
    const uint32_t shape_sequence = shape_index < packet->shape_command_count
                                        ? packet->shape_sequences[shape_index]
                                        : UINT32_MAX;
    const uint32_t text_sequence = text_index < packet->text_command_count
                                       ? packet->text_sequences[text_index]
                                       : UINT32_MAX;
    const uint32_t next_sequence =
        shape_sequence < text_sequence ? shape_sequence : text_sequence;

    if (!posters_drawn && next_sequence >= poster_sequence) {
      draw_poster_surfaces(presentation);
      posters_drawn = true;
      pipeline = UI_PIPELINE_NONE;
    }
    if (!progress_drawn && modal_sequence != UINT32_MAX &&
        next_sequence >= modal_sequence) {
      draw_playback_progress(presentation);
      progress_drawn = true;
      pipeline = UI_PIPELINE_NONE;
    }

    if (shape_sequence < text_sequence) {
      if (pipeline != UI_PIPELINE_SHAPE) {
        configure_color_pipeline();
        GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA,
                        GX_LO_CLEAR);
        pipeline = UI_PIPELINE_SHAPE;
      }
      draw_native_shape_command_at(presentation, packet, shape_index++);
    } else {
      if (pipeline != UI_PIPELINE_TEXT) {
        configure_font_pipeline(presentation);
        pipeline = UI_PIPELINE_TEXT;
      }
      draw_native_text_command_at(presentation, packet, text_index++);
    }
  }

  if (!posters_drawn)
    draw_poster_surfaces(presentation);
  if (!progress_drawn)
    draw_playback_progress(presentation);
  GX_SetScissor(0, 0, presentation->video_mode->fbWidth,
                presentation->video_mode->efbHeight);
}

static bool refresh(MultiplexPresentation *presentation, bool initialize);
static bool launch_transition(MultiplexPresentation *presentation);
static MultiplexPresentationFrameResult
poll_transition(MultiplexPresentation *presentation);

MultiplexPresentationFrameResult
multiplex_presentation_prepare_frame(MultiplexPresentation *presentation,
                                     MultiplexPresentationPrepareMode mode) {
  if (presentation == NULL || mode > MULTIPLEX_PRESENTATION_PREPARE_DEFERRED) {
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  const MultiplexPresentationFrameResult transition =
      poll_transition(presentation);
  if (transition != MULTIPLEX_PRESENTATION_FRAME_READY) {
    return transition;
  }
  if (!presentation->native_frame_dirty ||
      mode == MULTIPLEX_PRESENTATION_PREPARE_DEFERRED) {
    return MULTIPLEX_PRESENTATION_FRAME_READY;
  }
  const uint32_t target_screen = multiplex_native_app_screen();
  const bool asynchronous_transition =
      mode == MULTIPLEX_PRESENTATION_PREPARE_NORMAL &&
      presentation->asynchronous_reference_enabled &&
      (target_screen != presentation->presented_screen ||
       presentation->asynchronous_reference_requested) &&
      target_screen != MULTIPLEX_SCREEN_PLAYER;
  if (asynchronous_transition) {
    presentation->asynchronous_reference_requested = false;
    if (launch_transition(presentation)) {
      return MULTIPLEX_PRESENTATION_FRAME_PENDING;
    }
  }
  if (!refresh(presentation, false)) {
    presentation->native_frame_dirty = false;
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  return MULTIPLEX_PRESENTATION_FRAME_READY;
}

bool multiplex_presentation_present(
    MultiplexPresentation *presentation,
    const MultiplexPresentationFrameInput *input) {
  if (presentation == NULL || input == NULL) {
    return false;
  }
  presentation->frame_input = *input;
  presentation->frame_input.playback.surface = NULL;
  const MultiplexPlaybackSnapshot *playback = &input->playback;

  draw_player_startup_backdrop(presentation);
  draw_video_surface(presentation, playback);
  if (presentation->video_surface.visible == 0 ||
      presentation->player_controls_overlay_visible) {
    draw_details_backdrop(presentation);
    float entry_offset = 0.0f;
    if (presentation->ui_entry_frame < UI_ENTRY_FRAMES) {
      const float progress = UI_ENTRY_FRAMES <= 1u
                                 ? 1.0f
                                 : (float)presentation->ui_entry_frame /
                                       (float)(UI_ENTRY_FRAMES - 1u);
      const float remaining = 1.0f - progress;
      entry_offset = 6.0f * remaining * remaining * remaining;
      presentation->ui_entry_frame += 1u;
    }
    if (presentation->home_motion_kind != MULTIPLEX_PRESENTATION_MOTION_NONE &&
        (presentation->presented_screen == MULTIPLEX_SCREEN_HOME ||
         presentation->presented_screen == MULTIPLEX_SCREEN_BROWSE)) {
      draw_home_motion(presentation);
    } else {
      load_ui_translation(presentation, entry_offset);
      draw_reference_frame(presentation);
      draw_native_packet_ordered(presentation,
                                 &presentation->presented_ui_packet);
      load_ui_translation(presentation, 0.0f);
    }
  }
  draw_activity(presentation);
  draw_stats_for_nerds(presentation);
  GX_CopyDisp(presentation->framebuffers[presentation->framebuffer_index],
              GX_TRUE);
  GX_DrawDone();
  VIDEO_SetNextFramebuffer(
      presentation->framebuffers[presentation->framebuffer_index]);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  presentation->framebuffer_index ^= 1;

  if (presentation->presentation_frames == 0) {
    presentation->presentation_started = gettick();
  }
  presentation->presentation_frames += 1;
  if (presentation->presentation_frames == 120) {
    const uint32_t measured_us = elapsed_us(presentation->presentation_started);
    const uint32_t fps_tenths =
        measured_us == 0 ? 0 : (uint32_t)((120ull * 10000000ull) / measured_us);
    presentation->diagnostic_presentation_fps_tenths = fps_tenths;
    SYS_Report("REFERENCE GX: presentation=120 frames/%uus (%u.%u fps)\n",
               measured_us, fps_tenths / 10, fps_tenths % 10);
    if (playback->metrics.stream == MULTIPLEX_PLAYBACK_STREAM_PROGRAM) {
      SYS_Report("REFERENCE GX: stream-progress video=%u audio=%u loops=%u\n",
                 playback->metrics.stream_video_bytes,
                 playback->metrics.stream_audio_bytes,
                 playback->metrics.producer_units);
      if (playback->rating_key != 0) {
        SYS_Report(
            "REFERENCE GX: timeline rating-key=%u position=%u duration=%u "
            "segment-start=%u segment-duration=%u\n",
            playback->rating_key, playback->position_ms, playback->duration_ms,
            playback->segment_start_ms, playback->segment_duration_ms);
      }
    } else if (playback->metrics.stream == MULTIPLEX_PLAYBACK_STREAM_HLS) {
      SYS_Report("REFERENCE GX: HLS progress segments=%u video=%u audio=%u\n",
                 playback->metrics.producer_units,
                 playback->metrics.stream_video_bytes,
                 playback->metrics.stream_audio_bytes);
    }
    presentation->presentation_frames = 0;
  }
  return true;
}

static void convert_reference_to_rgba8_tile_rect(
    MultiplexPresentation *presentation, unsigned first_tile_x,
    unsigned first_tile_y, unsigned tile_column_count, unsigned tile_row_count,
    uint8_t alpha_scale) {
  const unsigned last_tile_x = first_tile_x + tile_column_count;
  const unsigned last_tile_y = first_tile_y + tile_row_count;
  for (unsigned tile_y = first_tile_y; tile_y < last_tile_y; ++tile_y) {
    for (unsigned tile_x = first_tile_x; tile_x < last_tile_x; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      uint8_t *tile = tile_pixels(presentation, tile_index);

      for (unsigned block_y = 0; block_y < TILE_HEIGHT / 4; ++block_y) {
        for (unsigned block_x = 0; block_x < TILE_WIDTH / 4; ++block_x) {
          uint8_t *block = tile + (block_y * (TILE_WIDTH / 4) + block_x) * 64;
          for (unsigned inner_y = 0; inner_y < 4; ++inner_y) {
            for (unsigned inner_x = 0; inner_x < 4; ++inner_x) {
              const unsigned source_x =
                  tile_x * TILE_WIDTH + block_x * 4 + inner_x;
              const unsigned source_y =
                  tile_y * TILE_HEIGHT + block_y * 4 + inner_y;
              const uint8_t *source = presentation->reference_frame.pixels +
                                      (source_y * LOGICAL_WIDTH + source_x) * 4;
              const unsigned plane_offset = (inner_y * 4 + inner_x) * 2;

              block[plane_offset] =
                  (uint8_t)(((uint16_t)source[3] * alpha_scale) / 255u);
              block[plane_offset + 1] = source[0];
              block[32 + plane_offset] = source[1];
              block[32 + plane_offset + 1] = source[2];
            }
          }
        }
      }
    }
    DCFlushRange(
        tile_pixels(presentation, tile_y * TILE_COLUMNS + first_tile_x),
        tile_column_count * TILE_BYTES);
  }
}

static void convert_reference_to_rgba8_tile_rows(
    MultiplexPresentation *presentation, unsigned first_tile_y,
    unsigned tile_row_count, uint8_t alpha_scale) {
  convert_reference_to_rgba8_tile_rect(
      presentation, 0, first_tile_y, TILE_COLUMNS, tile_row_count, alpha_scale);
}

static bool
reference_tile_has_visible_pixels(MultiplexPresentation *presentation,
                                  unsigned tile_x, unsigned tile_y) {
  const unsigned first_x = tile_x * TILE_WIDTH;
  const unsigned first_y = tile_y * TILE_HEIGHT;
  const unsigned last_x = first_x + TILE_WIDTH;
  const unsigned last_y = first_y + TILE_HEIGHT;
  for (unsigned source_y = first_y; source_y < last_y; ++source_y) {
    const uint8_t *source = presentation->reference_frame.pixels +
                            (source_y * LOGICAL_WIDTH + first_x) * 4u + 3u;
    for (unsigned source_x = first_x; source_x < last_x; ++source_x) {
      if (*source != 0) {
        return true;
      }
      source += 4;
    }
  }
  return false;
}

static void clear_reference_texture_tile(MultiplexPresentation *presentation,
                                         unsigned tile_index) {
  uint8_t *tile = tile_pixels(presentation, tile_index);
  memset(tile, 0, TILE_BYTES);
  DCFlushRange(tile, TILE_BYTES);
}

static void convert_reference_tile_region(MultiplexPresentation *presentation,
                                          unsigned first_tile_x,
                                          unsigned first_tile_y,
                                          unsigned tile_column_count,
                                          unsigned tile_row_count) {
  const unsigned last_tile_x = first_tile_x + tile_column_count;
  const unsigned last_tile_y = first_tile_y + tile_row_count;
  for (unsigned tile_y = first_tile_y; tile_y < last_tile_y; ++tile_y) {
    unsigned run_start = 0;
    bool run_active = false;
    for (unsigned tile_x = first_tile_x; tile_x <= last_tile_x; ++tile_x) {
      const bool tile_exists = tile_x < last_tile_x;
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      const bool visible = tile_exists && reference_tile_has_visible_pixels(
                                              presentation, tile_x, tile_y);
      if (visible && !run_active) {
        run_start = tile_x;
        run_active = true;
      }
      if (!visible && run_active) {
        convert_reference_to_rgba8_tile_rect(presentation, run_start, tile_y,
                                             tile_x - run_start, 1, 255);
        run_active = false;
      }
      if (!tile_exists) {
        continue;
      }
      if (!visible && presentation->reference_tile_active[tile_index]) {
        clear_reference_texture_tile(presentation, tile_index);
      }
      presentation->reference_tile_active[tile_index] = visible;
    }
  }
}

static void
convert_reference_damage(MultiplexPresentation *presentation,
                         const MultiplexReferenceFrameRender *render) {
  if (render->full_repaint != 0) {
    convert_reference_tile_region(presentation, 0, 0, TILE_COLUMNS, TILE_ROWS);
    GX_InvalidateTexAll();
    return;
  }
  if (render->dirty == 0) {
    return;
  }

  float left = render->dirty_x;
  float right = render->dirty_x + render->dirty_width;
  float top = render->dirty_y;
  float bottom = render->dirty_y + render->dirty_height;
  if (left < 0.0f) {
    left = 0.0f;
  }
  if (right > LOGICAL_WIDTH) {
    right = LOGICAL_WIDTH;
  }
  if (top < 0.0f) {
    top = 0.0f;
  }
  if (bottom > LOGICAL_HEIGHT) {
    bottom = LOGICAL_HEIGHT;
  }
  if (right <= left || bottom <= top) {
    return;
  }
  const unsigned first_tile_x = (unsigned)left / TILE_WIDTH;
  const unsigned first_tile_y = (unsigned)top / TILE_HEIGHT;
  unsigned right_pixel = (unsigned)right;
  if (right > (float)right_pixel) {
    ++right_pixel;
  }
  unsigned bottom_pixel = (unsigned)bottom;
  if (bottom > (float)bottom_pixel) {
    ++bottom_pixel;
  }
  unsigned last_tile_x = (right_pixel + TILE_WIDTH - 1u) / TILE_WIDTH;
  unsigned last_tile_y = (bottom_pixel + TILE_HEIGHT - 1u) / TILE_HEIGHT;
  if (last_tile_x > TILE_COLUMNS) {
    last_tile_x = TILE_COLUMNS;
  }
  if (last_tile_y > TILE_ROWS) {
    last_tile_y = TILE_ROWS;
  }
  convert_reference_tile_region(presentation, first_tile_x, first_tile_y,
                                last_tile_x - first_tile_x,
                                last_tile_y - first_tile_y);
  GX_InvalidateTexAll();
}

static void set_controls_alpha(MultiplexPresentation *presentation,
                               uint8_t alpha) {
  if (presentation == NULL || presentation->ui_frame_alpha == alpha) {
    return;
  }
  presentation->ui_frame_alpha = alpha;
  convert_reference_to_rgba8_tile_rows(presentation, TILE_ROWS - 2u, 2, alpha);
  GX_InvalidateTexAll();
}

MultiplexPresentationControlsResult multiplex_presentation_controls_update(
    MultiplexPresentation *presentation,
    const MultiplexPresentationControlsInput *input) {
  MultiplexPresentationControlsResult result = {0};
  if (presentation == NULL || input == NULL) {
    return result;
  }
  const bool was_visible = presentation->player_controls_overlay_visible;
  const bool player_visible = presentation->video_surface.visible != 0;
  result.consumed_a = player_visible && !was_visible && input->a_pressed;
  if (!player_visible) {
    presentation->player_controls_last_input_ms = 0;
    presentation->player_controls_fade_started_ms = 0;
    set_controls_alpha(presentation, 255u);
    presentation->player_controls_overlay_visible = true;
  } else {
    if (presentation->player_controls_last_input_ms == 0) {
      presentation->player_controls_last_input_ms = input->now_ms;
    }
    if (input->active_input) {
      presentation->player_controls_last_input_ms = input->now_ms;
      presentation->player_controls_fade_started_ms = 0;
      set_controls_alpha(presentation, 255u);
      presentation->player_controls_overlay_visible = true;
    } else if (!input->settings_open &&
               presentation->player_controls_overlay_visible) {
      if (presentation->player_controls_fade_started_ms == 0 &&
          input->now_ms - presentation->player_controls_last_input_ms >=
              PLAYER_CONTROLS_IDLE_MS) {
        presentation->player_controls_fade_started_ms = input->now_ms;
      }
      if (presentation->player_controls_fade_started_ms != 0) {
        const uint64_t elapsed =
            input->now_ms - presentation->player_controls_fade_started_ms;
        if (elapsed >= PLAYER_CONTROLS_FADE_MS) {
          presentation->player_controls_overlay_visible = false;
          presentation->player_controls_last_input_ms = 0;
          presentation->player_controls_fade_started_ms = 0;
        } else {
          set_controls_alpha(
              presentation,
              (uint8_t)(255u * (PLAYER_CONTROLS_FADE_MS - (uint32_t)elapsed) /
                        PLAYER_CONTROLS_FADE_MS));
        }
      }
    }
  }
  result.visible = presentation->player_controls_overlay_visible;
  result.visibility_changed = result.visible != was_visible;
  return result;
}

static void capture_reference_surfaces(MultiplexPresentation *presentation) {
  const uint32_t previous_screen = presentation->presented_screen;
  memset(&presentation->video_surface, 0, sizeof(presentation->video_surface));
  multiplex_native_video_surface(&presentation->video_surface);
  memset(&presentation->player_controls_surface, 0,
         sizeof(presentation->player_controls_surface));
  multiplex_native_player_controls_surface(
      &presentation->player_controls_surface);
  memset(&presentation->modal_surface, 0, sizeof(presentation->modal_surface));
  multiplex_native_modal_surface(&presentation->modal_surface);
  memset(presentation->poster_surfaces, 0,
         sizeof(presentation->poster_surfaces));
  presentation->poster_surface_count = multiplex_native_poster_surfaces(
      presentation->poster_surfaces,
      MULTIPLEX_PRESENTATION_POSTER_SURFACE_CAPACITY);
  presentation->presented_screen = multiplex_native_app_screen();
  float next_focused_x = -1.0f;
  float next_focused_y = -1.0f;
  for (uint32_t index = 0; index < presentation->poster_surface_count;
       ++index) {
    if (presentation->poster_surfaces[index].focused != 0) {
      next_focused_x = presentation->poster_surfaces[index].card_x;
      next_focused_y = presentation->poster_surfaces[index].card_y;
      break;
    }
  }
  if (next_focused_x != presentation->focused_poster_x ||
      next_focused_y != presentation->focused_poster_y) {
    presentation->focused_poster_x = next_focused_x;
    presentation->focused_poster_y = next_focused_y;
    presentation->poster_focus_frame = 0;
  }
  if (presentation->presented_screen != previous_screen &&
      presentation->presented_screen != MULTIPLEX_SCREEN_PLAYER) {
    presentation->ui_entry_frame = 0;
  } else if (presentation->presented_screen == MULTIPLEX_SCREEN_PLAYER) {
    presentation->ui_entry_frame = UI_ENTRY_FRAMES;
  }
}

void multiplex_presentation_begin_home_motion(
    MultiplexPresentation *presentation, uint32_t before, uint32_t after) {
  if (before == UINT32_MAX || after == UINT32_MAX || before == after)
    return;
  const uint16_t before_row = (uint16_t)(before >> 16u);
  const uint16_t after_row = (uint16_t)(after >> 16u);
  const uint16_t before_carousel = (uint16_t)before;
  const uint16_t after_carousel = (uint16_t)after;
  if (before_row == after_row && before_carousel == after_carousel)
    return;

  copy_ui_packet(&presentation->home_motion_previous_packet,
                 &presentation->presented_ui_packet);
  memcpy(presentation->home_motion_previous_surfaces,
         presentation->poster_surfaces,
         presentation->poster_surface_count * sizeof(MultiplexPosterSurface));
  presentation->home_motion_previous_surface_count =
      presentation->poster_surface_count;
  if (before_row != after_row) {
    presentation->home_motion_kind = MULTIPLEX_PRESENTATION_MOTION_VERTICAL;
    presentation->home_motion_direction = after_row > before_row ? 1 : -1;
  } else {
    presentation->home_motion_kind = MULTIPLEX_PRESENTATION_MOTION_HORIZONTAL;
    presentation->home_motion_direction =
        after_carousel > before_carousel ? 1 : -1;
  }
  presentation->home_motion_frame = 0;
  SYS_Report(
      "REFERENCE GX: home motion kind=%u direction=%d from=%08x to=%08x\n",
      (unsigned)presentation->home_motion_kind,
      (int)presentation->home_motion_direction, before, after);
}

void multiplex_presentation_queue_browse_motion(
    MultiplexPresentation *presentation, uint32_t before, uint32_t after) {
  if (before == UINT32_MAX || before == after)
    return;
  presentation->browse_motion_pending_direction = after > before ? 1 : -1;
}

static void
activate_pending_browse_motion(MultiplexPresentation *presentation) {
  if (presentation->browse_motion_pending_direction == 0 ||
      presentation->presented_screen != MULTIPLEX_SCREEN_BROWSE) {
    return;
  }
  presentation->home_motion_kind = MULTIPLEX_PRESENTATION_MOTION_VERTICAL;
  presentation->home_motion_direction =
      presentation->browse_motion_pending_direction;
  presentation->home_motion_frame = 0;
  presentation->browse_motion_pending_direction = 0;
  SYS_Report("REFERENCE GX: browse motion direction=%d\n",
             (int)presentation->home_motion_direction);
}

static bool commit_reference_frame(MultiplexPresentation *presentation,
                                   const MultiplexReferenceFrameRender *render,
                                   uint32_t render_us, bool audit) {
  presentation->profile.commands = render->commands;
  presentation->profile.passes = 1;
  presentation->profile.signature = render->signature;
  presentation->profile.render_us = render_us;
  presentation->profile.memo_hits = render->memo_hits;
  presentation->profile.memo_misses = render->memo_misses;
  capture_reference_surfaces(presentation);
  if (presentation->video_surface.visible != 0) {
    SYS_Report(
        "REFERENCE GX: video-surface x=%d y=%d width=%d height=%d playing=%u\n",
        (int)presentation->video_surface.x, (int)presentation->video_surface.y,
        (int)presentation->video_surface.width,
        (int)presentation->video_surface.height,
        presentation->video_surface.playing);
  }
  const uint32_t upload_started = gettick();
  convert_reference_damage(presentation, render);
  presentation->profile.upload_us = elapsed_us(upload_started);
  presentation->native_frame_dirty = false;
  if (audit) {
    uint32_t first_layout_rule = 0;
    uint32_t first_layout_node = 0;
    const uint32_t layout_findings = multiplex_native_app_layout_audit(
        &first_layout_rule, &first_layout_node);
    SYS_Report("REFERENCE GX: layout-audit findings=%u first-rule=%u "
               "first-node=%u\n",
               layout_findings, first_layout_rule, first_layout_node);
    SYS_Report("REFERENCE GX: poster-inset-audit findings=%u\n",
               multiplex_native_app_poster_inset_audit());
  }
  SYS_Report(
      "REFERENCE GX: commands=%u passes=%u signature=%08x render=%uus "
      "conversion=%uus text=%uus stages=%u/%u/%u/%u/%u/%uus memo=%u/%u "
      "cache=%u/%uKiB\n",
      presentation->profile.commands, presentation->profile.passes,
      presentation->profile.signature, presentation->profile.render_us,
      presentation->profile.upload_us, presentation->profile.text_us,
      presentation->profile_stage_us[1], presentation->profile_stage_us[2],
      presentation->profile_stage_us[3], presentation->profile_stage_us[4],
      presentation->profile_stage_us[5], presentation->profile_stage_us[6],
      presentation->profile.memo_hits, presentation->profile.memo_misses,
      multiplex_native_reference_memo_bytes() / 1024u,
      multiplex_native_reference_memo_peak_bytes() / 1024u);
  return true;
}

static bool refresh(MultiplexPresentation *presentation, bool initialize) {
  if (presentation == NULL) {
    return false;
  }
  const uint32_t render_started = gettick();
  memset(presentation->profile_stage_us, 0,
         sizeof(presentation->profile_stage_us));
  presentation->profile_stage_current = 0;
  MultiplexReferenceFrameRender render;
  const MultiplexReferenceFrameStatus frame_status =
      multiplex_reference_frame_render_with_options(
          &presentation->reference_frame, initialize, &render, 0);
  if (frame_status != MULTIPLEX_REFERENCE_FRAME_OK) {
    presentation->last_render_status = frame_status;
    presentation->last_render_stage = multiplex_native_reference_render_stage();
    presentation->last_render_asynchronous = false;
    SYS_Report("REFERENCE GX: Native frame render failed: %s at stage %08x\n",
               multiplex_reference_frame_status_name(frame_status),
               presentation->last_render_stage);
    return false;
  }
  const uint32_t reference_render_us = elapsed_us(render_started);
  NativeUiPacket ui_packet;
  const uint32_t text_started = gettick();
  capture_ui_packet(&ui_packet);
  presentation->profile.text_us = elapsed_us(text_started);
  const bool audit = initialize || presentation->presented_screen !=
                                       multiplex_native_app_screen();
  if (!commit_reference_frame(presentation, &render, reference_render_us,
                              audit)) {
    return false;
  }
  copy_ui_packet(&presentation->presented_ui_packet, &ui_packet);
  activate_pending_browse_motion(presentation);
  return true;
}

static bool launch_transition(MultiplexPresentation *presentation) {
  if (renderer_running(presentation)) {
    return true;
  }
  memset(presentation->profile_stage_us, 0,
         sizeof(presentation->profile_stage_us));
  presentation->profile_stage_current = 0;
  if (!launch_renderer(presentation, 512u * 1024u, LWP_PRIO_NORMAL - 16u,
                       presentation->presented_screen !=
                           multiplex_native_app_screen(),
                       multiplex_reference_frame_render_with_options)) {
    return false;
  }
  SYS_Report("REFERENCE GX: screen transition render started from=%u to=%u\n",
             presentation->presented_screen, multiplex_native_app_screen());
  presentation->screen_transition_frame = 0;
  return true;
}

static MultiplexPresentationFrameResult
poll_transition(MultiplexPresentation *presentation) {
  if (!renderer_running(presentation)) {
    return MULTIPLEX_PRESENTATION_FRAME_READY;
  }
  MultiplexReferenceFrameRender render;
  MultiplexReferenceFrameStatus status;
  uint32_t stage = 0;
  uint32_t render_us = 0;
  bool audit = false;
  if (!poll_renderer(presentation, &render, &status, &stage, &render_us,
                     &audit)) {
    return MULTIPLEX_PRESENTATION_FRAME_PENDING;
  }
  if (status != MULTIPLEX_REFERENCE_FRAME_OK) {
    presentation->last_render_status = status;
    presentation->last_render_stage = stage;
    presentation->last_render_asynchronous = true;
    SYS_Report("REFERENCE GX: screen transition render failed: %s at stage "
               "%08x\n",
               multiplex_reference_frame_status_name(status), stage);
    presentation->native_frame_dirty = false;
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  const uint32_t previous_screen = presentation->presented_screen;
  NativeUiPacket ui_packet;
  const uint32_t text_started = gettick();
  capture_ui_packet(&ui_packet);
  presentation->profile.text_us = elapsed_us(text_started);
  if (!commit_reference_frame(presentation, &render, render_us, audit)) {
    return MULTIPLEX_PRESENTATION_FRAME_FAILED;
  }
  copy_ui_packet(&presentation->presented_ui_packet, &ui_packet);
  activate_pending_browse_motion(presentation);
  SYS_Report("REFERENCE GX: screen transition ready from=%u to=%u us=%u\n",
             previous_screen, presentation->presented_screen, render_us);
  return MULTIPLEX_PRESENTATION_FRAME_READY;
}
