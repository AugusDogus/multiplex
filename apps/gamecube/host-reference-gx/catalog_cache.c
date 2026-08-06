#include "catalog_cache.h"

#include <limits.h>
#include <string.h>

#define CATALOG_CACHE_VERSION 1u
#define CATALOG_CACHE_HEADER_SIZE 16u
#define CATALOG_CACHE_STRING_LIMIT 63u

static void write_be16(uint8_t *destination, uint16_t value) {
  destination[0] = (uint8_t)(value >> 8u);
  destination[1] = (uint8_t)value;
}

static void write_be32(uint8_t *destination, uint32_t value) {
  destination[0] = (uint8_t)(value >> 24u);
  destination[1] = (uint8_t)(value >> 16u);
  destination[2] = (uint8_t)(value >> 8u);
  destination[3] = (uint8_t)value;
}

static uint16_t read_be16(const uint8_t *source) {
  return (uint16_t)(((uint16_t)source[0] << 8u) | source[1]);
}

static uint32_t read_be32(const uint8_t *source) {
  return ((uint32_t)source[0] << 24u) | ((uint32_t)source[1] << 16u) |
         ((uint32_t)source[2] << 8u) | source[3];
}

static uint32_t crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = UINT32_MAX;
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8; ++bit) {
      const uint32_t mask = (uint32_t) - (int32_t)(crc & 1u);
      crc = (crc >> 1u) ^ (UINT32_C(0xedb88320) & mask);
    }
  }
  return ~crc;
}

static uint8_t cached_length(uint16_t length) {
  return (uint8_t)(length > CATALOG_CACHE_STRING_LIMIT
                       ? CATALOG_CACHE_STRING_LIMIT
                       : length);
}

static bool append_bytes(uint8_t *destination, size_t *cursor,
                         const void *source, size_t size) {
  if (size > MULTIPLEX_CATALOG_CACHE_SIZE ||
      *cursor > MULTIPLEX_CATALOG_CACHE_SIZE - size) {
    return false;
  }
  memcpy(destination + *cursor, source, size);
  *cursor += size;
  return true;
}

static bool append_u8(uint8_t *destination, size_t *cursor, uint8_t value) {
  return append_bytes(destination, cursor, &value, sizeof(value));
}

static bool append_u16(uint8_t *destination, size_t *cursor, uint16_t value) {
  uint8_t encoded[2];
  write_be16(encoded, value);
  return append_bytes(destination, cursor, encoded, sizeof(encoded));
}

static bool append_u32(uint8_t *destination, size_t *cursor, uint32_t value) {
  uint8_t encoded[4];
  write_be32(encoded, value);
  return append_bytes(destination, cursor, encoded, sizeof(encoded));
}

static bool read_bytes(const uint8_t *source, size_t payload_end,
                       size_t *cursor, void *destination, size_t size) {
  if (size > payload_end || *cursor > payload_end - size) {
    return false;
  }
  memcpy(destination, source + *cursor, size);
  *cursor += size;
  return true;
}

static bool read_u8(const uint8_t *source, size_t payload_end, size_t *cursor,
                    uint8_t *value) {
  return read_bytes(source, payload_end, cursor, value, sizeof(*value));
}

static bool read_u16(const uint8_t *source, size_t payload_end, size_t *cursor,
                     uint16_t *value) {
  uint8_t encoded[2];
  if (!read_bytes(source, payload_end, cursor, encoded, sizeof(encoded))) {
    return false;
  }
  *value = read_be16(encoded);
  return true;
}

static bool read_u32(const uint8_t *source, size_t payload_end, size_t *cursor,
                     uint32_t *value) {
  uint8_t encoded[4];
  if (!read_bytes(source, payload_end, cursor, encoded, sizeof(encoded))) {
    return false;
  }
  *value = read_be32(encoded);
  return true;
}

bool multiplex_catalog_cache_encode(
    uint8_t destination[MULTIPLEX_CATALOG_CACHE_SIZE],
    const MultiplexGatewayCatalog *catalog) {
  if (destination == NULL || catalog == NULL || catalog->row_count == 0 ||
      catalog->row_count > MULTIPLEX_GATEWAY_MAX_ROWS ||
      catalog->total_item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS ||
      catalog->library_count > MULTIPLEX_GATEWAY_MAX_LIBRARIES) {
    return false;
  }
  memset(destination, 0, MULTIPLEX_CATALOG_CACHE_SIZE);
  size_t cursor = CATALOG_CACHE_HEADER_SIZE;
  const uint8_t server_length = cached_length(catalog->server_name_length);
  if (!append_u16(destination, &cursor, catalog->version) ||
      !append_u8(destination, &cursor, (uint8_t)catalog->row_count) ||
      !append_u8(destination, &cursor, (uint8_t)catalog->total_item_count) ||
      !append_u8(destination, &cursor, (uint8_t)catalog->library_count) ||
      !append_u8(destination, &cursor, server_length) ||
      !append_bytes(destination, &cursor, catalog->server_name,
                    server_length)) {
    return false;
  }
  for (uint16_t index = 0; index < catalog->row_count; ++index) {
    const MultiplexGatewayRow *row = &catalog->rows[index];
    const uint8_t title_length = cached_length(row->title_length);
    if (row->item_count > MULTIPLEX_GATEWAY_MAX_HOME_ITEMS ||
        row->item_offset + row->item_count > catalog->total_item_count ||
        !append_u8(destination, &cursor, (uint8_t)row->item_count) ||
        !append_u8(destination, &cursor, (uint8_t)row->item_offset) ||
        !append_u8(destination, &cursor, title_length) ||
        !append_bytes(destination, &cursor, row->title, title_length)) {
      return false;
    }
  }
  for (uint16_t index = 0; index < catalog->total_item_count; ++index) {
    const MultiplexGatewayItem *item = &catalog->items[index];
    const uint8_t title_length = cached_length(item->title_length);
    const uint8_t subtitle_length = cached_length(item->subtitle_length);
    if (item->rating_key == 0 ||
        !append_u32(destination, &cursor, item->rating_key) ||
        !append_u32(destination, &cursor, item->duration_ms) ||
        !append_u32(destination, &cursor, item->view_offset_ms) ||
        !append_u8(destination, &cursor, item->progress_percent) ||
        !append_u8(destination, &cursor, title_length) ||
        !append_u8(destination, &cursor, subtitle_length) ||
        !append_bytes(destination, &cursor, item->title, title_length) ||
        !append_bytes(destination, &cursor, item->subtitle, subtitle_length)) {
      return false;
    }
  }
  for (uint16_t index = 0; index < catalog->library_count; ++index) {
    const MultiplexGatewayLibrary *library = &catalog->libraries[index];
    const uint8_t title_length = cached_length(library->title_length);
    if (library->section_id == 0 ||
        !append_u16(destination, &cursor, library->section_id) ||
        !append_u8(destination, &cursor, library->media_type) ||
        !append_u8(destination, &cursor, title_length) ||
        !append_bytes(destination, &cursor, library->title, title_length)) {
      return false;
    }
  }
  const size_t payload_size = cursor - CATALOG_CACHE_HEADER_SIZE;
  memcpy(destination, "MPXC", 4);
  write_be16(destination + 4, CATALOG_CACHE_VERSION);
  write_be16(destination + 6, CATALOG_CACHE_HEADER_SIZE);
  write_be32(destination + 8, (uint32_t)payload_size);
  write_be32(destination + 12,
             crc32(destination + CATALOG_CACHE_HEADER_SIZE, payload_size));
  return true;
}

bool multiplex_catalog_cache_decode(
    const uint8_t source[MULTIPLEX_CATALOG_CACHE_SIZE],
    MultiplexGatewayCatalog *catalog) {
  if (source == NULL || catalog == NULL || memcmp(source, "MPXC", 4) != 0 ||
      read_be16(source + 4) != CATALOG_CACHE_VERSION ||
      read_be16(source + 6) != CATALOG_CACHE_HEADER_SIZE) {
    return false;
  }
  const size_t payload_size = read_be32(source + 8);
  if (payload_size > MULTIPLEX_CATALOG_CACHE_SIZE - CATALOG_CACHE_HEADER_SIZE ||
      crc32(source + CATALOG_CACHE_HEADER_SIZE, payload_size) !=
          read_be32(source + 12)) {
    return false;
  }
  const size_t payload_end = CATALOG_CACHE_HEADER_SIZE + payload_size;
  size_t cursor = CATALOG_CACHE_HEADER_SIZE;
  uint8_t row_count = 0;
  uint8_t item_count = 0;
  uint8_t library_count = 0;
  uint8_t server_length = 0;
  memset(catalog, 0, sizeof(*catalog));
  if (!read_u16(source, payload_end, &cursor, &catalog->version) ||
      !read_u8(source, payload_end, &cursor, &row_count) ||
      !read_u8(source, payload_end, &cursor, &item_count) ||
      !read_u8(source, payload_end, &cursor, &library_count) ||
      !read_u8(source, payload_end, &cursor, &server_length) ||
      row_count == 0 || row_count > MULTIPLEX_GATEWAY_MAX_ROWS ||
      item_count > MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS ||
      library_count > MULTIPLEX_GATEWAY_MAX_LIBRARIES ||
      server_length >= sizeof(catalog->server_name) ||
      !read_bytes(source, payload_end, &cursor, catalog->server_name,
                  server_length)) {
    return false;
  }
  catalog->row_count = row_count;
  catalog->total_item_count = item_count;
  catalog->library_count = library_count;
  catalog->server_name_length = server_length;
  for (uint16_t index = 0; index < catalog->row_count; ++index) {
    MultiplexGatewayRow *row = &catalog->rows[index];
    uint8_t cached_item_count = 0;
    uint8_t cached_item_offset = 0;
    uint8_t title_length = 0;
    if (!read_u8(source, payload_end, &cursor, &cached_item_count) ||
        !read_u8(source, payload_end, &cursor, &cached_item_offset) ||
        !read_u8(source, payload_end, &cursor, &title_length) ||
        cached_item_count > MULTIPLEX_GATEWAY_MAX_HOME_ITEMS ||
        cached_item_offset + cached_item_count > item_count ||
        title_length >= sizeof(row->title) ||
        !read_bytes(source, payload_end, &cursor, row->title, title_length)) {
      return false;
    }
    row->item_count = cached_item_count;
    row->item_offset = cached_item_offset;
    row->title_length = title_length;
  }
  for (uint16_t index = 0; index < catalog->total_item_count; ++index) {
    MultiplexGatewayItem *item = &catalog->items[index];
    uint8_t title_length = 0;
    uint8_t subtitle_length = 0;
    if (!read_u32(source, payload_end, &cursor, &item->rating_key) ||
        !read_u32(source, payload_end, &cursor, &item->duration_ms) ||
        !read_u32(source, payload_end, &cursor, &item->view_offset_ms) ||
        !read_u8(source, payload_end, &cursor, &item->progress_percent) ||
        !read_u8(source, payload_end, &cursor, &title_length) ||
        !read_u8(source, payload_end, &cursor, &subtitle_length) ||
        item->rating_key == 0 || title_length >= sizeof(item->title) ||
        subtitle_length >= sizeof(item->subtitle) ||
        !read_bytes(source, payload_end, &cursor, item->title, title_length) ||
        !read_bytes(source, payload_end, &cursor, item->subtitle,
                    subtitle_length)) {
      return false;
    }
    item->title_length = title_length;
    item->subtitle_length = subtitle_length;
    item->artwork_slot = index;
  }
  for (uint16_t index = 0; index < catalog->library_count; ++index) {
    MultiplexGatewayLibrary *library = &catalog->libraries[index];
    uint8_t title_length = 0;
    if (!read_u16(source, payload_end, &cursor, &library->section_id) ||
        !read_u8(source, payload_end, &cursor, &library->media_type) ||
        !read_u8(source, payload_end, &cursor, &title_length) ||
        library->section_id == 0 || title_length >= sizeof(library->title) ||
        !read_bytes(source, payload_end, &cursor, library->title,
                    title_length)) {
      return false;
    }
    library->title_length = title_length;
  }
  return cursor == payload_end;
}
