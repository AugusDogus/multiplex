#include "gateway_client.h"

#include "http_client.h"

#include <gccore.h>
#include <stdio.h>
#include <string.h>

#define CATALOG_HEADER_BYTES 12u
#define BROWSE_HEADER_BYTES 16u
#define SEARCH_HEADER_BYTES 10u
#define DETAILS_HEADER_BYTES 40u
#define PLAYBACK_HEADER_BYTES 62u
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

static int64_t read_be64_signed(const uint8_t *bytes) {
  const uint64_t value = ((uint64_t)read_be32(bytes) << 32u) |
                         (uint64_t)read_be32(bytes + 4);
  return (int64_t)value;
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

static bool parse_search(const uint8_t *bytes, size_t size,
                         MultiplexGatewaySearchPage *page) {
  if (size < SEARCH_HEADER_BYTES || memcmp(bytes, "MPXS", 4) != 0) {
    return false;
  }
  memset(page, 0, sizeof(*page));
  page->version = read_be16(bytes + 4);
  page->item_count = read_be16(bytes + 6);
  page->query_length = read_be16(bytes + 8);
  if (page->version != 1 ||
      page->item_count > MULTIPLEX_GATEWAY_MAX_ITEMS ||
      page->query_length == 0 ||
      page->query_length >= MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY ||
      SEARCH_HEADER_BYTES + page->query_length > size) {
    return false;
  }
  size_t cursor = SEARCH_HEADER_BYTES;
  memcpy(page->query, bytes + cursor, page->query_length);
  cursor += page->query_length;
  for (uint16_t index = 0; index < page->item_count; ++index) {
    if (!parse_item(bytes, size, &cursor, &page->items[index])) {
      return false;
    }
  }
  return cursor == size;
}

static bool copy_detail_string(const uint8_t *bytes, size_t size,
                               size_t *cursor, char *destination,
                               size_t capacity, uint16_t length) {
  if (length >= capacity || *cursor + length > size) {
    return false;
  }
  memcpy(destination, bytes + *cursor, length);
  *cursor += length;
  return true;
}

static bool parse_details(const uint8_t *bytes, size_t size,
                          MultiplexGatewayDetails *details) {
  if (size < DETAILS_HEADER_BYTES || memcmp(bytes, "MPXD", 4) != 0) {
    return false;
  }
  memset(details, 0, sizeof(*details));
  details->version = read_be16(bytes + 4);
  details->flags = read_be16(bytes + 6);
  details->rating_key = read_be32(bytes + 8);
  details->duration_ms = read_be32(bytes + 12);
  details->view_offset_ms = read_be32(bytes + 16);
  details->year = read_be16(bytes + 20);
  details->rating_tenths = read_be16(bytes + 22);
  details->title_length = read_be16(bytes + 24);
  details->secondary_length = read_be16(bytes + 26);
  details->media_type_length = read_be16(bytes + 28);
  details->library_length = read_be16(bytes + 30);
  details->content_rating_length = read_be16(bytes + 32);
  details->summary_length = read_be16(bytes + 34);
  details->genres_length = read_be16(bytes + 36);
  details->directors_length = read_be16(bytes + 38);
  if (details->version != 1 || details->rating_key == 0 ||
      details->title_length == 0 || details->year > 9999u ||
      details->rating_tenths > 100u) {
    return false;
  }
  size_t cursor = DETAILS_HEADER_BYTES;
  return copy_detail_string(bytes, size, &cursor, details->title,
                            sizeof(details->title), details->title_length) &&
         copy_detail_string(bytes, size, &cursor, details->secondary,
                            sizeof(details->secondary),
                            details->secondary_length) &&
         copy_detail_string(bytes, size, &cursor, details->media_type,
                            sizeof(details->media_type),
                            details->media_type_length) &&
         copy_detail_string(bytes, size, &cursor, details->library,
                            sizeof(details->library), details->library_length) &&
         copy_detail_string(bytes, size, &cursor, details->content_rating,
                            sizeof(details->content_rating),
                            details->content_rating_length) &&
         copy_detail_string(bytes, size, &cursor, details->summary,
                            sizeof(details->summary), details->summary_length) &&
         copy_detail_string(bytes, size, &cursor, details->genres,
                            sizeof(details->genres), details->genres_length) &&
         copy_detail_string(bytes, size, &cursor, details->directors,
                            sizeof(details->directors),
                            details->directors_length) &&
         cursor == size;
}

static bool parse_playback_manifest(
    const uint8_t *bytes, size_t size, const char *base_url,
    MultiplexGatewayPlaybackManifest *manifest) {
  if (size < PLAYBACK_HEADER_BYTES || memcmp(bytes, "MPXP", 4) != 0) {
    return false;
  }
  memset(manifest, 0, sizeof(*manifest));
  manifest->version = read_be16(bytes + 4);
  manifest->flags = read_be16(bytes + 6);
  manifest->rating_key = read_be32(bytes + 8);
  manifest->media_duration_ms = read_be32(bytes + 12);
  manifest->segment_start_ms = read_be32(bytes + 16);
  manifest->segment_duration_ms = read_be32(bytes + 20);
  manifest->container_bytes = read_be32(bytes + 24);
  manifest->video_bytes = read_be32(bytes + 28);
  manifest->audio_bytes = read_be32(bytes + 32);
  manifest->video_packets = read_be32(bytes + 36);
  manifest->audio_packets = read_be32(bytes + 40);
  manifest->first_video_pts90k = read_be64_signed(bytes + 44);
  manifest->first_audio_pts90k = read_be64_signed(bytes + 52);
  const uint16_t path_length = read_be16(bytes + 60);
  if (manifest->version != 2 || (manifest->flags & 1u) == 0 ||
      manifest->rating_key == 0 || manifest->container_bytes == 0 ||
      manifest->media_duration_ms == 0 || manifest->segment_duration_ms == 0 ||
      manifest->segment_start_ms >= manifest->media_duration_ms ||
      manifest->video_bytes == 0 || manifest->audio_bytes == 0 ||
      manifest->first_video_pts90k < 0 ||
      manifest->first_audio_pts90k < 0 || path_length == 0 ||
      PLAYBACK_HEADER_BYTES + path_length != size ||
      bytes[PLAYBACK_HEADER_BYTES] != '/') {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool base_has_slash =
      base_length > 0 && base_url[base_length - 1] == '/';
  const uint16_t skipped = base_has_slash ? 1u : 0u;
  const int written = snprintf(
      manifest->media_url, sizeof(manifest->media_url), "%s%.*s", base_url,
      path_length - skipped,
      (const char *)(bytes + PLAYBACK_HEADER_BYTES + skipped));
  return written > 0 && (size_t)written < sizeof(manifest->media_url);
}

static bool encode_query(const char *query, uint16_t query_length,
                         char *encoded, size_t capacity) {
  static const char hex[] = "0123456789ABCDEF";
  if (query == NULL || query_length == 0 ||
      query_length >= MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY) {
    return false;
  }
  size_t cursor = 0;
  for (uint16_t index = 0; index < query_length; ++index) {
    const uint8_t value = (uint8_t)query[index];
    const bool unreserved =
        (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
        (value >= '0' && value <= '9') || value == '-' || value == '_' ||
        value == '.' || value == '~';
    const size_t required = unreserved ? 1u : 3u;
    if (cursor + required >= capacity) {
      return false;
    }
    if (unreserved) {
      encoded[cursor++] = (char)value;
    } else {
      encoded[cursor++] = '%';
      encoded[cursor++] = hex[value >> 4u];
      encoded[cursor++] = hex[value & 15u];
    }
  }
  encoded[cursor] = '\0';
  return true;
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

bool multiplex_gateway_load_search(const char *base_url, const char *query,
                                   uint16_t query_length,
                                   MultiplexGatewaySearchPage *page) {
  if (base_url == NULL || page == NULL) {
    return false;
  }
  char encoded_query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY * 3u];
  if (!encode_query(query, query_length, encoded_query,
                    sizeof(encoded_query))) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url), "%s%sv3/search.bin?q=%s",
                               base_url, has_slash ? "" : "/",
                               encoded_query);
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
                      parse_search(bytes, size, page) &&
                      page->query_length == query_length &&
                      memcmp(page->query, query, query_length) == 0;
  http_client_destroy(client);
  SYS_Report(
      "REFERENCE GX: gateway-search query=%.*s items=%u loaded=%u\n",
      query_length, query, loaded ? page->item_count : 0, loaded);
  return loaded;
}

bool multiplex_gateway_load_search_artwork(
    const char *base_url, const char *query, uint16_t query_length,
    uint8_t *destination, size_t capacity, size_t *encoded_size) {
  if (base_url == NULL || destination == NULL || encoded_size == NULL) {
    return false;
  }
  char encoded_query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY * 3u];
  if (!encode_query(query, query_length, encoded_query,
                    sizeof(encoded_query))) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url), "%s%sv3/search.jpg?q=%s",
                               base_url, has_slash ? "" : "/",
                               encoded_query);
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
      "REFERENCE GX: gateway-search-artwork query=%.*s bytes=%u loaded=%u\n",
      query_length, query, (unsigned)size, loaded);
  http_client_destroy(client);
  return loaded;
}

bool multiplex_gateway_load_details(const char *base_url, uint32_t rating_key,
                                    MultiplexGatewayDetails *details) {
  if (base_url == NULL || rating_key == 0 || details == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(url, sizeof(url),
                               "%s%sv3/details.bin?ratingKey=%u", base_url,
                               has_slash ? "" : "/", rating_key);
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
                      parse_details(bytes, size, details) &&
                      details->rating_key == rating_key;
  http_client_destroy(client);
  SYS_Report(
      "REFERENCE GX: gateway-details rating-key=%u title=%s playable=%u loaded=%u\n",
      rating_key, loaded ? details->title : "",
      loaded ? (details->flags & 1u) != 0 : 0, loaded);
  return loaded;
}

bool multiplex_gateway_load_playback_manifest(
    const char *base_url, uint32_t rating_key, uint32_t offset_ms,
    MultiplexGatewayPlaybackManifest *manifest) {
  if (base_url == NULL || base_url[0] == '\0' || manifest == NULL) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = rating_key == 0
                          ? snprintf(url, sizeof(url), "%s%sv4/playback.bin",
                                     base_url, has_slash ? "" : "/")
                          : snprintf(url, sizeof(url),
                                     "%s%sv4/playback.bin?ratingKey=%u&offsetMs=%u",
                                     base_url, has_slash ? "" : "/",
                                     rating_key, offset_ms);
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
                      parse_playback_manifest(bytes, size, base_url, manifest) &&
                      (rating_key == 0 ||
                       (manifest->rating_key == rating_key &&
                        manifest->segment_start_ms == offset_ms));
  http_client_destroy(client);
  SYS_Report(
      "REFERENCE GX: gateway-playback rating-key=%u offset=%u bytes=%u loaded=%u\n",
      loaded ? manifest->rating_key : 0,
      loaded ? manifest->segment_start_ms : 0,
      loaded ? manifest->container_bytes : 0, loaded);
  return loaded;
}

bool multiplex_gateway_report_timeline(
    const char *base_url, uint32_t rating_key, uint32_t position_ms,
    uint32_t duration_ms, const char *state) {
  if (base_url == NULL || base_url[0] == '\0' || rating_key == 0 ||
      duration_ms == 0 || state == NULL ||
      (strcmp(state, "playing") != 0 && strcmp(state, "paused") != 0 &&
       strcmp(state, "stopped") != 0)) {
    return false;
  }
  const size_t base_length = strlen(base_url);
  const bool has_slash = base_length > 0 && base_url[base_length - 1] == '/';
  char url[GATEWAY_URL_CAPACITY];
  const int written = snprintf(
      url, sizeof(url),
      "%s%sv4/timeline?ratingKey=%u&positionMs=%u&durationMs=%u&state=%s",
      base_url, has_slash ? "" : "/", rating_key, position_ms, duration_ms,
      state);
  if (written < 0 || (size_t)written >= sizeof(url)) {
    return false;
  }
  HttpClient *client = http_client_open(url);
  if (client == NULL) {
    return false;
  }
  uint8_t acknowledgment = 0;
  const bool reported = http_client_size(client) == 1 &&
                        http_client_read_at(client, 0, &acknowledgment, 1) &&
                        acknowledgment == 1;
  http_client_destroy(client);
  SYS_Report(
      "REFERENCE GX: gateway-timeline rating-key=%u position=%u state=%s "
      "reported=%u\n",
      rating_key, position_ms, state, reported);
  return reported;
}
