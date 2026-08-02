#include "reference_frame.h"

#include "native_ui.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>

#define REFERENCE_FRAME_GUARD_BYTES 64u
#define REFERENCE_FRAME_GUARD_VALUE 0xa5u

static bool guard_is_intact(const uint8_t *allocation,
                            uint32_t payload_byte_count) {
  for (uint32_t index = 0; index < REFERENCE_FRAME_GUARD_BYTES; ++index) {
    if (allocation[index] != REFERENCE_FRAME_GUARD_VALUE ||
        allocation[REFERENCE_FRAME_GUARD_BYTES + payload_byte_count + index] !=
            REFERENCE_FRAME_GUARD_VALUE) {
      return false;
    }
  }
  return true;
}

static uint32_t hash_bytes(const uint8_t *bytes, uint32_t byte_count) {
  uint32_t hash = 2166136261u;
  for (uint32_t index = 0; index < byte_count; ++index) {
    hash ^= bytes[index];
    hash *= 16777619u;
  }
  return hash;
}

MultiplexReferenceFrameStatus
multiplex_reference_frame_initialize(MultiplexReferenceFrame *frame,
                                     uint32_t expected_byte_count) {
  if (frame == NULL || expected_byte_count == 0) {
    return MULTIPLEX_REFERENCE_FRAME_INVALID_ARGUMENT;
  }
  memset(frame, 0, sizeof(*frame));
  const uint32_t byte_count = multiplex_native_reference_pixel_bytes();
  if (byte_count != expected_byte_count ||
      byte_count > UINT32_MAX - 2u * REFERENCE_FRAME_GUARD_BYTES) {
    return MULTIPLEX_REFERENCE_FRAME_SIZE_MISMATCH;
  }

  const uint32_t guarded_byte_count =
      byte_count + 2u * REFERENCE_FRAME_GUARD_BYTES;
  frame->pixels_allocation = malloc(guarded_byte_count);
  frame->scratch_allocation = malloc(guarded_byte_count);
  if (frame->pixels_allocation == NULL || frame->scratch_allocation == NULL) {
    multiplex_reference_frame_destroy(frame);
    return MULTIPLEX_REFERENCE_FRAME_ALLOCATION_FAILED;
  }
  frame->pixels = frame->pixels_allocation + REFERENCE_FRAME_GUARD_BYTES;
  frame->scratch = frame->scratch_allocation + REFERENCE_FRAME_GUARD_BYTES;
  frame->byte_count = byte_count;
  memset(frame->pixels_allocation, REFERENCE_FRAME_GUARD_VALUE,
         guarded_byte_count);
  memset(frame->scratch_allocation, REFERENCE_FRAME_GUARD_VALUE,
         guarded_byte_count);
  memset(frame->pixels, 0, byte_count);
  memset(frame->scratch, 0, byte_count);
  return MULTIPLEX_REFERENCE_FRAME_OK;
}

void multiplex_reference_frame_destroy(MultiplexReferenceFrame *frame) {
  if (frame == NULL) {
    return;
  }
  free(frame->scratch_allocation);
  free(frame->pixels_allocation);
  memset(frame, 0, sizeof(*frame));
}

MultiplexReferenceFrameStatus
multiplex_reference_frame_render(MultiplexReferenceFrame *frame,
                                 bool initialize,
                                 MultiplexReferenceFrameRender *render) {
  return multiplex_reference_frame_render_with_options(
      frame, initialize, render, MULTIPLEX_REFERENCE_FRAME_HASH_SIGNATURE);
}

MultiplexReferenceFrameStatus multiplex_reference_frame_render_with_options(
    MultiplexReferenceFrame *frame, bool initialize,
    MultiplexReferenceFrameRender *render, uint32_t options) {
  if (frame == NULL || render == NULL || frame->pixels_allocation == NULL ||
      frame->scratch_allocation == NULL || frame->pixels == NULL ||
      frame->scratch == NULL || frame->byte_count == 0) {
    return MULTIPLEX_REFERENCE_FRAME_INVALID_ARGUMENT;
  }

  const uint32_t memo_hits_before = multiplex_native_reference_memo_hits();
  const uint32_t memo_misses_before = multiplex_native_reference_memo_misses();
  const uint32_t commands =
      initialize ? multiplex_native_app_init_and_render_reference(
                       frame->pixels, frame->byte_count, frame->scratch,
                       frame->byte_count)
                 : multiplex_native_app_render_reference(
                       frame->pixels, frame->byte_count, frame->scratch,
                       frame->byte_count);
  if (!guard_is_intact(frame->pixels_allocation, frame->byte_count) ||
      !guard_is_intact(frame->scratch_allocation, frame->byte_count)) {
    return MULTIPLEX_REFERENCE_FRAME_GUARD_CORRUPTED;
  }
  render->commands = commands;
  render->signature =
      (options & MULTIPLEX_REFERENCE_FRAME_HASH_SIGNATURE) != 0
          ? hash_bytes(frame->pixels, frame->byte_count)
          : 0;
  render->memo_hits = multiplex_native_reference_memo_hits() - memo_hits_before;
  render->memo_misses =
      multiplex_native_reference_memo_misses() - memo_misses_before;
  render->dirty = multiplex_native_reference_dirty_bounds(
      &render->dirty_x, &render->dirty_y, &render->dirty_width,
      &render->dirty_height, &render->full_repaint);
  return MULTIPLEX_REFERENCE_FRAME_OK;
}

const char *
multiplex_reference_frame_status_name(MultiplexReferenceFrameStatus status) {
  switch (status) {
  case MULTIPLEX_REFERENCE_FRAME_OK:
    return "ok";
  case MULTIPLEX_REFERENCE_FRAME_INVALID_ARGUMENT:
    return "invalid argument";
  case MULTIPLEX_REFERENCE_FRAME_SIZE_MISMATCH:
    return "frame size mismatch";
  case MULTIPLEX_REFERENCE_FRAME_ALLOCATION_FAILED:
    return "allocation failed";
  case MULTIPLEX_REFERENCE_FRAME_GUARD_CORRUPTED:
    return "buffer guard corrupted";
  case MULTIPLEX_REFERENCE_FRAME_EMPTY_RENDER:
    return "renderer returned no commands";
  }
  return "unknown status";
}
