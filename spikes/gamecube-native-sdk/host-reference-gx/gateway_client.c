#include "gateway_client.h"

#include "http_client.h"

#include <gccore.h>
#include <stdio.h>
#include <string.h>

#define CATALOG_HEADER_BYTES 12u
#define BROWSE_HEADER_BYTES 16u
#define CATALOG_ITEM_HEADER_BYTES 20u
#define CATALOG_MAX_BYTES 2048u
#define GATEWAY_URL_CAPACITY 768u

#if MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES != 19200
#error "Gateway and GameCube artwork dimensions must stay in lockstep"
#endif

static uint16_t read_be16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static uint32_t read_be32(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24u) | ((uint32_t)bytes[1] << 16u) |
         ((uint32_t)bytes[2] << 8u) | bytes[3];
}

static bool parse_item(const uint8_t *bytes, size_t size, size_t *cursor,
                       MultiplexGatewayItem *item) {
  if (*cursor + CATALOG_ITEM_HEADER_BYTES > size) {
    return false;
  }
  item->rating_key = read_be32(bytes + *cursor);
  item->duration_ms = read_be32(bytes + *cursor + 4);
  item->view_offset_ms = read_be32(bytes + *cursor + 8);
  item->artwork_slot = read_be16(bytes + *cursor + 12);
  item->progress_percent = bytes[*cursor + 14];
  item->title_length = read_be16(bytes + *cursor + 16);
  item->subtitle_length = read_be16(bytes + *cursor + 18);
  *cursor += CATALOG_ITEM_HEADER_BYTES;
  if (item->title_length >= MULTIPLEX_GATEWAY_TITLE_CAPACITY ||
      item->subtitle_length >= MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY ||
      *cursor + item->title_length + item->subtitle_length > size) {
    return false;
  }
  memcpy(item->title, bytes + *cursor, item->title_length);
  *cursor += item->title_length;
  memcpy(item->subtitle, bytes + *cursor, item->subtitle_length);
  *cursor += item->subtitle_length;
  return true;
}

static bool parse_catalog(const uint8_t *bytes, size_t size,
                          MultiplexGatewayCatalog *catalog) {
  if (size < CATALOG_HEADER_BYTES || memcmp(bytes, "MPXG", 4) != 0) {
    return false;
  }
  const uint16_t version = read_be16(bytes + 4);
  const uint16_t row_count = read_be16(bytes + 6);
  const uint16_t server_length = read_be16(bytes + 8);
  const uint16_t library_count = read_be16(bytes + 10);
  if (version != 3 || row_count == 0 ||
      row_count > MULTIPLEX_GATEWAY_MAX_ROWS ||
      library_count > MULTIPLEX_GATEWAY_MAX_LIBRARIES ||
      server_length >= MULTIPLEX_GATEWAY_SERVER_CAPACITY ||
      CATALOG_HEADER_BYTES + server_length > size) {
    return false;
  }

  memset(catalog, 0, sizeof(*catalog));
  catalog->version = version;
  catalog->row_count = row_count;
  catalog->library_count = library_count;
  catalog->server_name_length = server_length;
  memcpy(catalog->server_name, bytes + CATALOG_HEADER_BYTES, server_length);

  size_t cursor = CATALOG_HEADER_BYTES + server_length;
  for (uint16_t row_index = 0; row_index < row_count; ++row_index) {
    if (cursor + 4u > size) {
      return false;
    }
    MultiplexGatewayRow *row = &catalog->rows[row_index];
    row->title_length = read_be16(bytes + cursor);
    row->item_count = read_be16(bytes + cursor + 2);
    row->item_offset = catalog->total_item_count;
    cursor += 4u;
    if (row->title_length >= MULTIPLEX_GATEWAY_TITLE_CAPACITY ||
        row->item_count == 0 || row->item_count > MULTIPLEX_GATEWAY_MAX_ITEMS ||
        catalog->total_item_count + row->item_count >
            MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS ||
        cursor + row->title_length > size) {
      return false;
    }
    memcpy(row->title, bytes + cursor, row->title_length);
    cursor += row->title_length;
    for (uint16_t item_index = 0; item_index < row->item_count;
         ++item_index) {
      MultiplexGatewayItem *item =
          &catalog->items[catalog->total_item_count];
      if (!parse_item(bytes, size, &cursor, item)) {
        return false;
      }
      catalog->total_item_count += 1;
    }
  }
  for (uint16_t index = 0; index < library_count; ++index) {
    if (cursor + 6u > size) {
      return false;
    }
    MultiplexGatewayLibrary *library = &catalog->libraries[index];
    library->section_id = read_be16(bytes + cursor);
    library->media_type = bytes[cursor + 2];
    library->title_length = read_be16(bytes + cursor + 4);
    cursor += 6u;
    if (library->section_id == 0 ||
        library->title_length >= MULTIPLEX_GATEWAY_TITLE_CAPACITY ||
        cursor + library->title_length > size) {
      return false;
    }
    memcpy(library->title, bytes + cursor, library->title_length);
    cursor += library->title_length;
  }
  return cursor == size;
}

static bool parse_browse(const uint8_t *bytes, size_t size,
                         MultiplexGatewayBrowsePage *page) {
  if (size < BROWSE_HEADER_BYTES || memcmp(bytes, "MPXB", 4) != 0) {
    return false;
  }
  memset(page, 0, sizeof(*page));
  page->version = read_be16(bytes + 4);
  page->section_id = read_be16(bytes + 6);
  page->item_count = read_be16(bytes + 8);
  page->start = read_be16(bytes + 10);
  page->total_size = read_be16(bytes + 12);
  page->title_length = read_be16(bytes + 14);
  if (page->version != 1 || page->section_id == 0 ||
      page->item_count == 0 ||
      page->item_count > MULTIPLEX_GATEWAY_MAX_ITEMS ||
      page->title_length >= MULTIPLEX_GATEWAY_TITLE_CAPACITY ||
      BROWSE_HEADER_BYTES + page->title_length > size) {
    return false;
  }
  size_t cursor = BROWSE_HEADER_BYTES;
  memcpy(page->title, bytes + cursor, page->title_length);
  cursor += page->title_length;
  for (uint16_t index = 0; index < page->item_count; ++index) {
    if (!parse_item(bytes, size, &cursor, &page->items[index])) {
      return false;
    }
  }
  return cursor == size;
}

bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog) {
  if (base_url == NULL || base_url[0] == '\0' || catalog == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  static const char path[] = "/v3/catalog.bin";
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url), "%s%s%s", base_url,
                               has_slash ? "" : "/", path + 1);
  if (written < 0 || (size_t)written >= sizeof(url)) {
    SYS_Report("REFERENCE GX: gateway catalog URL is too long\n");
    return false;
  }

  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    SYS_Report("REFERENCE GX: gateway catalog HTTP open failed\n");
    return false;
  }
  const size_t size = http_client_size(client);
  uint8_t bytes[CATALOG_MAX_BYTES];
  const bool loaded = size > 0 && size <= sizeof(bytes) &&
                      http_client_read_at(client, 0, bytes, size) &&
                      parse_catalog(bytes, size, catalog);
  http_client_destroy(client);
  if (!loaded) {
    SYS_Report("REFERENCE GX: invalid gateway catalog bytes=%u\n",
               (unsigned)size);
    return false;
  }
  SYS_Report(
      "REFERENCE GX: gateway-catalog version=%u server=%s rows=%u items=%u libraries=%u first=%s\n",
      catalog->version, catalog->server_name, catalog->row_count,
      catalog->total_item_count, catalog->library_count,
      catalog->total_item_count == 0 ? "" : catalog->items[0].title);
  return true;
}

bool multiplex_gateway_load_artwork(const char *base_url,
                                    uint8_t *destination, size_t capacity,
                                    size_t *encoded_size) {
  if (base_url == NULL || destination == NULL || encoded_size == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url), "%s%sv2/artwork.jpg",
                               base_url, has_slash ? "" : "/");
  if (written < 0 || (size_t)written >= sizeof(url)) {
    return false;
  }
  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    return false;
  }
  const size_t size = http_client_size(client);
  if (size == 0 || size > capacity) {
    SYS_Report("REFERENCE GX: gateway artwork size invalid capacity=%u actual=%u\n",
               (unsigned)capacity, (unsigned)size);
    http_client_destroy(client);
    return false;
  }
  const bool loaded = http_client_read_at(client, 0, destination, size);
  *encoded_size = loaded ? size : 0;
  SYS_Report("REFERENCE GX: gateway-artwork format=jpeg bytes=%u loaded=%u\n",
             (unsigned)size, loaded);
  http_client_destroy(client);
  return loaded;
}

bool multiplex_gateway_load_browse(const char *base_url, uint16_t section_id,
                                   uint16_t start,
                                   MultiplexGatewayBrowsePage *page) {
  if (base_url == NULL || section_id == 0 || page == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(
      url, sizeof(url), "%s%sv3/browse.bin?section=%u&start=%u", base_url,
      has_slash ? "" : "/", section_id, start);
  if (written < 0 || (size_t)written >= sizeof(url)) {
    return false;
  }
  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    return false;
  }
  const size_t size = http_client_size(client);
  uint8_t bytes[CATALOG_MAX_BYTES];
  const bool loaded = size > 0 && size <= sizeof(bytes) &&
                      http_client_read_at(client, 0, bytes, size) &&
                      parse_browse(bytes, size, page) &&
                      page->section_id == section_id && page->start == start;
  http_client_destroy(client);
  SYS_Report(
      "REFERENCE GX: gateway-browse section=%u start=%u items=%u total=%u loaded=%u\n",
      section_id, start, loaded ? page->item_count : 0,
      loaded ? page->total_size : 0, loaded);
  return loaded;
}

bool multiplex_gateway_load_browse_artwork(
    const char *base_url, uint16_t section_id, uint16_t start,
    uint8_t *destination, size_t capacity, size_t *encoded_size) {
  if (base_url == NULL || section_id == 0 || destination == NULL ||
      encoded_size == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(
      url, sizeof(url), "%s%sv3/browse.jpg?section=%u&start=%u", base_url,
      has_slash ? "" : "/", section_id, start);
  if (written < 0 || (size_t)written >= sizeof(url)) {
    return false;
  }
  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    return false;
  }
  const size_t size = http_client_size(client);
  if (size == 0 || size > capacity) {
    http_client_destroy(client);
    return false;
  }
  const bool loaded = http_client_read_at(client, 0, destination, size);
  *encoded_size = loaded ? size : 0;
  SYS_Report(
      "REFERENCE GX: gateway-browse-artwork section=%u start=%u bytes=%u loaded=%u\n",
      section_id, start, (unsigned)size, loaded);
  http_client_destroy(client);
  return loaded;
}
