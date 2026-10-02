#include "native_ui.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

enum {
  FRAME_WIDTH = 640,
  FRAME_HEIGHT = 480,
  FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 4,
};

void multiplex_native_input_trace(uint32_t action, uint32_t focus,
                                  uint32_t count, uint32_t message) {
  (void)action;
  (void)focus;
  (void)count;
  (void)message;
}

void multiplex_native_profile_mark(uint32_t stage) { (void)stage; }

void *multiplex_native_cache_alloc(uint32_t length, uint32_t alignment) {
  if (length == 0 || alignment == 0 || (alignment & (alignment - 1u)) != 0) {
    return NULL;
  }
  if (alignment < sizeof(void *)) {
    alignment = sizeof(void *);
  }
  const size_t overhead = alignment - 1u + sizeof(void *);
  if ((size_t)length > SIZE_MAX - overhead) {
    return NULL;
  }
  uint8_t *allocation = malloc((size_t)length + overhead);
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

static int write_frame(const char *path, const uint8_t *pixels, size_t size) {
  FILE *file = fopen(path, "wb");
  if (file == NULL) {
    return 0;
  }
  const size_t written = fwrite(pixels, 1, size, file);
  return fclose(file) == 0 && written == size;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s output.rgba\n", argv[0]);
    return 2;
  }
  if (multiplex_native_reference_pixel_bytes() != FRAME_BYTES) {
    fprintf(stderr, "The console UI reference frame is not 640x480 RGBA.\n");
    return 1;
  }
  uint8_t *pixels = calloc(1, FRAME_BYTES);
  uint8_t *scratch = calloc(1, FRAME_BYTES);
  if (pixels == NULL || scratch == NULL) {
    fprintf(stderr, "Could not allocate console UI frame buffers.\n");
    free(scratch);
    free(pixels);
    return 1;
  }
  const uint32_t commands = multiplex_native_app_init_and_render_reference(
      pixels, FRAME_BYTES, scratch, FRAME_BYTES);
  const int wrote = commands != 0 && write_frame(argv[1], pixels, FRAME_BYTES);
  free(scratch);
  free(pixels);
  if (!wrote) {
    fprintf(stderr, "Could not export the console UI reference frame.\n");
    return 1;
  }
  printf("Exported %u console UI commands to %s.\n", commands, argv[1]);
  return 0;
}
