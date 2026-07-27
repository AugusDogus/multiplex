#ifndef MULTIPLEX_NATIVE_UI_H
#define MULTIPLEX_NATIVE_UI_H

#include <stdint.h>

enum {
  MULTIPLEX_GX_FILL_RECT = 1,
  MULTIPLEX_GX_FILL_ROUNDED_RECT = 2,
  MULTIPLEX_GX_STROKE_RECT = 3,
  MULTIPLEX_GX_LINE = 4,
  MULTIPLEX_GX_TEXT = 5,
  MULTIPLEX_GX_SHADOW = 6,
  MULTIPLEX_GX_GLYPH = 7,
};

typedef struct {
  uint32_t kind;
  float x;
  float y;
  float width;
  float height;
  float x2;
  float y2;
  float radius;
  float stroke_width;
  uint32_t color_rgba;
  uint32_t has_clip;
  float clip_x;
  float clip_y;
  float clip_width;
  float clip_height;
  const uint8_t *text_ptr;
  uint32_t text_len;
  uint32_t glyph_id;
  float font_size;
} MultiplexGxCommand;

void multiplex_native_app_init(void);
uint32_t multiplex_native_app_input(uint32_t action);
uint32_t multiplex_native_app_render(MultiplexGxCommand *output,
                                     uint32_t capacity);
uint32_t multiplex_native_reference_pixel_bytes(void);
uint32_t multiplex_native_reference_render_stage(void);
uint32_t multiplex_native_reference_memo_hits(void);
uint32_t multiplex_native_reference_memo_misses(void);
uint32_t multiplex_native_reference_memo_bytes(void);
uint32_t multiplex_native_reference_memo_peak_bytes(void);
uint32_t multiplex_native_app_init_and_render_reference(
    uint8_t *pixels, uint32_t pixels_capacity, uint8_t *scratch,
    uint32_t scratch_capacity);
uint32_t multiplex_native_app_render_reference(uint8_t *pixels,
                                               uint32_t pixels_capacity,
                                               uint8_t *scratch,
                                               uint32_t scratch_capacity);

#endif
