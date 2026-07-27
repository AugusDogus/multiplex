// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * The GX TEV stage decomposition is adapted from MPlayer CE's osdep/gx_supp.c
 * by softdev, dhewg, sepp256, and Extrems. Keep this file's GPL boundary
 * explicit; a production MIT renderer needs an independently developed
 * replacement or compatible project licensing.
 * https://github.com/SuperrSonic/mplayer-ce-libogc2
 */

#include "yuv420_gx.h"

#include <gccore.h>
#include <malloc.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum {
  FRAME_BUFFER_COUNT = 2,
};

typedef struct {
  uint8_t *allocation;
  uint8_t *planes[3];
} TiledYuvBuffer;

static unsigned luma_width;
static unsigned luma_height;
static unsigned chroma_width;
static unsigned chroma_height;
static size_t luma_bytes;
static size_t chroma_bytes;
static TiledYuvBuffer buffers[FRAME_BUFFER_COUNT];
static unsigned front_index;
static GXTexObj y_texture;
static GXTexObj u_texture;
static GXTexObj v_texture;
static bool initialized;

static void tile_i8_plane(uint8_t *destination, const uint8_t *source,
                          int source_stride, unsigned width, unsigned height) {
  for (unsigned tile_y = 0; tile_y < height; tile_y += 4) {
    for (unsigned tile_x = 0; tile_x < width; tile_x += 8) {
      uint8_t *tile =
          destination + ((tile_y / 4) * (width / 8) + tile_x / 8) * 32;
      for (unsigned row = 0; row < 4; ++row) {
        memcpy(tile + row * 8,
               source + (tile_y + row) * source_stride + tile_x, 8);
      }
    }
  }
}

static void initialize_texture_objects(void) {
  GX_InitTexObj(&y_texture, buffers[front_index].planes[0], luma_width,
                luma_height, GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&y_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0, GX_FALSE,
                   GX_FALSE, GX_ANISO_1);
  GX_InitTexObj(&u_texture, buffers[front_index].planes[1], chroma_width,
                chroma_height, GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&u_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0, GX_FALSE,
                   GX_FALSE, GX_ANISO_1);
  GX_InitTexObj(&v_texture, buffers[front_index].planes[2], chroma_width,
                chroma_height, GX_TF_I8, GX_CLAMP, GX_CLAMP, GX_FALSE);
  GX_InitTexObjLOD(&v_texture, GX_LINEAR, GX_LINEAR, 0, 0, 0, GX_FALSE,
                   GX_FALSE, GX_ANISO_1);
}

bool yuv420_gx_initialize(unsigned width, unsigned height) {
  if (width == 0 || height == 0 || width > 1024 || height > 1024 ||
      (width & 15u) != 0 || (height & 7u) != 0) {
    return false;
  }

  luma_width = width;
  luma_height = height;
  chroma_width = width / 2;
  chroma_height = height / 2;
  luma_bytes = (size_t)luma_width * luma_height;
  chroma_bytes = (size_t)chroma_width * chroma_height;
  const size_t buffer_bytes = luma_bytes + 2 * chroma_bytes;

  for (unsigned index = 0; index < FRAME_BUFFER_COUNT; ++index) {
    buffers[index].allocation = memalign(32, buffer_bytes);
    if (buffers[index].allocation == NULL) {
      yuv420_gx_destroy();
      return false;
    }
    buffers[index].planes[0] = buffers[index].allocation;
    buffers[index].planes[1] = buffers[index].planes[0] + luma_bytes;
    buffers[index].planes[2] = buffers[index].planes[1] + chroma_bytes;
    memset(buffers[index].allocation, 0, buffer_bytes);
    DCFlushRange(buffers[index].allocation, buffer_bytes);
  }

  front_index = 0;
  initialize_texture_objects();
  initialized = true;
  return true;
}

void yuv420_gx_destroy(void) {
  for (unsigned index = 0; index < FRAME_BUFFER_COUNT; ++index) {
    free(buffers[index].allocation);
    memset(&buffers[index], 0, sizeof(buffers[index]));
  }
  initialized = false;
}

bool yuv420_gx_upload_back(const Mpeg2Frame *frame) {
  if (!initialized || frame == NULL || frame->width != luma_width ||
      frame->height != luma_height) {
    return false;
  }

  TiledYuvBuffer *back = &buffers[front_index ^ 1u];
  tile_i8_plane(back->planes[0], frame->planes[0], frame->strides[0],
                luma_width, luma_height);
  tile_i8_plane(back->planes[1], frame->planes[1], frame->strides[1],
                chroma_width, chroma_height);
  tile_i8_plane(back->planes[2], frame->planes[2], frame->strides[2],
                chroma_width, chroma_height);
  DCFlushRange(back->allocation, luma_bytes + 2 * chroma_bytes);
  return true;
}

void yuv420_gx_swap(void) {
  front_index ^= 1u;
  initialize_texture_objects();
  GX_InvalidateTexAll();
}

/*
 * GX has no fragment shaders, so this decomposes limited-range BT.601
 * YUV-to-RGB into fixed-function TEV operations. MPlayer CE's GX presenter
 * demonstrated this approach on GameCube; this host keeps it behind a narrow
 * video-surface boundary so a differently licensed production implementation
 * can replace it.
 */
static void configure_yuv_pipeline(void) {
  GX_SetNumChans(1);
  GX_SetNumTexGens(2);
  GX_SetTexCoordGen(GX_TEXCOORD0, GX_TG_MTX2x4, GX_TG_TEX0, GX_IDENTITY);
  GX_SetTexCoordGen(GX_TEXCOORD1, GX_TG_MTX2x4, GX_TG_TEX1, GX_IDENTITY);
  GX_SetNumTevStages(12);

  GX_SetTevKColor(GX_KCOLOR0, (GXColor){255, 0, 0, 18});
  GX_SetTevKColor(GX_KCOLOR1, (GXColor){0, 0, 255, 41});
  GX_SetTevKColor(GX_KCOLOR2, (GXColor){203, 103, 0, 255});
  GX_SetTevKColor(GX_KCOLOR3, (GXColor){0, 24, 128, 255});

  GX_SetTevKColorSel(GX_TEVSTAGE0, GX_TEV_KCSEL_K1);
  GX_SetTevOrder(GX_TEVSTAGE0, GX_TEXCOORD1, GX_TEXMAP1, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE0, GX_CC_RASC, GX_CC_KONST, GX_CC_TEXC,
                   GX_CC_ZERO);
  GX_SetTevColorOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_SUBHALF, GX_CS_SCALE_2,
                   GX_ENABLE, GX_TEVREG0);
  GX_SetTevKAlphaSel(GX_TEVSTAGE0, GX_TEV_KASEL_K0_A);
  GX_SetTevAlphaIn(GX_TEVSTAGE0, GX_CA_ZERO, GX_CA_RASA, GX_CA_KONST,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE0, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVREG0);

  GX_SetTevKColorSel(GX_TEVSTAGE1, GX_TEV_KCSEL_K1);
  GX_SetTevOrder(GX_TEVSTAGE1, GX_TEXCOORD1, GX_TEXMAP1, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE1, GX_CC_KONST, GX_CC_RASC, GX_CC_TEXC,
                   GX_CC_ZERO);
  GX_SetTevColorOp(GX_TEVSTAGE1, GX_TEV_ADD, GX_TB_SUBHALF, GX_CS_SCALE_2,
                   GX_ENABLE, GX_TEVREG1);
  GX_SetTevAlphaIn(GX_TEVSTAGE1, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE1, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);

  GX_SetTevKColorSel(GX_TEVSTAGE2, GX_TEV_KCSEL_K0);
  GX_SetTevOrder(GX_TEVSTAGE2, GX_TEXCOORD1, GX_TEXMAP2, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE2, GX_CC_RASC, GX_CC_KONST, GX_CC_TEXC,
                   GX_CC_ZERO);
  GX_SetTevColorOp(GX_TEVSTAGE2, GX_TEV_ADD, GX_TB_SUBHALF, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVREG2);
  GX_SetTevAlphaIn(GX_TEVSTAGE2, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE2, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);

  GX_SetTevKColorSel(GX_TEVSTAGE3, GX_TEV_KCSEL_K0);
  GX_SetTevOrder(GX_TEVSTAGE3, GX_TEXCOORD1, GX_TEXMAP2, GX_COLOR0A0);
  GX_SetTevColorIn(GX_TEVSTAGE3, GX_CC_KONST, GX_CC_RASC, GX_CC_TEXC,
                   GX_CC_ZERO);
  GX_SetTevColorOp(GX_TEVSTAGE3, GX_TEV_ADD, GX_TB_SUBHALF, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE3, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE3, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);

  GX_SetTevKColorSel(GX_TEVSTAGE4, GX_TEV_KCSEL_K2);
  GX_SetTevOrder(GX_TEVSTAGE4, GX_TEXCOORD0, GX_TEXMAP0, GX_COLORNULL);
  GX_SetTevColorIn(GX_TEVSTAGE4, GX_CC_ZERO, GX_CC_KONST, GX_CC_CPREV,
                   GX_CC_ZERO);
  GX_SetTevColorOp(GX_TEVSTAGE4, GX_TEV_SUB, GX_TB_ZERO, GX_CS_SCALE_2,
                   GX_DISABLE, GX_TEVPREV);
  GX_SetTevKAlphaSel(GX_TEVSTAGE4, GX_TEV_KASEL_1);
  GX_SetTevAlphaIn(GX_TEVSTAGE4, GX_CA_ZERO, GX_CA_KONST, GX_CA_A0,
                   GX_CA_TEXA);
  GX_SetTevAlphaOp(GX_TEVSTAGE4, GX_TEV_SUB, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_DISABLE, GX_TEVPREV);

  GX_SetTevKColorSel(GX_TEVSTAGE5, GX_TEV_KCSEL_K2);
  GX_SetTevOrder(GX_TEVSTAGE5, GX_TEXCOORD0, GX_TEXMAP0, GX_COLORNULL);
  GX_SetTevColorIn(GX_TEVSTAGE5, GX_CC_ZERO, GX_CC_KONST, GX_CC_C2,
                   GX_CC_CPREV);
  GX_SetTevColorOp(GX_TEVSTAGE5, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_DISABLE, GX_TEVPREV);
  GX_SetTevKAlphaSel(GX_TEVSTAGE5, GX_TEV_KASEL_K1_A);
  GX_SetTevAlphaIn(GX_TEVSTAGE5, GX_CA_ZERO, GX_CA_KONST, GX_CA_TEXA,
                   GX_CA_APREV);
  GX_SetTevAlphaOp(GX_TEVSTAGE5, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVREG1);

  GX_SetTevKColorSel(GX_TEVSTAGE6, GX_TEV_KCSEL_K2);
  GX_SetTevOrder(GX_TEVSTAGE6, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLORNULL);
  GX_SetTevColorIn(GX_TEVSTAGE6, GX_CC_ZERO, GX_CC_KONST, GX_CC_C2,
                   GX_CC_CPREV);
  GX_SetTevColorOp(GX_TEVSTAGE6, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_DISABLE, GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE6, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE6, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);

  GX_SetTevKColorSel(GX_TEVSTAGE7, GX_TEV_KCSEL_1);
  GX_SetTevOrder(GX_TEVSTAGE7, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLORNULL);
  GX_SetTevColorIn(GX_TEVSTAGE7, GX_CC_ZERO, GX_CC_ONE, GX_CC_A1,
                   GX_CC_CPREV);
  GX_SetTevColorOp(GX_TEVSTAGE7, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_DISABLE, GX_TEVPREV);
  GX_SetTevAlphaIn(GX_TEVSTAGE7, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                   GX_CA_ZERO);
  GX_SetTevAlphaOp(GX_TEVSTAGE7, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                   GX_ENABLE, GX_TEVPREV);

  for (unsigned stage = GX_TEVSTAGE8; stage <= GX_TEVSTAGE9; ++stage) {
    GX_SetTevKColorSel(stage, GX_TEV_KCSEL_K3);
    GX_SetTevOrder(stage, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLORNULL);
    GX_SetTevColorIn(stage, GX_CC_ZERO, GX_CC_KONST, GX_CC_C1, GX_CC_CPREV);
    GX_SetTevColorOp(stage, GX_TEV_SUB, GX_TB_ZERO, GX_CS_SCALE_1, GX_DISABLE,
                     GX_TEVPREV);
    GX_SetTevAlphaIn(stage, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO);
    GX_SetTevAlphaOp(stage, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_ENABLE,
                     GX_TEVPREV);
  }

  for (unsigned stage = GX_TEVSTAGE10; stage <= GX_TEVSTAGE11; ++stage) {
    GX_SetTevKColorSel(stage, GX_TEV_KCSEL_K3);
    GX_SetTevOrder(stage, GX_TEXCOORDNULL, GX_TEXMAP_NULL, GX_COLORNULL);
    GX_SetTevColorIn(stage, GX_CC_ZERO, GX_CC_KONST, GX_CC_C0, GX_CC_CPREV);
    GX_SetTevColorOp(stage, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1,
                     stage == GX_TEVSTAGE11 ? GX_ENABLE : GX_DISABLE,
                     GX_TEVPREV);
    GX_SetTevAlphaIn(stage, GX_CA_ZERO, GX_CA_ZERO, GX_CA_ZERO,
                     stage == GX_TEVSTAGE11 ? GX_CA_KONST : GX_CA_ZERO);
    if (stage == GX_TEVSTAGE11) {
      GX_SetTevKAlphaSel(stage, GX_TEV_KASEL_1);
    }
    GX_SetTevAlphaOp(stage, GX_TEV_ADD, GX_TB_ZERO, GX_CS_SCALE_1, GX_ENABLE,
                     GX_TEVPREV);
  }

  GX_ClearVtxDesc();
  GX_SetVtxDesc(GX_VA_POS, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_CLR0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX0, GX_DIRECT);
  GX_SetVtxDesc(GX_VA_TEX1, GX_DIRECT);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_POS, GX_POS_XYZ, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_CLR0, GX_CLR_RGBA, GX_RGBA8, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX0, GX_TEX_ST, GX_F32, 0);
  GX_SetVtxAttrFmt(GX_VTXFMT0, GX_VA_TEX1, GX_TEX_ST, GX_F32, 0);
}

static void yuv_vertex(float x, float y, float u, float v) {
  GX_Position3f32(x, y, 0.0f);
  GX_Color4u8(0, 255, 0, 255);
  GX_TexCoord2f32(u, v);
  GX_TexCoord2f32(u, v);
}

void yuv420_gx_draw(float left, float top, float right, float bottom) {
  if (!initialized) {
    return;
  }
  configure_yuv_pipeline();
  GX_LoadTexObj(&y_texture, GX_TEXMAP0);
  GX_LoadTexObj(&u_texture, GX_TEXMAP1);
  GX_LoadTexObj(&v_texture, GX_TEXMAP2);
  GX_Begin(GX_QUADS, GX_VTXFMT0, 4);
  yuv_vertex(left, top, 0.0f, 0.0f);
  yuv_vertex(right, top, 1.0f, 0.0f);
  yuv_vertex(right, bottom, 1.0f, 1.0f);
  yuv_vertex(left, bottom, 0.0f, 1.0f);
  GX_End();
}
