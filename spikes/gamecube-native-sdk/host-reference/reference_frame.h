#ifndef MULTIPLEX_REFERENCE_FRAME_H
#define MULTIPLEX_REFERENCE_FRAME_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  MULTIPLEX_REFERENCE_FRAME_OK = 0,
  MULTIPLEX_REFERENCE_FRAME_INVALID_ARGUMENT,
  MULTIPLEX_REFERENCE_FRAME_SIZE_MISMATCH,
  MULTIPLEX_REFERENCE_FRAME_ALLOCATION_FAILED,
  MULTIPLEX_REFERENCE_FRAME_GUARD_CORRUPTED,
  MULTIPLEX_REFERENCE_FRAME_EMPTY_RENDER,
} MultiplexReferenceFrameStatus;

enum {
  MULTIPLEX_REFERENCE_FRAME_HASH_SIGNATURE = 1u << 0,
};

typedef struct {
  uint8_t *pixels_allocation;
  uint8_t *scratch_allocation;
  uint8_t *pixels;
  uint8_t *scratch;
  uint32_t byte_count;
} MultiplexReferenceFrame;

typedef struct {
  uint32_t commands;
  uint32_t signature;
  uint32_t memo_hits;
  uint32_t memo_misses;
  uint32_t dirty;
  uint32_t full_repaint;
  float dirty_x;
  float dirty_y;
  float dirty_width;
  float dirty_height;
} MultiplexReferenceFrameRender;

MultiplexReferenceFrameStatus
multiplex_reference_frame_initialize(MultiplexReferenceFrame *frame,
                                     uint32_t expected_byte_count);
void multiplex_reference_frame_destroy(MultiplexReferenceFrame *frame);
MultiplexReferenceFrameStatus
multiplex_reference_frame_render(MultiplexReferenceFrame *frame,
                                 bool initialize,
                                 MultiplexReferenceFrameRender *render);
MultiplexReferenceFrameStatus multiplex_reference_frame_render_with_options(
    MultiplexReferenceFrame *frame, bool initialize,
    MultiplexReferenceFrameRender *render, uint32_t options);
const char *
multiplex_reference_frame_status_name(MultiplexReferenceFrameStatus status);

#endif
