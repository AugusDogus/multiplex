#include "memory_card_presentation.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  uint8_t block[8192];
  memset(block, 0xa5, sizeof(block));

  assert(multiplex_memory_card_prepare_presentation(block, sizeof(block)));
  assert(memcmp(block + MULTIPLEX_CARD_COMMENT_OFFSET, "Multiplex", 9) == 0);
  assert(memcmp(block + MULTIPLEX_CARD_COMMENT_OFFSET + 32,
                "Plex account and app settings", 29) == 0);
  assert(block[MULTIPLEX_CARD_AUTH_OFFSET - 1] == 0);
  assert(block[MULTIPLEX_CARD_AUTH_OFFSET] == 0xa5);
  assert(multiplex_memory_card_has_presentation(block, sizeof(block)));

  size_t transparent_pixels = 0;
  size_t opaque_pixels = 0;
  size_t white_pixels = 0;
  for (size_t offset = 0; offset < MULTIPLEX_CARD_ICON_SIZE; offset += 2) {
    const uint16_t pixel =
        (uint16_t)((uint16_t)block[offset] << 8u | block[offset + 1]);
    transparent_pixels += pixel == 0;
    opaque_pixels += (pixel & 0x8000u) != 0;
    white_pixels += pixel == 0xffffu;
  }
  assert(transparent_pixels > 0);
  assert(opaque_pixels > 0);
  assert(white_pixels > 0);

  assert(!multiplex_memory_card_prepare_presentation(NULL, sizeof(block)));
  assert(!multiplex_memory_card_prepare_presentation(
      block, MULTIPLEX_CARD_AUTH_OFFSET - 1));
  block[MULTIPLEX_CARD_COMMENT_OFFSET] = 'X';
  assert(!multiplex_memory_card_has_presentation(block, sizeof(block)));
  puts("GameCube memory card presentation tests passed.");
  return 0;
}
