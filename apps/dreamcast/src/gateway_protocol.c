#include "gateway_protocol.h"

#include <stdio.h>
#include <string.h>

enum {
  CATALOG_HEADER_BYTES = 12,
  ITEM_HEADER_BYTES = 20,
  PLAYBACK_HEADER_BYTES = 62,
  MAX_ROWS = 3,
  MAX_ROW_ITEMS = 8,
  MAX_LIBRARIES = 8,
  UPSTREAM_TEXT_CAPACITY = 96,
};

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static uint32_t read_be32(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24u) | ((uint32_t)bytes[1] << 16u) |
         ((uint32_t)bytes[2] << 8u) | bytes[3];
}

static void copy_text(char *destination, size_t capacity, const uint8_t *source,
                      size_t source_size) {
  const size_t copy_size =
      source_size < capacity - 1u ? source_size : capacity - 1u;
  memcpy(destination, source, copy_size);
  destination[copy_size] = '\0';
}

bool dreamcast_gateway_parse_catalog(const uint8_t *bytes, size_t size,
                                     DreamcastGatewayCatalog *catalog) {
  if (bytes == NULL || catalog == NULL || size < CATALOG_HEADER_BYTES ||
      memcmp(bytes, "MPXG", 4) != 0) {
    return false;
  }
  const uint16_t version = read_be16(bytes + 4);
  const uint16_t row_count = read_be16(bytes + 6);
  const uint16_t server_length = read_be16(bytes + 8);
  const uint16_t library_count = read_be16(bytes + 10);
  if (version != 3 || row_count == 0 || row_count > MAX_ROWS ||
      server_length >= DREAMCAST_GATEWAY_SERVER_CAPACITY ||
      library_count > MAX_LIBRARIES ||
      (size_t)CATALOG_HEADER_BYTES + server_length > size) {
    return false;
  }

  memset(catalog, 0, sizeof(*catalog));
  copy_text(catalog->server_name, sizeof(catalog->server_name),
            bytes + CATALOG_HEADER_BYTES, server_length);
  size_t cursor = CATALOG_HEADER_BYTES + server_length;
  for (uint16_t row = 0; row < row_count; ++row) {
    if (cursor + 4u > size) {
      return false;
    }
    const uint16_t row_title_length = read_be16(bytes + cursor);
    const uint16_t row_item_count = read_be16(bytes + cursor + 2);
    cursor += 4u;
    if (row_title_length >= UPSTREAM_TEXT_CAPACITY || row_item_count == 0 ||
        row_item_count > MAX_ROW_ITEMS || cursor + row_title_length > size) {
      return false;
    }
    cursor += row_title_length;
    for (uint16_t item_index = 0; item_index < row_item_count; ++item_index) {
      if (cursor + ITEM_HEADER_BYTES > size) {
        return false;
      }
      const uint32_t rating_key = read_be32(bytes + cursor);
      const uint32_t duration_ms = read_be32(bytes + cursor + 4);
      const uint32_t view_offset_ms = read_be32(bytes + cursor + 8);
      const uint16_t title_length = read_be16(bytes + cursor + 16);
      const uint16_t subtitle_length = read_be16(bytes + cursor + 18);
      cursor += ITEM_HEADER_BYTES;
      if (rating_key == 0 || title_length == 0 ||
          title_length >= UPSTREAM_TEXT_CAPACITY ||
          subtitle_length >= UPSTREAM_TEXT_CAPACITY ||
          cursor + title_length + subtitle_length > size) {
        return false;
      }
      if (catalog->item_count < DREAMCAST_GATEWAY_MAX_ITEMS) {
        DreamcastGatewayItem *item = &catalog->items[catalog->item_count++];
        item->rating_key = rating_key;
        item->duration_ms = duration_ms;
        item->view_offset_ms = view_offset_ms;
        copy_text(item->title, sizeof(item->title), bytes + cursor,
                  title_length);
        copy_text(item->subtitle, sizeof(item->subtitle),
                  bytes + cursor + title_length, subtitle_length);
      }
      cursor += title_length + subtitle_length;
    }
  }
  for (uint16_t library = 0; library < library_count; ++library) {
    if (cursor + 6u > size) {
      return false;
    }
    const uint16_t section_id = read_be16(bytes + cursor);
    const uint16_t title_length = read_be16(bytes + cursor + 4);
    cursor += 6u;
    if (section_id == 0 || title_length >= UPSTREAM_TEXT_CAPACITY ||
        cursor + title_length > size) {
      return false;
    }
    cursor += title_length;
  }
  return cursor == size && catalog->item_count > 0;
}

bool dreamcast_gateway_parse_playback(const uint8_t *bytes, size_t size,
                                      const char *base_url,
                                      DreamcastGatewayPlayback *playback) {
  if (bytes == NULL || base_url == NULL || playback == NULL ||
      size < PLAYBACK_HEADER_BYTES || memcmp(bytes, "MPXP", 4) != 0) {
    return false;
  }
  const uint16_t version = read_be16(bytes + 4);
  const uint16_t flags = read_be16(bytes + 6);
  const uint16_t path_length = read_be16(bytes + 60);
  const size_t base_length = strlen(base_url);
  const bool base_has_slash =
      base_length > 0 && base_url[base_length - 1u] == '/';
  if (version != 2 || (flags & 1u) == 0 || path_length < 2 ||
      bytes[PLAYBACK_HEADER_BYTES] != '/' ||
      (size_t)PLAYBACK_HEADER_BYTES + path_length != size) {
    return false;
  }

  memset(playback, 0, sizeof(*playback));
  playback->rating_key = read_be32(bytes + 8);
  playback->media_duration_ms = read_be32(bytes + 12);
  playback->segment_start_ms = read_be32(bytes + 16);
  playback->segment_duration_ms = read_be32(bytes + 20);
  playback->container_bytes = read_be32(bytes + 24);
  const int written =
      snprintf(playback->media_url, sizeof(playback->media_url), "%s%s%.*s",
               base_url, base_has_slash ? "" : "/", (int)path_length - 1,
               (const char *)(bytes + PLAYBACK_HEADER_BYTES + 1u));
  return playback->rating_key != 0 && playback->segment_duration_ms != 0 &&
         playback->container_bytes != 0 && written > 0 &&
         (size_t)written < sizeof(playback->media_url);
}
