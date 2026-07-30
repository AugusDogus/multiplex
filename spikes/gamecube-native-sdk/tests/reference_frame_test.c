#include "reference_frame.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static uint32_t render_commands = 7;
static uint32_t memo_hits;
static uint32_t memo_misses;

uint32_t multiplex_native_reference_pixel_bytes(void) { return 16; }

uint32_t multiplex_native_reference_memo_hits(void) { return memo_hits; }

uint32_t multiplex_native_reference_memo_misses(void) { return memo_misses; }

uint32_t multiplex_native_app_init_and_render_reference(
    uint8_t *pixels, uint32_t pixels_capacity, uint8_t *scratch,
    uint32_t scratch_capacity) {
  assert(pixels_capacity == 16);
  assert(scratch_capacity == 16);
  memset(pixels, 1, pixels_capacity);
  memset(scratch, 0, scratch_capacity);
  memo_misses += 1;
  return render_commands;
}

uint32_t multiplex_native_app_render_reference(uint8_t *pixels,
                                               uint32_t pixels_capacity,
                                               uint8_t *scratch,
                                               uint32_t scratch_capacity) {
  assert(pixels_capacity == 16);
  assert(scratch_capacity == 16);
  memset(pixels, 2, pixels_capacity);
  memset(scratch, 0, scratch_capacity);
  memo_hits += 2;
  return render_commands;
}

static void rejects_unexpected_frame_size(void) {
  MultiplexReferenceFrame frame;
  assert(multiplex_reference_frame_initialize(&frame, 64) ==
         MULTIPLEX_REFERENCE_FRAME_SIZE_MISMATCH);
}

static void renders_validated_frames(void) {
  MultiplexReferenceFrame frame;
  assert(multiplex_reference_frame_initialize(&frame, 16) ==
         MULTIPLEX_REFERENCE_FRAME_OK);
  MultiplexReferenceFrameRender render;
  assert(multiplex_reference_frame_render(&frame, true, &render) ==
         MULTIPLEX_REFERENCE_FRAME_OK);
  assert(render.commands == 7);
  assert(render.memo_hits == 0);
  assert(render.memo_misses == 1);
  assert(frame.pixels[0] == 1);

  assert(multiplex_reference_frame_render(&frame, false, &render) ==
         MULTIPLEX_REFERENCE_FRAME_OK);
  assert(render.memo_hits == 2);
  assert(render.memo_misses == 0);
  assert(frame.pixels[0] == 2);
  multiplex_reference_frame_destroy(&frame);
  assert(frame.pixels == NULL);
  assert(frame.byte_count == 0);
}

static void detects_guard_corruption_and_empty_renders(void) {
  MultiplexReferenceFrame frame;
  MultiplexReferenceFrameRender render;
  assert(multiplex_reference_frame_initialize(&frame, 16) ==
         MULTIPLEX_REFERENCE_FRAME_OK);
  frame.pixels[frame.byte_count] = 0;
  assert(multiplex_reference_frame_render(&frame, false, &render) ==
         MULTIPLEX_REFERENCE_FRAME_GUARD_CORRUPTED);
  multiplex_reference_frame_destroy(&frame);

  assert(multiplex_reference_frame_initialize(&frame, 16) ==
         MULTIPLEX_REFERENCE_FRAME_OK);
  render_commands = 0;
  assert(multiplex_reference_frame_render(&frame, false, &render) ==
         MULTIPLEX_REFERENCE_FRAME_EMPTY_RENDER);
  multiplex_reference_frame_destroy(&frame);
}

int main(void) {
  rejects_unexpected_frame_size();
  renders_validated_frames();
  detects_guard_corruption_and_empty_renders();
  puts("GameCube portable reference frame tests passed.");
  return 0;
}
