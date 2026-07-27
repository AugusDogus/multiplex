#include "native_ui.h"
#include "raylib.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/lwp_watchdog.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define LOGICAL_WIDTH 640
#define LOGICAL_HEIGHT 480
#define TILE_WIDTH 160
#define TILE_HEIGHT 120
#define TILE_COLUMNS (LOGICAL_WIDTH / TILE_WIDTH)
#define TILE_ROWS (LOGICAL_HEIGHT / TILE_HEIGHT)
#define TILE_COUNT (TILE_COLUMNS * TILE_ROWS)
#define BUFFER_GUARD_BYTES 64
#define BUFFER_GUARD_VALUE 0xa5
#define MAX_CONVERGENCE_PASSES 8

typedef struct {
  uint32_t render_us;
  uint32_t upload_us;
  uint32_t present_us;
  uint32_t commands;
  uint32_t passes;
  uint32_t signature;
} FrameProfile;

static uint8_t *reference_pixels;
static uint8_t *reference_scratch;
static uint8_t *reference_pixels_allocation;
static uint8_t *reference_scratch_allocation;
static uint8_t *tile_pixels;
static uint32_t reference_bytes;
static Texture2D reference_textures[TILE_COUNT];
static bool native_frame_dirty = true;
static bool native_initialized = false;
static bool show_profile = false;
static FrameProfile profile;

static bool guard_is_intact(const uint8_t *allocation, uint32_t payload_bytes) {
  for (unsigned index = 0; index < BUFFER_GUARD_BYTES; ++index) {
    if (allocation[index] != BUFFER_GUARD_VALUE ||
        allocation[BUFFER_GUARD_BYTES + payload_bytes + index] !=
            BUFFER_GUARD_VALUE) {
      return false;
    }
  }
  return true;
}

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

static uint32_t hash_bytes(const uint8_t *bytes, uint32_t length) {
  uint32_t hash = 2166136261u;
  for (uint32_t index = 0; index < length; ++index) {
    hash ^= bytes[index];
    hash *= 16777619u;
  }
  return hash;
}

static void trace_reference_bounds(void) {
  unsigned min_x = LOGICAL_WIDTH;
  unsigned min_y = LOGICAL_HEIGHT;
  unsigned max_x = 0;
  unsigned max_y = 0;
  unsigned changed = 0;
  for (unsigned y = 0; y < LOGICAL_HEIGHT; ++y) {
    for (unsigned x = 0; x < LOGICAL_WIDTH; ++x) {
      const uint32_t offset = (y * LOGICAL_WIDTH + x) * 4u;
      const bool background = reference_pixels[offset] == 10 &&
                              reference_pixels[offset + 1] == 10 &&
                              reference_pixels[offset + 2] == 12 &&
                              reference_pixels[offset + 3] == 255;
      if (background) {
        continue;
      }
      changed += 1;
      if (x < min_x) {
        min_x = x;
      }
      if (x > max_x) {
        max_x = x;
      }
      if (y < min_y) {
        min_y = y;
      }
      if (y > max_y) {
        max_y = y;
      }
    }
  }
  TraceLog(LOG_INFO, "REFERENCE: %u non-background pixels, bounds %u,%u-%u,%u",
           changed, min_x, min_y, max_x, max_y);
}

static bool allocate_reference_buffers(void) {
  reference_bytes = multiplex_native_reference_pixel_bytes();
  if (reference_bytes != LOGICAL_WIDTH * LOGICAL_HEIGHT * 4u) {
    TraceLog(LOG_ERROR, "Unexpected Native SDK framebuffer size: %u",
             reference_bytes);
    return false;
  }

  const uint32_t guarded_bytes = reference_bytes + 2u * BUFFER_GUARD_BYTES;
  reference_pixels_allocation = malloc(guarded_bytes);
  reference_scratch_allocation = malloc(guarded_bytes);
  tile_pixels = malloc(TILE_WIDTH * TILE_HEIGHT * 4u);
  if (reference_pixels_allocation == NULL ||
      reference_scratch_allocation == NULL || tile_pixels == NULL) {
    TraceLog(LOG_ERROR, "Could not allocate Native SDK reference buffers");
    return false;
  }
  reference_pixels = reference_pixels_allocation + BUFFER_GUARD_BYTES;
  reference_scratch = reference_scratch_allocation + BUFFER_GUARD_BYTES;
  memset(reference_pixels_allocation, BUFFER_GUARD_VALUE, guarded_bytes);
  memset(reference_scratch_allocation, BUFFER_GUARD_VALUE, guarded_bytes);
  memset(reference_pixels, 0, reference_bytes);
  memset(reference_scratch, 0, reference_bytes);
  memset(tile_pixels, 0, TILE_WIDTH * TILE_HEIGHT * 4u);
  TraceLog(LOG_INFO,
           "REFERENCE: pixels=%p scratch=%p tile=%p (%u-byte guarded buffers)",
           reference_pixels, reference_scratch, tile_pixels, guarded_bytes);
  return true;
}

static bool upload_reference_tiles(void) {
  for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
    for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
      const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
      for (unsigned row = 0; row < TILE_HEIGHT; ++row) {
        const uint32_t source_offset =
            (((tile_y * TILE_HEIGHT + row) * LOGICAL_WIDTH) +
             tile_x * TILE_WIDTH) *
            4u;
        memcpy(tile_pixels + row * TILE_WIDTH * 4u,
               reference_pixels + source_offset, TILE_WIDTH * 4u);
      }

      if (IsTextureValid(reference_textures[tile_index])) {
        UnloadTexture(reference_textures[tile_index]);
      }
      const Image image = {
          .data = tile_pixels,
          .width = TILE_WIDTH,
          .height = TILE_HEIGHT,
          .mipmaps = 1,
          .format = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8,
      };
      reference_textures[tile_index] = LoadTextureFromImage(image);
      if (!IsTextureValid(reference_textures[tile_index])) {
        TraceLog(LOG_ERROR, "Could not upload reference tile %u", tile_index);
        return false;
      }
      SetTextureFilter(reference_textures[tile_index], TEXTURE_FILTER_POINT);
    }
  }
  return true;
}

static bool refresh_reference_frame(void) {
  TraceLog(LOG_INFO, "REFERENCE: beginning Native SDK render");
  const uint32_t started = gettick();
  TraceLog(LOG_INFO, "REFERENCE: timer started");
  uint32_t previous_signature = 0;
  unsigned stable_passes = 0;

  profile.commands = 0;
  profile.passes = 0;
  const bool initialize = !native_initialized;
  for (unsigned pass = 0; pass < MAX_CONVERGENCE_PASSES; ++pass) {
    TraceLog(LOG_INFO, "REFERENCE: rendering pass %u", pass + 1);
    const uint32_t commands =
        initialize
            ? multiplex_native_app_init_and_render_reference(
                  reference_pixels, reference_bytes, reference_scratch,
                  reference_bytes)
            : multiplex_native_app_render_reference(
                  reference_pixels, reference_bytes, reference_scratch,
                  reference_bytes);
    TraceLog(LOG_INFO, "REFERENCE: rendered pass %u", pass + 1);
    if (!guard_is_intact(reference_pixels_allocation, reference_bytes) ||
        !guard_is_intact(reference_scratch_allocation, reference_bytes)) {
      TraceLog(LOG_ERROR,
               "REFERENCE: buffer guard corrupted during render pass %u",
               pass + 1);
      return false;
    }
    if (commands == 0) {
      TraceLog(LOG_ERROR, "Native SDK reference renderer returned no commands");
      return false;
    }

    const uint32_t signature = hash_bytes(reference_pixels, reference_bytes);
    profile.commands = commands;
    profile.passes = initialize ? 3 : pass + 1;
    profile.signature = signature;
    if (initialize) {
      native_initialized = true;
      break;
    }
    if (signature == previous_signature) {
      stable_passes += 1;
      if (stable_passes == 2) {
        break;
      }
    } else {
      stable_passes = 0;
    }
    previous_signature = signature;
  }
  profile.render_us = elapsed_us(started);

  TraceLog(LOG_INFO, "REFERENCE: preparing texture upload");
  const uint32_t upload_started = gettick();
  TraceLog(LOG_INFO, "REFERENCE: loading %u texture tiles", TILE_COUNT);
  if (!upload_reference_tiles()) {
    return false;
  }
  TraceLog(LOG_INFO, "REFERENCE: texture tile loads returned");
  profile.upload_us = elapsed_us(upload_started);
  native_frame_dirty = false;

  const uint32_t sample_offsets[] = {
      0,
      (48u * LOGICAL_WIDTH + 48u) * 4u,
      (240u * LOGICAL_WIDTH + 320u) * 4u,
      (400u * LOGICAL_WIDTH + 320u) * 4u,
  };
  for (unsigned index = 0;
       index < sizeof(sample_offsets) / sizeof(sample_offsets[0]); ++index) {
    const uint32_t offset = sample_offsets[index];
    TraceLog(LOG_INFO, "REFERENCE: sample %u = %u,%u,%u,%u", index,
             reference_pixels[offset], reference_pixels[offset + 1],
             reference_pixels[offset + 2], reference_pixels[offset + 3]);
  }
  trace_reference_bounds();

  TraceLog(LOG_INFO, "REFERENCE: render %u us (%u passes, %u commands), upload "
                     "%u us, signature %08x",
           profile.render_us, profile.passes, profile.commands,
           profile.upload_us, profile.signature);
  return true;
}

static void dispatch_input(void) {
  uint32_t action = UINT32_MAX;
  if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_LEFT_FACE_LEFT) ||
      IsGamepadButtonPressed(0, GAMEPAD_BUTTON_LEFT_FACE_UP)) {
    action = 0;
  } else if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_LEFT_FACE_RIGHT) ||
             IsGamepadButtonPressed(0, GAMEPAD_BUTTON_LEFT_FACE_DOWN)) {
    action = 1;
  } else if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_DOWN)) {
    action = 2;
  } else if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_LEFT)) {
    action = 3;
  }

  if (action != UINT32_MAX && multiplex_native_app_input(action) != 0) {
    native_frame_dirty = true;
  }
  if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_RIGHT)) {
    show_profile = !show_profile;
  }
}

static void draw_profile(void) {
  if (!show_profile) {
    return;
  }

  DrawRectangle(12, LOGICAL_HEIGHT - 56, LOGICAL_WIDTH - 24, 44,
                (Color){6, 8, 12, 224});
  DrawRectangleLines(12, LOGICAL_HEIGHT - 56, LOGICAL_WIDTH - 24, 44,
                     (Color){64, 72, 88, 255});
  DrawText(TextFormat("Native SDK reference  render %u.%ums  upload %u.%ums  "
                      "present %u.%ums",
                      profile.render_us / 1000, (profile.render_us % 1000) / 100,
                      profile.upload_us / 1000, (profile.upload_us % 1000) / 100,
                      profile.present_us / 1000,
                      (profile.present_us % 1000) / 100),
           22, LOGICAL_HEIGHT - 48, 12, (Color){236, 239, 244, 255});
  DrawText(TextFormat("%u commands / %u convergence passes / %08x    X: hide",
                      profile.commands, profile.passes, profile.signature),
           22, LOGICAL_HEIGHT - 30, 10, (Color){158, 167, 184, 255});
}

int main(void) {
  SetTraceLogLevel(LOG_INFO);
  InitWindow(LOGICAL_WIDTH, LOGICAL_HEIGHT,
             "Multiplex Native SDK reference renderer");
  SetTargetFPS(60);

  TraceLog(LOG_INFO, "REFERENCE: allocating framebuffers");
  if (!allocate_reference_buffers()) {
    CloseWindow();
    return 1;
  }
  TraceLog(LOG_INFO, "REFERENCE: framebuffers allocated");

  // OpenGX's texture upload waits for prior GX work. Complete one presentation
  // before creating the large UI texture so the backend has a finished frame.
  BeginDrawing();
  ClearBackground((Color){10, 10, 12, 255});
  EndDrawing();
  TraceLog(LOG_INFO, "REFERENCE: presenter warmed up");

  while (!WindowShouldClose()) {
    dispatch_input();
    if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_MIDDLE_RIGHT)) {
      break;
    }
    if (native_frame_dirty && !refresh_reference_frame()) {
      break;
    }

    const uint32_t present_started = gettick();
    BeginDrawing();
    ClearBackground((Color){10, 10, 12, 255});
    for (unsigned tile_y = 0; tile_y < TILE_ROWS; ++tile_y) {
      for (unsigned tile_x = 0; tile_x < TILE_COLUMNS; ++tile_x) {
        const unsigned tile_index = tile_y * TILE_COLUMNS + tile_x;
        DrawTexture(reference_textures[tile_index], tile_x * TILE_WIDTH,
                    tile_y * TILE_HEIGHT, WHITE);
      }
    }
    draw_profile();
    EndDrawing();
    profile.present_us = elapsed_us(present_started);
  }

  for (unsigned tile_index = 0; tile_index < TILE_COUNT; ++tile_index) {
    UnloadTexture(reference_textures[tile_index]);
  }
  free(tile_pixels);
  free(reference_scratch_allocation);
  free(reference_pixels_allocation);
  CloseWindow();
  return 0;
}
