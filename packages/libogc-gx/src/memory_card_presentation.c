#include "memory_card_presentation.h"

#include <stdbool.h>
#include <string.h>

#define MULTIPLEX_CARD_ICON_WIDTH 32u
#define MULTIPLEX_CARD_ICON_HEIGHT 32u

/*
 * A 32 px raster of src/icons/multiplex.svg. The GameCube stores RGB5A3
 * textures as 4x4 tiles, so the small monochrome mask is expanded into the
 * native texture layout when the save is written.
 */
static const uint32_t multiplex_logo_rows[MULTIPLEX_CARD_ICON_HEIGHT] = {
    0x00000000u, 0x00000000u, 0x00000000u, 0x07e007e0u, 0x0ff00ff0u,
    0x1e781e78u, 0x1c381c38u, 0x18181818u, 0x18181818u, 0x1c181838u,
    0x1e3c3c78u, 0x0ffffff0u, 0x07ffffe0u, 0x003c3c00u, 0x00181800u,
    0x00181800u, 0x00181800u, 0x00181800u, 0x003c3c00u, 0x07ffffe0u,
    0x0ffffff0u, 0x1e3c3c78u, 0x1c181838u, 0x18181818u, 0x18181818u,
    0x1c381c38u, 0x1e781e78u, 0x0ff00ff0u, 0x07e007e0u, 0x00000000u,
    0x00000000u, 0x00000000u,
};

static uint16_t rgb5a3_opaque(uint8_t red, uint8_t green, uint8_t blue) {
  return (uint16_t)(0x8000u | ((uint16_t)(red >> 3u) << 10u) |
                    ((uint16_t)(green >> 3u) << 5u) | (blue >> 3u));
}

static bool inside_rounded_icon(unsigned x, unsigned y) {
  const unsigned edge_x = x < 4u ? 3u - x : (x > 27u ? x - 28u : 0u);
  const unsigned edge_y = y < 4u ? 3u - y : (y > 27u ? y - 28u : 0u);
  return edge_x * edge_x + edge_y * edge_y <= 10u;
}

static uint16_t icon_pixel(unsigned x, unsigned y) {
  if (!inside_rounded_icon(x, y)) {
    return 0;
  }
  const bool logo = (multiplex_logo_rows[y] & (UINT32_C(1) << (31u - x))) != 0;
  return logo ? rgb5a3_opaque(255u, 255u, 255u)
              : rgb5a3_opaque(20u, 145u, 230u);
}

static void write_icon(uint8_t *destination) {
  size_t cursor = 0;
  for (unsigned tile_y = 0; tile_y < MULTIPLEX_CARD_ICON_HEIGHT; tile_y += 4u) {
    for (unsigned tile_x = 0; tile_x < MULTIPLEX_CARD_ICON_WIDTH;
         tile_x += 4u) {
      for (unsigned y = 0; y < 4u; ++y) {
        for (unsigned x = 0; x < 4u; ++x) {
          const uint16_t pixel = icon_pixel(tile_x + x, tile_y + y);
          destination[cursor++] = (uint8_t)(pixel >> 8u);
          destination[cursor++] = (uint8_t)pixel;
        }
      }
    }
  }
}

bool multiplex_memory_card_prepare_presentation(uint8_t *block,
                                                size_t block_size) {
  if (block == NULL || block_size < MULTIPLEX_CARD_AUTH_OFFSET) {
    return false;
  }
  memset(block + MULTIPLEX_CARD_ICON_OFFSET, 0,
         MULTIPLEX_CARD_AUTH_OFFSET - MULTIPLEX_CARD_ICON_OFFSET);
  write_icon(block + MULTIPLEX_CARD_ICON_OFFSET);
  memcpy(block + MULTIPLEX_CARD_COMMENT_OFFSET, "Multiplex", 9u);
  memcpy(block + MULTIPLEX_CARD_COMMENT_OFFSET + 32u,
         "Plex account and app settings", 29u);
  return true;
}

bool multiplex_memory_card_has_presentation(const uint8_t *block,
                                            size_t block_size) {
  return block != NULL && block_size >= MULTIPLEX_CARD_AUTH_OFFSET &&
         memcmp(block + MULTIPLEX_CARD_COMMENT_OFFSET, "Multiplex", 9u) == 0 &&
         memcmp(block + MULTIPLEX_CARD_COMMENT_OFFSET + 32u,
                "Plex account and app settings", 29u) == 0;
}
