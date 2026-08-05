#include "geist_atlas.h"
#include "native_ui.h"

#include <gccore.h>
#include <malloc.h>
#include <math.h>
#include <ogcsys.h>
#include <stdint.h>
#include <string.h>

#define FIFO_SIZE (256 * 1024)
#define COMMAND_CAPACITY 256
#define LOGICAL_WIDTH 640.0f
#define LOGICAL_HEIGHT 480.0f

static GXRModeObj *video_mode;
static void *framebuffer;
static void *gx_fifo;
static MultiplexGxCommand commands[COMMAND_CAPACITY];
static uint32_t command_count;
static bool native_frame_dirty = true;
static GXTexObj font_texture;
static bool font_pipeline_active;

static uint32_t hash_bytes(uint32_t hash, const void *bytes, size_t length) {
  const uint8_t *cursor = bytes;
  for (size_t index = 0; index < length; ++index) {
    hash ^= cursor[index];
    hash *= 16777619u;
  }
  return hash;
}

static uint32_t command_signature(uint32_t count) {
  uint32_t hash = 2166136261u;
  hash = hash_bytes(hash, &count, sizeof(count));
  for (uint32_t index = 0; index < count; ++index) {
    MultiplexGxCommand value = commands[index];
    value.text_ptr = NULL;
    hash = hash_bytes(hash, &value, sizeof(value));
    if (commands[index].text_ptr != NULL && commands[index].text_len > 0) {
      hash =
          hash_bytes(hash, commands[index].text_ptr, commands[index].text_len);
    }
  }
  return hash;
}

static void refresh_native_commands(void) {
  uint32_t previous_signature = 0;
  unsigned stable_passes = 0;

  for (unsigned pass = 0; pass < 12; ++pass) {
    command_count = multiplex_native_app_render(commands, COMMAND_CAPACITY);
    const uint32_t signature = command_signature(command_count);
    if (command_count > 0 && signature == previous_signature) {
      stable_passes += 1;
      if (stable_passes == 2) {
        break;
      }
    } else {
      stable_passes = 0;
    }
    previous_signature = signature;
  }
}

static GXColor gx_color(uint32_t rgba) {
  return (GXColor){
      .r = (uint8_t)(rgba >> 24),
      .g = (uint8_t)(rgba >> 16),
      .b = (uint8_t)(rgba >> 8),
      .a = (uint8_t)rgba,
  };
}

static void vertex(float x, float y, GXColor color) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
}

static void set_solid_pipeline(void) {
  if (!font_pipeline_active) {
    return;
  }
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetNumTexGens(0);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLOR0A0);
  GX_SetTevOp(GX_TEVSTAGE0, GX_PASSCLR);
  font_pipeline_active = false;
}

static void set_font_pipeline(void) {
  if (font_pipeline_active) {
    return;
  }
  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);
  GX_SetNumTexGens(1);
  GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX2x4, GX_TG_TEX0, GX_IDENTITY);
  GX_LoadTexObj(&font_texture, GX_TEXMAP0);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORD0, GX_TEXMAP0, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE0, GX_CC_ZERO, GX_CC_ZERO, GX_CC_ZERO,
                   GX_CC_RASC);
  GX_SetTevColorOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_TRUE,
                   GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE0, GX_CA_ZERO, GX_CA_TEXA, GX_CA_RASA,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_TRUE,
                   GX_TEVPREV);
  font_pipeline_active = true;
}

static void font_vertex(float x, float y, GXColor color, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(color.r, color.g, color.b, color.a);
  GX_TexCoord2f32(u, v);
}

static void set_full_scissor(void) {
  GX_SetScissor(0, 0, video_mode->fbWidth, video_mode->efbHeight);
}

static void set_command_scissor(const MultiplexGxCommand *command) {
  if (!command->has_clip) {
    set_full_scissor();
    return;
  }

  float x = fmaxf(0.0f, command->clip_x);
  float y = fmaxf(0.0f, command->clip_y);
  float right = fminf(LOGICAL_WIDTH, command->clip_x + command->clip_width);
  float bottom = fminf(LOGICAL_HEIGHT, command->clip_y + command->clip_height);
  if (right <= x || bottom <= y) {
    GX_SetScissor(0, 0, 0, 0);
    return;
  }

  const float scale_x = video_mode->fbWidth / LOGICAL_WIDTH;
  const float scale_y = video_mode->efbHeight / LOGICAL_HEIGHT;
  GX_SetScissor((uint32_t)(x * scale_x), (uint32_t)(y * scale_y),
                (uint32_t)((right - x) * scale_x),
                (uint32_t)((bottom - y) * scale_y));
}

static void draw_rect(float x, float y, float width, float height,
                      GXColor color) {
  if (width <= 0.0f || height <= 0.0f || color.a == 0) {
    return;
  }
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  vertex(x, y, color);
  vertex(x + width, y, color);
  vertex(x + width, y + height, color);
  vertex(x, y + height, color);
  GX_End();
}

static void draw_rounded_rect(float x, float y, float width, float height,
                              float radius, GXColor color) {
  if (width <= 0.0f || height <= 0.0f || color.a == 0) {
    return;
  }
  const float maximum = fminf(width, height) * 0.5f;
  radius = fmaxf(0.0f, fminf(radius, maximum));
  if (radius < 1.0f) {
    draw_rect(x, y, width, height, color);
    return;
  }

  draw_rect(x + radius, y, width - radius * 2.0f, height, color);
  draw_rect(x, y + radius * 0.5f, radius, height - radius, color);
  draw_rect(x + width - radius, y + radius * 0.5f, radius, height - radius,
            color);
}

static void draw_stroke_rect(const MultiplexGxCommand *command, GXColor color) {
  if (command->height <= 24.0f) {
    return;
  }
  const float stroke = fmaxf(1.0f, command->stroke_width);
  draw_rect(command->x, command->y, command->width, stroke, color);
  draw_rect(command->x, command->y + command->height - stroke, command->width,
            stroke, color);
  draw_rect(command->x, command->y, stroke, command->height, color);
  draw_rect(command->x + command->width - stroke, command->y, stroke,
            command->height, color);
}

static void draw_line(const MultiplexGxCommand *command, GXColor color) {
  const float dx = command->x2 - command->x;
  const float dy = command->y2 - command->y;
  const float stroke = fmaxf(1.0f, command->stroke_width);
  if (fabsf(dx) >= fabsf(dy)) {
    draw_rect(fminf(command->x, command->x2),
              fminf(command->y, command->y2) - stroke * 0.5f, fabsf(dx), stroke,
              color);
  } else {
    draw_rect(fminf(command->x, command->x2) - stroke * 0.5f,
              fminf(command->y, command->y2), stroke, fabsf(dy), color);
  }
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

static void draw_text(const MultiplexGxCommand *command, GXColor color) {
  if (command->text_ptr == NULL || command->text_len == 0 || color.a == 0) {
    return;
  }
  const unsigned size_index = geist_size_index(command->font_size);
  const float atlas_size = (float)geist_sizes[size_index];
  const float scale = command->font_size / atlas_size;
  const float start_x = command->x;
  float cursor_x = start_x;
  float baseline = command->y;
  uint32_t glyph_count = 0;

  for (uint32_t index = 0; index < command->text_len; ++index) {
    uint8_t character = command->text_ptr[index];
    if (character == '\n') {
      continue;
    }
    if (character < GEIST_FIRST_CHARACTER ||
        character >= GEIST_FIRST_CHARACTER + GEIST_CHARACTER_COUNT) {
      character = '?';
    }
    const GeistGlyphMetric *metric =
        &geist_metrics[size_index][character - GEIST_FIRST_CHARACTER];
    if (metric->width > 0 && metric->height > 0) {
      glyph_count += 1;
    }
  }
  if (glyph_count == 0 || glyph_count > UINT16_MAX / 4) {
    return;
  }

  set_font_pipeline();
  GX_Begin(GX_QUADS, GX_VTXFMT0, (uint16_t)(glyph_count * 4));
  for (uint32_t index = 0; index < command->text_len; ++index) {
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
      const float x = cursor_x + (float)metric->bearing_x * scale;
      const float y = baseline + (float)metric->bearing_y * scale;
      const float width = (float)metric->width * scale;
      const float height = (float)metric->height * scale;
      const float u0 = (float)metric->u / (float)GEIST_ATLAS_WIDTH;
      const float v0 = (float)metric->v / (float)GEIST_ATLAS_HEIGHT;
      const float u1 =
          (float)(metric->u + metric->width) / (float)GEIST_ATLAS_WIDTH;
      const float v1 =
          (float)(metric->v + metric->height) / (float)GEIST_ATLAS_HEIGHT;
      font_vertex(x, y, color, u0, v0);
      font_vertex(x + width, y, color, u1, v0);
      font_vertex(x + width, y + height, color, u1, v1);
      font_vertex(x, y + height, color, u0, v1);
    }
    cursor_x += ((float)metric->advance_64 / 64.0f) * scale;
  }
  GX_End();
}

static void draw_command(const MultiplexGxCommand *command) {
  set_command_scissor(command);
  const GXColor color = gx_color(command->color_rgba);
  if (command->kind != MULTIPLEX_GX_TEXT &&
      command->kind != MULTIPLEX_GX_GLYPH) {
    set_solid_pipeline();
  }
  switch (command->kind) {
  case MULTIPLEX_GX_FILL_RECT:
    draw_rect(command->x, command->y, command->width, command->height, color);
    break;
  case MULTIPLEX_GX_FILL_ROUNDED_RECT:
  case MULTIPLEX_GX_SHADOW:
    draw_rounded_rect(command->x, command->y, command->width, command->height,
                      command->radius, color);
    break;
  case MULTIPLEX_GX_STROKE_RECT:
    draw_stroke_rect(command, color);
    break;
  case MULTIPLEX_GX_LINE:
    draw_line(command, color);
    break;
  case MULTIPLEX_GX_TEXT:
    draw_text(command, color);
    break;
  case MULTIPLEX_GX_GLYPH: {
    if (command->glyph_id > 255) {
      break;
    }
    const uint8_t character = (uint8_t)command->glyph_id;
    MultiplexGxCommand glyph = *command;
    glyph.text_ptr = &character;
    glyph.text_len = 1;
    draw_text(&glyph, color);
    break;
  }
  default:
    break;
  }
}

static void initialize_video_and_gx(void) {
  VIDEO_Init();
  PAD_Init();
  video_mode = VIDEO_GetPreferredMode(NULL);
  framebuffer = MEM_K0_TO_K1(SYS_AllocateFramebuffer(video_mode));
  memset(framebuffer, 0, VIDEO_GetFrameBufferSize(video_mode));

  VIDEO_Configure(video_mode);
  VIDEO_SetNextFramebuffer(framebuffer);
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
  GX_SetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
  GX_SetAlphaUpdate(GX_TRUE);
  GX_SetColorUpdate(GX_TRUE);

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
  DCFlushRange(geist_atlas, sizeof(geist_atlas));
  GX_InitTexObj(&font_texture, geist_atlas, GEIST_ATLAS_WIDTH,
                GEIST_ATLAS_HEIGHT, GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&font_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0, GX_FALSE,
                   GX_FALSE, GX_ANISO_1);
  font_pipeline_active = false;

  Mtx identity;
  guMtxIdentity(identity);
  GX_LoadPosMtxImm(identity, GX_PNMTX0);
  GX_SetCurrentMtx(GX_PNMTX0);
  Mtx44 projection;
  guOrtho(projection, 0.0f, LOGICAL_HEIGHT, 0.0f, LOGICAL_WIDTH, 0.0f, 1.0f);
  GX_LoadProjectionMtx(projection, GX_ORTHOGRAPHIC);
  set_full_scissor();
  GX_CopyDisp(framebuffer, GX_TRUE);
  GX_Flush();
}

static void present_frame(void) {
  if (!native_frame_dirty) {
    VIDEO_WaitVSync();
    return;
  }
  refresh_native_commands();
  native_frame_dirty = false;

  set_solid_pipeline();
  draw_rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, (GXColor){10, 10, 12, 255});
  for (uint32_t index = 0; index < command_count; ++index) {
    draw_command(&commands[index]);
  }
  set_full_scissor();

  GX_CopyDisp(framebuffer, GX_TRUE);
  GX_DrawDone();
  VIDEO_SetNextFramebuffer(framebuffer);
  VIDEO_Flush();
  VIDEO_WaitVSync();
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  initialize_video_and_gx();
  multiplex_native_app_init();

  while (SYS_MainLoop()) {
    PAD_ScanPads();
    const uint32_t pressed = PAD_ButtonsDown(0);
    if ((pressed & (PAD_BUTTON_LEFT | PAD_BUTTON_UP)) != 0) {
      if (multiplex_native_app_input(0) != 0) {
        native_frame_dirty = true;
      }
    }
    if ((pressed & (PAD_BUTTON_RIGHT | PAD_BUTTON_DOWN)) != 0) {
      if (multiplex_native_app_input(1) != 0) {
        native_frame_dirty = true;
      }
    }
    if ((pressed & PAD_BUTTON_A) != 0) {
      if (multiplex_native_app_input(2) != 0) {
        native_frame_dirty = true;
      }
    }
    if ((pressed & PAD_BUTTON_B) != 0) {
      if (multiplex_native_app_input(3) != 0) {
        native_frame_dirty = true;
      }
    }
    if ((pressed & PAD_BUTTON_START) != 0) {
      break;
    }
    present_frame();
  }

  return 0;
}
