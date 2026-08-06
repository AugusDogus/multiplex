#include "native_ui.h"
#include "raylib.h"
#include "reference_frame.h"

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
#define MAX_CONVERGENCE_PASSES 8

typedef struct {
  uint32_t render_us;
  uint32_t upload_us;
  uint32_t present_us;
  uint32_t commands;
  uint32_t passes;
  uint32_t signature;
} FrameProfile;

static MultiplexReferenceFrame reference_frame;
static uint8_t *tile_pixels;
static Texture2D reference_textures[TILE_COUNT];
static bool native_frame_dirty = true;
static bool native_initialized = false;
static bool show_profile = false;
static FrameProfile profile;

static uint32_t elapsed_us(uint32_t started) {
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started));
}

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  TraceLog(LOG_INFO, "REFERENCE: input action=%u focus=%u count=%u message=%u",
           action, focus, count, message);
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

void multiplex_native_profile_mark(uint32_t stage) { (void)stage; }

static void trace_reference_bounds(void) {
  unsigned min_x = LOGICAL_WIDTH;
  unsigned min_y = LOGICAL_HEIGHT;
  unsigned max_x = 0;
  unsigned max_y = 0;
  unsigned changed = 0;
  for (unsigned y = 0; y < LOGICAL_HEIGHT; ++y) {
    for (unsigned x = 0; x < LOGICAL_WIDTH; ++x) {
      const uint32_t offset = (y * LOGICAL_WIDTH + x) * 4u;
      const bool background = reference_frame.pixels[offset] == 10 &&
                              reference_frame.pixels[offset + 1] == 10 &&
                              reference_frame.pixels[offset + 2] == 12 &&
                              reference_frame.pixels[offset + 3] == 255;
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
  const MultiplexReferenceFrameStatus frame_status =
      multiplex_reference_frame_initialize(&reference_frame,
                                           LOGICAL_WIDTH * LOGICAL_HEIGHT * 4u);
  if (frame_status != MULTIPLEX_REFERENCE_FRAME_OK) {
    TraceLog(LOG_ERROR, "Native frame initialization failed: %s",
             multiplex_reference_frame_status_name(frame_status));
    return false;
  }

  tile_pixels = malloc(TILE_WIDTH * TILE_HEIGHT * 4u);
  if (tile_pixels == NULL) {
    TraceLog(LOG_ERROR, "Could not allocate Native SDK reference buffers");
    multiplex_reference_frame_destroy(&reference_frame);
    return false;
  }
  memset(tile_pixels, 0, TILE_WIDTH * TILE_HEIGHT * 4u);
  TraceLog(LOG_INFO,
           "REFERENCE: pixels=%p scratch=%p tile=%p (%u-byte guarded buffers)",
           reference_frame.pixels, reference_frame.scratch, tile_pixels,
           reference_frame.byte_count + 128u);
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
               reference_frame.pixels + source_offset, TILE_WIDTH * 4u);
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
    MultiplexReferenceFrameRender frame_render;
    const MultiplexReferenceFrameStatus frame_status =
        multiplex_reference_frame_render(&reference_frame, initialize,
                                         &frame_render);
    TraceLog(LOG_INFO, "REFERENCE: rendered pass %u", pass + 1);
    if (frame_status != MULTIPLEX_REFERENCE_FRAME_OK) {
      TraceLog(LOG_ERROR, "Native frame render failed during pass %u: %s",
               pass + 1, multiplex_reference_frame_status_name(frame_status));
      return false;
    }

    const uint32_t signature = frame_render.signature;
    profile.commands = frame_render.commands;
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
             reference_frame.pixels[offset], reference_frame.pixels[offset + 1],
             reference_frame.pixels[offset + 2],
             reference_frame.pixels[offset + 3]);
  }
  trace_reference_bounds();

  TraceLog(LOG_INFO,
           "REFERENCE: render %u us (%u passes, %u commands), upload "
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
  DrawText(
      TextFormat("Native SDK reference  render %u.%ums  upload %u.%ums  "
                 "present %u.%ums",
                 profile.render_us / 1000, (profile.render_us % 1000) / 100,
                 profile.upload_us / 1000, (profile.upload_us % 1000) / 100,
                 profile.present_us / 1000, (profile.present_us % 1000) / 100),
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
  multiplex_reference_frame_destroy(&reference_frame);
  CloseWindow();
  return 0;
}
