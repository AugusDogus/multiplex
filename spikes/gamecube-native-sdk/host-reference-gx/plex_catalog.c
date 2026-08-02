#include "plex_catalog.h"

#include "http_client.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef GEKKO
#include <gccore.h>
#else
#define SYS_Report(...) ((void)0)
#endif

#define PLEX_HUB_RESPONSE_CAPACITY (128u * 1024u)
#define PLEX_LIBRARY_RESPONSE_CAPACITY (8u * 1024u)
#define PLEX_BROWSE_RESPONSE_CAPACITY (64u * 1024u)
#define PLEX_DETAILS_RESPONSE_CAPACITY (64u * 1024u)
#define PLEX_SEARCH_RESPONSE_CAPACITY (64u * 1024u)
#define PLEX_CATALOG_URL_CAPACITY 1280u
#define PLEX_REQUEST_ATTEMPTS 4u
#define PLEX_COMPACT_ITEMS_QUERY                                               \
  "excludeElements=Media,Image,Role,Writer,Director,Producer,Genre,Country,"  \
  "UltraBlurColors,Rating,Guid&"                                              \
  "excludeFields=summary,UltraBlurColors,guid,art,parentGuid,grandparentGuid," \
  "grandparentArt,audienceRatingImage,librarySectionKey,grandparentTheme,"     \
  "ratingImage,key,parentThumb,grandparentKey,parentKey,tagline,"              \
  "originallyAvailableAt,addedAt,updatedAt,studio,slug,grandparentSlug,"       \
  "librarySectionTitle,composite,lastViewedAt,contentRating,parentTitle,"      \
  "chapterSource,originalTitle,parentRatingKey,grandparentRatingKey,"          \
  "titleSort,rating"

typedef struct {
  const char *begin;
  const char *end;
} JsonSpan;

static const char *skip_space(const char *cursor, const char *end) {
  while (cursor < end &&
         (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' ||
          *cursor == '\n')) {
    ++cursor;
  }
  return cursor;
}

static const char *find_bytes(JsonSpan span, const char *value) {
  const size_t size = strlen(value);
  if (size == 0 || (size_t)(span.end - span.begin) < size) {
    return NULL;
  }
  for (const char *cursor = span.begin; cursor + size <= span.end; ++cursor) {
    if (memcmp(cursor, value, size) == 0) {
      return cursor;
    }
  }
  return NULL;
}

static bool json_value(JsonSpan span, const char *key, const char **value) {
  char pattern[80];
  const int pattern_size =
      snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  if (pattern_size <= 0 || (size_t)pattern_size >= sizeof(pattern)) {
    return false;
  }
  const char *cursor = find_bytes(span, pattern);
  if (cursor == NULL) {
    return false;
  }
  cursor = skip_space(cursor + pattern_size, span.end);
  if (cursor == span.end || *cursor++ != ':') {
    return false;
  }
  *value = skip_space(cursor, span.end);
  return *value < span.end;
}

static bool json_string(JsonSpan span, const char *key, char *destination,
                        size_t capacity) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor) || *cursor++ != '"' || capacity == 0) {
    return false;
  }
  size_t output = 0;
  while (cursor < span.end && *cursor != '"') {
    unsigned char value = (unsigned char)*cursor++;
    if (value == '\\') {
      if (cursor == span.end) {
        return false;
      }
      value = (unsigned char)*cursor++;
      if (value == '"' || value == '\\' || value == '/') {
        /* JSON's single-character escapes map directly. */
      } else if (value == 'b') {
        value = '\b';
      } else if (value == 'f') {
        value = '\f';
      } else if (value == 'n') {
        value = '\n';
      } else if (value == 'r') {
        value = '\r';
      } else if (value == 't') {
        value = '\t';
      } else {
        return false;
      }
    }
    if (value < 0x20) {
      return false;
    }
    if (output + 1u < capacity) {
      destination[output++] = (char)value;
    }
  }
  if (cursor == span.end || *cursor != '"') {
    return false;
  }
  while (output > 0 &&
         ((unsigned char)destination[output - 1u] & 0xc0u) == 0x80u) {
    --output;
  }
  destination[output] = '\0';
  return true;
}

static bool json_unsigned(JsonSpan span, const char *key,
                          uint32_t *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor)) {
    return false;
  }
  const bool quoted = *cursor == '"';
  if (quoted) {
    ++cursor;
  }
  if (cursor == span.end || *cursor < '0' || *cursor > '9') {
    return false;
  }
  uint32_t value = 0;
  do {
    const uint32_t digit = (uint32_t)(*cursor++ - '0');
    if (value > (UINT32_MAX - digit) / 10u) {
      return false;
    }
    value = value * 10u + digit;
  } while (cursor < span.end && *cursor >= '0' && *cursor <= '9');
  if (quoted && (cursor == span.end || *cursor != '"')) {
    return false;
  }
  *destination = value;
  return true;
}

static bool json_boolean(JsonSpan span, const char *key, bool *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor)) {
    return false;
  }
  if ((size_t)(span.end - cursor) >= 4u &&
      memcmp(cursor, "true", 4u) == 0) {
    *destination = true;
    return true;
  }
  if ((size_t)(span.end - cursor) >= 5u &&
      memcmp(cursor, "false", 5u) == 0) {
    *destination = false;
    return true;
  }
  return false;
}

static bool json_decimal_tenths(JsonSpan span, const char *key,
                                uint16_t *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor) || cursor == span.end ||
      *cursor < '0' || *cursor > '9') {
    return false;
  }
  uint32_t whole = 0;
  while (cursor < span.end && *cursor >= '0' && *cursor <= '9') {
    whole = whole * 10u + (uint32_t)(*cursor++ - '0');
    if (whole > 10u) {
      return false;
    }
  }
  uint32_t tenths = whole * 10u;
  if (cursor < span.end && *cursor == '.') {
    ++cursor;
    if (cursor < span.end && *cursor >= '0' && *cursor <= '9') {
      tenths += (uint32_t)(*cursor++ - '0');
      if (cursor < span.end && *cursor >= '5' && *cursor <= '9') {
        ++tenths;
      }
    }
  }
  if (tenths > 100u) {
    tenths = 100u;
  }
  *destination = (uint16_t)tenths;
  return true;
}

static bool json_object(const char *cursor, const char *end, JsonSpan *object,
                        const char **next) {
  cursor = skip_space(cursor, end);
  while (cursor < end && *cursor == ',') {
    cursor = skip_space(cursor + 1, end);
  }
  if (cursor == end || *cursor != '{') {
    return false;
  }
  const char *begin = cursor++;
  unsigned depth = 1;
  bool quoted = false;
  bool escaped = false;
  while (cursor < end) {
    const char value = *cursor++;
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (value == '\\') {
        escaped = true;
      } else if (value == '"') {
        quoted = false;
      }
      continue;
    }
    if (value == '"') {
      quoted = true;
    } else if (value == '{') {
      ++depth;
    } else if (value == '}' && --depth == 0) {
      object->begin = begin;
      object->end = cursor;
      *next = cursor;
      return true;
    }
  }
  return false;
}

static bool metadata_array(JsonSpan hub, const char **array) {
  return json_value(hub, "Metadata", array) && **array == '[';
}

static void item_subtitle(JsonSpan object, const char *type,
                          MultiplexGatewayItem *item) {
  if (strcmp(type, "episode") == 0) {
    char episode[MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY] = "Episode";
    uint32_t season = 0;
    uint32_t number = 0;
    json_string(object, "title", episode, sizeof(episode));
    if (json_unsigned(object, "parentIndex", &season) &&
        json_unsigned(object, "index", &number)) {
      snprintf(item->subtitle, sizeof(item->subtitle), "%.60s - S%02u E%02u",
               episode, (unsigned)season, (unsigned)number);
    } else {
      strcpy(item->subtitle, episode);
    }
  } else {
    uint32_t year = 0;
    if (json_unsigned(object, "year", &year)) {
      snprintf(item->subtitle, sizeof(item->subtitle), "%u", (unsigned)year);
    } else {
      snprintf(item->subtitle, sizeof(item->subtitle), "%c%s",
               type[0] >= 'a' && type[0] <= 'z' ? type[0] - 'a' + 'A'
                                                : type[0],
               type + (type[0] == '\0' ? 0 : 1));
    }
  }
  item->subtitle_length = (uint16_t)strlen(item->subtitle);
}

static bool parse_item(JsonSpan object, MultiplexGatewayItem *item,
                       uint16_t artwork_slot) {
  char type[32];
  uint32_t rating_key = 0;
  if (!json_unsigned(object, "ratingKey", &rating_key) || rating_key == 0 ||
      !json_string(object, "type", type, sizeof(type))) {
    return false;
  }
  memset(item, 0, sizeof(*item));
  item->rating_key = rating_key;
  if (strcmp(type, "episode") == 0) {
    if (!json_string(object, "grandparentTitle", item->title,
                     sizeof(item->title))) {
      return false;
    }
  } else if (!json_string(object, "title", item->title,
                          sizeof(item->title))) {
    return false;
  }
  item->title_length = (uint16_t)strlen(item->title);
  if (!json_string(object, "grandparentThumb", item->artwork_path,
                   sizeof(item->artwork_path))) {
    json_string(object, "thumb", item->artwork_path,
                sizeof(item->artwork_path));
  }
  json_unsigned(object, "duration", &item->duration_ms);
  json_unsigned(object, "viewOffset", &item->view_offset_ms);
  item->artwork_slot = artwork_slot;
  item->progress_percent =
      item->duration_ms == 0
          ? 0
          : (uint8_t)(((uint64_t)item->view_offset_ms * 100u) /
                      item->duration_ms);
  if (item->progress_percent > 100u) {
    item->progress_percent = 100u;
  }
  item_subtitle(object, type, item);
  return item->title_length != 0;
}

static bool parse_child(JsonSpan object, MultiplexGatewayItem *item,
                        uint16_t artwork_slot) {
  char type[32];
  uint32_t rating_key = 0;
  if (!json_unsigned(object, "ratingKey", &rating_key) || rating_key == 0 ||
      !json_string(object, "type", type, sizeof(type)) ||
      !json_string(object, "title", item->title, sizeof(item->title))) {
    return false;
  }
  item->rating_key = rating_key;
  item->title_length = (uint16_t)strlen(item->title);
  if (!json_string(object, "thumb", item->artwork_path,
                   sizeof(item->artwork_path))) {
    json_string(object, "grandparentThumb", item->artwork_path,
                sizeof(item->artwork_path));
  }
  json_unsigned(object, "duration", &item->duration_ms);
  json_unsigned(object, "viewOffset", &item->view_offset_ms);
  item->artwork_slot = artwork_slot;
  item->progress_percent =
      item->duration_ms == 0
          ? 0
          : (uint8_t)(((uint64_t)item->view_offset_ms * 100u) /
                      item->duration_ms);
  if (item->progress_percent > 100u) {
    item->progress_percent = 100u;
  }
  if (strcmp(type, "episode") == 0) {
    uint32_t season = 0;
    uint32_t episode = 0;
    if (json_unsigned(object, "parentIndex", &season) &&
        json_unsigned(object, "index", &episode)) {
      snprintf(item->subtitle, sizeof(item->subtitle), "S%02u E%02u",
               (unsigned)season, (unsigned)episode);
    } else {
      strcpy(item->subtitle, "Episode");
    }
  } else {
    item_subtitle(object, type, item);
  }
  item->subtitle_length = (uint16_t)strlen(item->subtitle);
  return item->title_length != 0;
}

static bool parse_hub_items(JsonSpan hub, MultiplexGatewayCatalog *catalog,
                            MultiplexGatewayRow *row) {
  const char *array = NULL;
  if (!metadata_array(hub, &array)) {
    return false;
  }
  row->item_offset = catalog->total_item_count;
  const char *cursor = array + 1;
  while (cursor < hub.end &&
         row->item_count < MULTIPLEX_GATEWAY_MAX_HOME_ITEMS) {
    cursor = skip_space(cursor, hub.end);
    if (cursor < hub.end && *cursor == ']') {
      break;
    }
    JsonSpan object;
    const char *next = NULL;
    if (!json_object(cursor, hub.end, &object, &next)) {
      return false;
    }
    MultiplexGatewayItem *item =
        &catalog->items[catalog->total_item_count];
    if (parse_item(object, item, catalog->total_item_count)) {
      ++row->item_count;
      ++catalog->total_item_count;
    }
    cursor = next;
  }
  return row->item_count != 0;
}

static bool add_hub(JsonSpan hub, MultiplexGatewayCatalog *catalog) {
  if (catalog->row_count >= MULTIPLEX_GATEWAY_MAX_ROWS ||
      catalog->total_item_count >= MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS) {
    return false;
  }
  MultiplexGatewayRow *row = &catalog->rows[catalog->row_count];
  if (!json_string(hub, "title", row->title, sizeof(row->title))) {
    return false;
  }
  row->title_length = (uint16_t)strlen(row->title);
  if (row->title_length == 0 || !parse_hub_items(hub, catalog, row)) {
    return false;
  }
  ++catalog->row_count;
  return true;
}

static bool hub_kind(JsonSpan hub, bool continue_row, bool *matches) {
  char identifier[96];
  if (!json_string(hub, "hubIdentifier", identifier, sizeof(identifier))) {
    return false;
  }
  const bool is_continue = strstr(identifier, ".continue") != NULL ||
                           strstr(identifier, ".inprogress") != NULL;
  const bool is_on_deck = strstr(identifier, "home.ondeck") != NULL;
  *matches = continue_row ? is_continue : (!is_continue && !is_on_deck);
  return true;
}

static bool add_matching_hubs(const char *array, const char *end,
                              bool continue_row,
                              MultiplexGatewayCatalog *catalog) {
  const char *cursor = array + 1;
  while (cursor < end && catalog->row_count < MULTIPLEX_GATEWAY_MAX_ROWS) {
    cursor = skip_space(cursor, end);
    if (cursor < end && *cursor == ']') {
      return true;
    }
    JsonSpan hub;
    const char *next = NULL;
    if (!json_object(cursor, end, &hub, &next)) {
      return false;
    }
    bool matches = false;
    if (hub_kind(hub, continue_row, &matches) && matches) {
      add_hub(hub, catalog);
      if (continue_row && catalog->row_count != 0) {
        return true;
      }
    }
    cursor = next;
  }
  return true;
}

bool multiplex_plex_catalog_parse_hubs(const char *json, size_t size,
                                       MultiplexGatewayCatalog *catalog) {
  if (json == NULL || size == 0 || catalog == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  const char *array = NULL;
  if (!json_value(document, "Hub", &array) || *array != '[') {
    return false;
  }
  catalog->row_count = 0;
  catalog->total_item_count = 0;
  memset(catalog->rows, 0, sizeof(catalog->rows));
  memset(catalog->items, 0, sizeof(catalog->items));
  if (!add_matching_hubs(array, document.end, true, catalog) ||
      !add_matching_hubs(array, document.end, false, catalog) ||
      catalog->row_count == 0) {
    return false;
  }
  catalog->version = 3;
  return true;
}

static uint8_t library_media_type(const char *type) {
  if (strcmp(type, "movie") == 0) {
    return 1;
  }
  if (strcmp(type, "show") == 0) {
    return 2;
  }
  if (strcmp(type, "artist") == 0) {
    return 3;
  }
  if (strcmp(type, "photo") == 0) {
    return 4;
  }
  return 0;
}

bool multiplex_plex_catalog_parse_libraries(const char *json, size_t size,
                                            MultiplexGatewayCatalog *catalog) {
  if (json == NULL || size == 0 || catalog == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  const char *array = NULL;
  if (!json_value(document, "Directory", &array) || *array != '[') {
    return false;
  }
  catalog->library_count = 0;
  memset(catalog->libraries, 0, sizeof(catalog->libraries));
  const char *cursor = array + 1;
  while (cursor < document.end &&
         catalog->library_count < MULTIPLEX_GATEWAY_MAX_LIBRARIES) {
    cursor = skip_space(cursor, document.end);
    if (cursor < document.end && *cursor == ']') {
      break;
    }
    JsonSpan directory;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &directory, &next)) {
      return false;
    }
    uint32_t section_id = 0;
    char type[32];
    MultiplexGatewayLibrary *library =
        &catalog->libraries[catalog->library_count];
    if (json_unsigned(directory, "key", &section_id) &&
        section_id > 0 && section_id <= UINT16_MAX &&
        json_string(directory, "title", library->title,
                    sizeof(library->title)) &&
        json_string(directory, "type", type, sizeof(type))) {
      library->section_id = (uint16_t)section_id;
      library->media_type = library_media_type(type);
      library->title_length = (uint16_t)strlen(library->title);
      if (library->title_length != 0) {
        ++catalog->library_count;
      }
    }
    cursor = next;
  }
  return catalog->library_count != 0;
}

bool multiplex_plex_catalog_parse_browse(
    const char *json, size_t size, const MultiplexGatewayLibrary *library,
    uint16_t start, MultiplexGatewayBrowsePage *page) {
  if (json == NULL || size == 0 || library == NULL ||
      library->section_id == 0 || library->title_length == 0 || page == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  const char *array = NULL;
  if (!json_value(document, "Metadata", &array) || *array != '[') {
    return false;
  }
  memset(page, 0, sizeof(*page));
  page->version = 1;
  page->section_id = library->section_id;
  page->start = start;
  memcpy(page->title, library->title, library->title_length);
  page->title[library->title_length] = '\0';
  page->title_length = library->title_length;

  uint32_t total_size = 0;
  json_unsigned(document, "totalSize", &total_size);
  if (total_size > UINT16_MAX) {
    total_size = UINT16_MAX;
  }
  page->total_size = (uint16_t)total_size;

  const char *cursor = array + 1;
  while (cursor < document.end &&
         page->item_count < MULTIPLEX_GATEWAY_MAX_ITEMS) {
    cursor = skip_space(cursor, document.end);
    if (cursor < document.end && *cursor == ']') {
      break;
    }
    JsonSpan object;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &object, &next)) {
      return false;
    }
    MultiplexGatewayItem *item = &page->items[page->item_count];
    if (parse_item(object, item, page->item_count)) {
      ++page->item_count;
    }
    cursor = next;
  }
  if (page->total_size == 0) {
    page->total_size = (uint16_t)(start + page->item_count);
  }
  return page->item_count != 0;
}

static void capitalize_first(char *value) {
  if (value[0] >= 'a' && value[0] <= 'z') {
    value[0] = (char)(value[0] - 'a' + 'A');
  }
}

static bool json_tag_list(JsonSpan object, const char *key, char *destination,
                          size_t capacity) {
  const char *array = NULL;
  if (capacity == 0) {
    return false;
  }
  destination[0] = '\0';
  if (!json_value(object, key, &array) || *array != '[') {
    return true;
  }
  size_t used = 0;
  const char *cursor = array + 1;
  while (cursor < object.end) {
    cursor = skip_space(cursor, object.end);
    if (cursor < object.end && *cursor == ']') {
      return true;
    }
    JsonSpan tag_object;
    const char *next = NULL;
    if (!json_object(cursor, object.end, &tag_object, &next)) {
      return false;
    }
    char tag[64];
    if (json_string(tag_object, "tag", tag, sizeof(tag)) && tag[0] != '\0') {
      const size_t tag_size = strlen(tag);
      const size_t separator = used == 0 ? 0u : 2u;
      if (used + separator + tag_size >= capacity) {
        return true;
      }
      if (separator != 0) {
        memcpy(destination + used, ", ", separator);
        used += separator;
      }
      memcpy(destination + used, tag, tag_size);
      used += tag_size;
      destination[used] = '\0';
    }
    cursor = next;
  }
  return false;
}

static bool parse_subtitle_streams(JsonSpan metadata,
                                   MultiplexGatewayDetails *details) {
  const char *media_array = NULL;
  if (!json_value(metadata, "Media", &media_array) || *media_array != '[') {
    return true;
  }
  JsonSpan media;
  const char *next = NULL;
  if (!json_object(media_array + 1, metadata.end, &media, &next)) {
    return true;
  }
  const char *part_array = NULL;
  if (!json_value(media, "Part", &part_array) || *part_array != '[') {
    return true;
  }
  JsonSpan part;
  if (!json_object(part_array + 1, media.end, &part, &next)) {
    return true;
  }
  const char *stream_array = NULL;
  if (!json_value(part, "Stream", &stream_array) || *stream_array != '[') {
    return true;
  }

  const char *cursor = stream_array + 1;
  while (cursor < part.end) {
    cursor = skip_space(cursor, part.end);
    if (cursor < part.end && *cursor == ']') {
      return true;
    }
    JsonSpan stream;
    if (!json_object(cursor, part.end, &stream, &next)) {
      return false;
    }
    uint32_t stream_type = 0;
    if (json_unsigned(stream, "streamType", &stream_type) &&
        stream_type == 3u &&
        details->subtitle_stream_count <
            MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS) {
      MultiplexGatewaySubtitleStream *subtitle =
          &details->subtitle_streams[details->subtitle_stream_count];
      memset(subtitle, 0, sizeof(*subtitle));
      if (!json_unsigned(stream, "id", &subtitle->id) || subtitle->id == 0 ||
          !json_string(stream, "codec", subtitle->codec,
                       sizeof(subtitle->codec))) {
        return false;
      }
      subtitle->has_index = json_unsigned(stream, "index", &subtitle->index);
      json_boolean(stream, "selected", &subtitle->selected);
      if (!json_string(stream, "displayTitle", subtitle->label,
                       sizeof(subtitle->label)) &&
          !json_string(stream, "title", subtitle->label,
                       sizeof(subtitle->label)) &&
          !json_string(stream, "language", subtitle->label,
                       sizeof(subtitle->label))) {
        const size_t codec_size = strlen(subtitle->codec);
        memcpy(subtitle->label, subtitle->codec, codec_size + 1u);
      }
      ++details->subtitle_stream_count;
    }
    cursor = next;
  }
  return false;
}

bool multiplex_plex_catalog_parse_details(const char *json, size_t size,
                                          MultiplexGatewayDetails *details) {
  if (json == NULL || size == 0 || details == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  const char *array = NULL;
  if (!json_value(document, "Metadata", &array) || *array != '[') {
    return false;
  }
  JsonSpan object;
  const char *next = NULL;
  if (!json_object(array + 1, document.end, &object, &next)) {
    return false;
  }
  memset(details, 0, sizeof(*details));
  details->version = 1;
  uint32_t year = 0;
  if (!json_unsigned(object, "ratingKey", &details->rating_key) ||
      details->rating_key == 0 ||
      !json_string(object, "title", details->title,
                   sizeof(details->title)) ||
      !json_string(object, "type", details->media_type,
                   sizeof(details->media_type))) {
    return false;
  }
  json_unsigned(object, "parentRatingKey", &details->parent_rating_key);
  json_unsigned(object, "grandparentRatingKey",
                &details->grandparent_rating_key);
  json_unsigned(object, "parentIndex", &details->parent_index);
  json_unsigned(object, "index", &details->index);
  capitalize_first(details->media_type);
  if (!json_string(object, "grandparentTitle", details->secondary,
                   sizeof(details->secondary))) {
    json_string(object, "tagline", details->secondary,
                sizeof(details->secondary));
  }
  json_string(object, "librarySectionTitle", details->library,
              sizeof(details->library));
  json_string(object, "contentRating", details->content_rating,
              sizeof(details->content_rating));
  json_string(object, "summary", details->summary, sizeof(details->summary));
  json_unsigned(object, "duration", &details->duration_ms);
  json_unsigned(object, "viewOffset", &details->view_offset_ms);
  if (json_unsigned(object, "year", &year) && year <= 9999u) {
    details->year = (uint16_t)year;
  }
  json_decimal_tenths(object, "rating", &details->rating_tenths);
  if (!json_tag_list(object, "Genre", details->genres,
                     sizeof(details->genres)) ||
      !json_tag_list(object, "Director", details->directors,
                     sizeof(details->directors)) ||
      !parse_subtitle_streams(object, details)) {
    return false;
  }
  const char *media = NULL;
  if (json_value(object, "Media", &media) && *media == '[' &&
      skip_space(media + 1, object.end) < object.end &&
      *skip_space(media + 1, object.end) != ']') {
    details->flags |= 1u;
  }
  details->title_length = (uint16_t)strlen(details->title);
  details->secondary_length = (uint16_t)strlen(details->secondary);
  details->media_type_length = (uint16_t)strlen(details->media_type);
  details->library_length = (uint16_t)strlen(details->library);
  details->content_rating_length =
      (uint16_t)strlen(details->content_rating);
  details->summary_length = (uint16_t)strlen(details->summary);
  details->genres_length = (uint16_t)strlen(details->genres);
  details->directors_length = (uint16_t)strlen(details->directors);
  return details->title_length != 0 && details->media_type_length != 0;
}

bool multiplex_plex_catalog_parse_children(
    const char *json, size_t size, uint16_t start,
    MultiplexGatewayChildrenPage *page) {
  if (json == NULL || size == 0 || page == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  const char *array = NULL;
  if (!json_value(document, "Metadata", &array) || *array != '[') {
    return false;
  }
  memset(page, 0, sizeof(*page));
  page->version = 1;
  page->start = start;
  uint32_t total_size = 0;
  json_unsigned(document, "totalSize", &total_size);
  if (total_size > UINT16_MAX) {
    total_size = UINT16_MAX;
  }
  page->total_size = (uint16_t)total_size;

  const char *cursor = array + 1;
  while (cursor < document.end &&
         page->item_count < MULTIPLEX_GATEWAY_MAX_ITEMS) {
    cursor = skip_space(cursor, document.end);
    if (cursor < document.end && *cursor == ']') {
      break;
    }
    JsonSpan object;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &object, &next)) {
      return false;
    }
    MultiplexGatewayItem *item = &page->items[page->item_count];
    memset(item, 0, sizeof(*item));
    if (parse_child(object, item, page->item_count)) {
      ++page->item_count;
    }
    cursor = next;
  }
  if (page->total_size == 0) {
    page->total_size = (uint16_t)(start + page->item_count);
  }
  return true;
}

bool multiplex_plex_catalog_parse_search(
    const char *json, size_t size, const char *query, uint16_t query_length,
    MultiplexGatewaySearchPage *page) {
  if (json == NULL || size == 0 || query == NULL || query_length == 0 ||
      query_length >= MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY ||
      page == NULL) {
    return false;
  }
  JsonSpan document = {.begin = json, .end = json + size};
  memset(page, 0, sizeof(*page));
  page->version = 1;
  memcpy(page->query, query, query_length);
  page->query[query_length] = '\0';
  page->query_length = query_length;

  const char *array = NULL;
  if (!json_value(document, "SearchResult", &array)) {
    uint32_t result_size = 0;
    return json_unsigned(document, "size", &result_size) && result_size == 0;
  }
  if (*array != '[') {
    return false;
  }
  const char *cursor = array + 1;
  while (cursor < document.end &&
         page->item_count < MULTIPLEX_GATEWAY_MAX_ITEMS) {
    cursor = skip_space(cursor, document.end);
    if (cursor < document.end && *cursor == ']') {
      return true;
    }
    JsonSpan result;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &result, &next)) {
      return false;
    }
    const char *metadata_value = NULL;
    JsonSpan metadata;
    const char *metadata_next = NULL;
    if (json_value(result, "Metadata", &metadata_value) &&
        json_object(metadata_value, result.end, &metadata, &metadata_next)) {
      MultiplexGatewayItem *item = &page->items[page->item_count];
      if (parse_item(metadata, item, page->item_count)) {
        ++page->item_count;
      }
    }
    cursor = next;
  }
  return true;
}

static bool request_plex_json(const MultiplexAuthCredentials *credentials,
                              const char *path, char *destination,
                              size_t capacity, size_t *body_size) {
  const size_t base_size = strlen(credentials->plex_server_url);
  const int url_size =
      snprintf(destination, PLEX_CATALOG_URL_CAPACITY, "%s%s%s",
               credentials->plex_server_url,
               base_size != 0 &&
                       credentials->plex_server_url[base_size - 1u] == '/'
                   ? ""
                   : "/",
               path);
  if (url_size <= 0 || (size_t)url_size >= PLEX_CATALOG_URL_CAPACITY) {
    return false;
  }
  char url[PLEX_CATALOG_URL_CAPACITY];
  memcpy(url, destination, (size_t)url_size + 1u);
  const HttpRequestHeader headers[] = {
      {.name = "X-Plex-Token", .value = credentials->plex_server_token},
      {.name = "X-Plex-Product", .value = "Multiplex"},
      {.name = "X-Plex-Version", .value = "0.1.0"},
      {.name = "X-Plex-Platform", .value = "GameCube"},
      {.name = "X-Plex-Client-Identifier",
       .value = credentials->plex_client_id},
  };
  for (unsigned attempt = 1; attempt <= PLEX_REQUEST_ATTEMPTS; ++attempt) {
    HttpJsonResponse response;
    if (http_client_request_with_headers(
            "GET", url, headers, sizeof(headers) / sizeof(headers[0]), NULL,
            destination, capacity, &response) &&
        response.status == 200) {
      *body_size = response.body_size;
      return true;
    }
    if (attempt != PLEX_REQUEST_ATTEMPTS) {
      SYS_Report("REFERENCE GX: direct Plex request retry attempt=%u/%u\n",
                 attempt + 1u, PLEX_REQUEST_ATTEMPTS);
    }
  }
  return false;
}

bool multiplex_plex_load_catalog(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayCatalog *catalog) {
  if (credentials == NULL || catalog == NULL ||
      credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0') {
    return false;
  }
  memset(catalog, 0, sizeof(*catalog));
  const size_t server_name_size = strlen(credentials->plex_server_name);
  if (server_name_size == 0 ||
      server_name_size >= sizeof(catalog->server_name)) {
    return false;
  }
  strcpy(catalog->server_name, credentials->plex_server_name);
  catalog->server_name_length = (uint16_t)server_name_size;

  char *response = malloc(PLEX_HUB_RESPONSE_CAPACITY);
  size_t response_size = 0;
  const bool hubs_loaded =
      response != NULL &&
      request_plex_json(credentials,
                        "hubs?onlyTransient=1&count=8&"
                        PLEX_COMPACT_ITEMS_QUERY,
                        response, PLEX_HUB_RESPONSE_CAPACITY,
                        &response_size) &&
      multiplex_plex_catalog_parse_hubs(response, response_size, catalog);
  free(response);
  if (!hubs_loaded) {
    SYS_Report("REFERENCE GX: direct Plex home catalog unavailable\n");
    return false;
  }

  char libraries[PLEX_LIBRARY_RESPONSE_CAPACITY];
  const bool libraries_loaded =
      request_plex_json(credentials, "library/sections", libraries,
                        sizeof(libraries), &response_size) &&
      multiplex_plex_catalog_parse_libraries(libraries, response_size,
                                             catalog);
  if (!libraries_loaded) {
    SYS_Report("REFERENCE GX: direct Plex libraries unavailable\n");
    return false;
  }
  SYS_Report(
      "REFERENCE GX: direct Plex catalog rows=%u items=%u libraries=%u\n",
      catalog->row_count, catalog->total_item_count, catalog->library_count);
  return true;
}

bool multiplex_plex_load_browse(
    const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayLibrary *library, uint16_t start,
    MultiplexGatewayBrowsePage *page) {
  if (credentials == NULL || library == NULL || library->section_id == 0 ||
      page == NULL) {
    return false;
  }
  char path[640];
  const int path_size = snprintf(
      path, sizeof(path),
      "library/sections/%u/all?sort=addedAt%%3Adesc&"
      "X-Plex-Container-Start=%u&X-Plex-Container-Size=%u&"
      PLEX_COMPACT_ITEMS_QUERY,
      library->section_id, start, MULTIPLEX_GATEWAY_MAX_ITEMS);
  if (path_size <= 0 || (size_t)path_size >= sizeof(path)) {
    return false;
  }
  char *response = malloc(PLEX_BROWSE_RESPONSE_CAPACITY);
  size_t response_size = 0;
  const bool loaded =
      response != NULL &&
      request_plex_json(credentials, path, response,
                        PLEX_BROWSE_RESPONSE_CAPACITY, &response_size) &&
      multiplex_plex_catalog_parse_browse(response, response_size, library,
                                          start, page);
  free(response);
  if (loaded) {
    SYS_Report(
        "REFERENCE GX: direct Plex browse section=%u start=%u items=%u/%u\n",
        library->section_id, start, page->item_count, page->total_size);
  }
  return loaded;
}

bool multiplex_plex_load_details(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayDetails *details) {
  if (credentials == NULL || rating_key == 0 || details == NULL) {
    return false;
  }
  char path[96];
  const int path_size =
      snprintf(path, sizeof(path), "library/metadata/%u", rating_key);
  if (path_size <= 0 || (size_t)path_size >= sizeof(path)) {
    return false;
  }
  char *response = malloc(PLEX_DETAILS_RESPONSE_CAPACITY);
  size_t response_size = 0;
  const bool loaded =
      response != NULL &&
      request_plex_json(credentials, path, response,
                        PLEX_DETAILS_RESPONSE_CAPACITY, &response_size) &&
      multiplex_plex_catalog_parse_details(response, response_size, details) &&
      details->rating_key == rating_key;
  free(response);
  if (loaded) {
    SYS_Report("REFERENCE GX: direct Plex details rating-key=%u\n",
               rating_key);
  }
  return loaded;
}

bool multiplex_plex_load_children(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    uint16_t start, MultiplexGatewayChildrenPage *page) {
  if (credentials == NULL || rating_key == 0 || page == NULL ||
      credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0') {
    return false;
  }
  char path[640];
  const int path_size = snprintf(
      path, sizeof(path),
      "library/metadata/%u/children?X-Plex-Container-Start=%u&"
      "X-Plex-Container-Size=%u&" PLEX_COMPACT_ITEMS_QUERY,
      rating_key, start, MULTIPLEX_GATEWAY_MAX_ITEMS);
  if (path_size <= 0 || (size_t)path_size >= sizeof(path)) {
    return false;
  }
  char *response = malloc(PLEX_DETAILS_RESPONSE_CAPACITY);
  size_t response_size = 0;
  const bool loaded =
      response != NULL &&
      request_plex_json(credentials, path, response,
                        PLEX_DETAILS_RESPONSE_CAPACITY, &response_size) &&
      multiplex_plex_catalog_parse_children(response, response_size, start,
                                             page);
  free(response);
  if (loaded) {
    SYS_Report("REFERENCE GX: direct Plex children rating-key=%u start=%u "
               "items=%u total=%u\n",
               rating_key, start, page->item_count, page->total_size);
  }
  return loaded;
}

static MultiplexPlexNextEpisodeResult find_next_child(
    const MultiplexAuthCredentials *credentials, uint32_t parent_rating_key,
    uint32_t current_rating_key, MultiplexGatewayItem *next) {
  uint32_t start = 0;
  bool found_current = false;
  for (;;) {
    if (start > UINT16_MAX) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    MultiplexGatewayChildrenPage page;
    if (!multiplex_plex_load_children(credentials, parent_rating_key,
                                      (uint16_t)start, &page)) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    for (uint16_t index = 0; index < page.item_count; ++index) {
      if (found_current) {
        *next = page.items[index];
        return MULTIPLEX_PLEX_NEXT_EPISODE_FOUND;
      }
      if (page.items[index].rating_key == current_rating_key) {
        found_current = true;
      }
    }
    const uint32_t following_start = start + page.item_count;
    if (page.item_count == 0 || following_start >= page.total_size) {
      return found_current ? MULTIPLEX_PLEX_NEXT_EPISODE_NONE
                           : MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    start = following_start;
  }
}

static MultiplexPlexNextEpisodeResult find_next_season_episode(
    const MultiplexAuthCredentials *credentials, uint32_t show_rating_key,
    uint32_t current_season_rating_key, MultiplexGatewayItem *next) {
  uint32_t start = 0;
  bool found_current_season = false;
  for (;;) {
    if (start > UINT16_MAX) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    MultiplexGatewayChildrenPage seasons;
    if (!multiplex_plex_load_children(credentials, show_rating_key,
                                      (uint16_t)start, &seasons)) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    for (uint16_t index = 0; index < seasons.item_count; ++index) {
      const uint32_t season_rating_key = seasons.items[index].rating_key;
      if (!found_current_season) {
        found_current_season = season_rating_key == current_season_rating_key;
        continue;
      }
      MultiplexGatewayChildrenPage episodes;
      if (!multiplex_plex_load_children(credentials, season_rating_key, 0,
                                        &episodes)) {
        return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
      }
      if (episodes.item_count != 0) {
        *next = episodes.items[0];
        return MULTIPLEX_PLEX_NEXT_EPISODE_FOUND;
      }
    }
    const uint32_t following_start = start + seasons.item_count;
    if (seasons.item_count == 0 || following_start >= seasons.total_size) {
      return found_current_season ? MULTIPLEX_PLEX_NEXT_EPISODE_NONE
                                  : MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    start = following_start;
  }
}

MultiplexPlexNextEpisodeResult multiplex_plex_load_next_episode(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayItem *episode) {
  if (credentials == NULL || rating_key == 0 || episode == NULL) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
  }
  MultiplexGatewayDetails current;
  if (!multiplex_plex_load_details(credentials, rating_key, &current)) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
  }
  if (strcmp(current.media_type, "Episode") != 0 ||
      current.parent_rating_key == 0) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_NONE;
  }
  const MultiplexPlexNextEpisodeResult sibling = find_next_child(
      credentials, current.parent_rating_key, rating_key, episode);
  if (sibling != MULTIPLEX_PLEX_NEXT_EPISODE_NONE ||
      current.grandparent_rating_key == 0) {
    return sibling;
  }
  return find_next_season_episode(credentials, current.grandparent_rating_key,
                                  current.parent_rating_key, episode);
}

static MultiplexPlexNextEpisodeResult find_previous_child(
    const MultiplexAuthCredentials *credentials, uint32_t parent_rating_key,
    uint32_t current_rating_key, MultiplexGatewayItem *previous) {
  uint32_t start = 0;
  bool have_previous = false;
  for (;;) {
    if (start > UINT16_MAX) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    MultiplexGatewayChildrenPage page;
    if (!multiplex_plex_load_children(credentials, parent_rating_key,
                                      (uint16_t)start, &page)) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    for (uint16_t index = 0; index < page.item_count; ++index) {
      if (page.items[index].rating_key == current_rating_key) {
        return have_previous ? MULTIPLEX_PLEX_NEXT_EPISODE_FOUND
                             : MULTIPLEX_PLEX_NEXT_EPISODE_NONE;
      }
      *previous = page.items[index];
      have_previous = true;
    }
    const uint32_t following_start = start + page.item_count;
    if (page.item_count == 0 || following_start >= page.total_size) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    start = following_start;
  }
}

static MultiplexPlexNextEpisodeResult find_last_season_episode(
    const MultiplexAuthCredentials *credentials, uint32_t show_rating_key,
    uint32_t current_season_rating_key, MultiplexGatewayItem *previous) {
  uint32_t start = 0;
  uint32_t previous_season_rating_key = 0;
  for (;;) {
    if (start > UINT16_MAX) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    MultiplexGatewayChildrenPage seasons;
    if (!multiplex_plex_load_children(credentials, show_rating_key,
                                      (uint16_t)start, &seasons)) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    for (uint16_t index = 0; index < seasons.item_count; ++index) {
      const uint32_t season_rating_key = seasons.items[index].rating_key;
      if (season_rating_key == current_season_rating_key) {
        if (previous_season_rating_key == 0) {
          return MULTIPLEX_PLEX_NEXT_EPISODE_NONE;
        }
        uint32_t episode_start = 0;
        bool found_episode = false;
        for (;;) {
          if (episode_start > UINT16_MAX) {
            return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
          }
          MultiplexGatewayChildrenPage episodes;
          if (!multiplex_plex_load_children(
                  credentials, previous_season_rating_key,
                  (uint16_t)episode_start, &episodes)) {
            return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
          }
          for (uint16_t episode_index = 0;
               episode_index < episodes.item_count; ++episode_index) {
            *previous = episodes.items[episode_index];
            found_episode = true;
          }
          const uint32_t following_episode =
              episode_start + episodes.item_count;
          if (episodes.item_count == 0 ||
              following_episode >= episodes.total_size) {
            return found_episode ? MULTIPLEX_PLEX_NEXT_EPISODE_FOUND
                                 : MULTIPLEX_PLEX_NEXT_EPISODE_NONE;
          }
          episode_start = following_episode;
        }
      }
      previous_season_rating_key = season_rating_key;
    }
    const uint32_t following_start = start + seasons.item_count;
    if (seasons.item_count == 0 || following_start >= seasons.total_size) {
      return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
    }
    start = following_start;
  }
}

MultiplexPlexNextEpisodeResult multiplex_plex_load_previous_episode(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayItem *episode) {
  if (credentials == NULL || rating_key == 0 || episode == NULL) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
  }
  MultiplexGatewayDetails current;
  if (!multiplex_plex_load_details(credentials, rating_key, &current)) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_ERROR;
  }
  if (strcmp(current.media_type, "Episode") != 0 ||
      current.parent_rating_key == 0) {
    return MULTIPLEX_PLEX_NEXT_EPISODE_NONE;
  }
  const MultiplexPlexNextEpisodeResult sibling = find_previous_child(
      credentials, current.parent_rating_key, rating_key, episode);
  if (sibling != MULTIPLEX_PLEX_NEXT_EPISODE_NONE ||
      current.grandparent_rating_key == 0) {
    return sibling;
  }
  return find_last_season_episode(credentials, current.grandparent_rating_key,
                                  current.parent_rating_key, episode);
}

static bool encode_url_value(const char *value, char *destination,
                             size_t capacity) {
  static const char hex[] = "0123456789ABCDEF";
  size_t output = 0;
  for (const uint8_t *cursor = (const uint8_t *)value; *cursor != 0;
       ++cursor) {
    const bool unreserved =
        (*cursor >= 'A' && *cursor <= 'Z') ||
        (*cursor >= 'a' && *cursor <= 'z') ||
        (*cursor >= '0' && *cursor <= '9') || *cursor == '-' ||
        *cursor == '_' || *cursor == '.' || *cursor == '~';
    const size_t required = unreserved ? 1u : 3u;
    if (output + required >= capacity) {
      return false;
    }
    if (unreserved) {
      destination[output++] = (char)*cursor;
    } else {
      destination[output++] = '%';
      destination[output++] = hex[*cursor >> 4u];
      destination[output++] = hex[*cursor & 15u];
    }
  }
  destination[output] = '\0';
  return true;
}

bool multiplex_plex_load_search(
    const MultiplexAuthCredentials *credentials, const char *query,
    uint16_t query_length, MultiplexGatewaySearchPage *page) {
  if (credentials == NULL || query == NULL || query_length == 0 ||
      query_length >= MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY ||
      page == NULL) {
    return false;
  }
  char query_copy[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
  memcpy(query_copy, query, query_length);
  query_copy[query_length] = '\0';
  char encoded_query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY * 3u];
  if (!encode_url_value(query_copy, encoded_query, sizeof(encoded_query))) {
    return false;
  }
  char path[640];
  const int path_size = snprintf(
      path, sizeof(path),
      "library/search?query=%s&limit=%u&searchTypes=movies%%2Ctv&"
      "includeCollections=0&includeExternalMedia=0&"
      PLEX_COMPACT_ITEMS_QUERY,
      encoded_query, MULTIPLEX_GATEWAY_MAX_ITEMS);
  if (path_size <= 0 || (size_t)path_size >= sizeof(path)) {
    return false;
  }
  char *response = malloc(PLEX_SEARCH_RESPONSE_CAPACITY);
  size_t response_size = 0;
  const bool loaded =
      response != NULL &&
      request_plex_json(credentials, path, response,
                        PLEX_SEARCH_RESPONSE_CAPACITY, &response_size) &&
      multiplex_plex_catalog_parse_search(
          response, response_size, query_copy, query_length, page);
  free(response);
  if (loaded) {
    SYS_Report("REFERENCE GX: direct Plex search query=%s items=%u\n",
               query_copy, page->item_count);
  }
  return loaded;
}

bool multiplex_plex_load_artwork(
    const MultiplexAuthCredentials *credentials, const char *artwork_path,
    uint8_t *destination, size_t capacity, size_t *encoded_size) {
  if (credentials == NULL || credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0' || artwork_path == NULL ||
      artwork_path[0] != '/' || destination == NULL || capacity == 0 ||
      encoded_size == NULL) {
    return false;
  }
  char encoded_path[MULTIPLEX_GATEWAY_ARTWORK_PATH_CAPACITY * 3u];
  if (!encode_url_value(artwork_path, encoded_path, sizeof(encoded_path))) {
    return false;
  }
  const size_t base_size = strlen(credentials->plex_server_url);
  char url[PLEX_CATALOG_URL_CAPACITY];
  const int url_size =
      snprintf(url, sizeof(url),
               "%s%sphoto/:/transcode?width=%u&height=%u&minSize=1&upscale=1&"
               "url=%s",
               credentials->plex_server_url,
               base_size != 0 &&
                       credentials->plex_server_url[base_size - 1u] == '/'
                   ? ""
                   : "/",
               MULTIPLEX_GATEWAY_ARTWORK_WIDTH,
               MULTIPLEX_GATEWAY_ARTWORK_HEIGHT, encoded_path);
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }
  const HttpRequestHeader headers[] = {
      {.name = "X-Plex-Token", .value = credentials->plex_server_token},
      {.name = "X-Plex-Product", .value = "Multiplex"},
      {.name = "X-Plex-Version", .value = "0.1.0"},
      {.name = "X-Plex-Platform", .value = "GameCube"},
      {.name = "X-Plex-Client-Identifier",
       .value = credentials->plex_client_id},
  };
  HttpClient *client = http_client_open_with_headers(
      url, headers, sizeof(headers) / sizeof(headers[0]));
  if (client == NULL) {
    return false;
  }
  const size_t size = http_client_size(client);
  const bool loaded =
      size != 0 && size <= capacity &&
      http_client_read_at(client, 0, destination, size);
  http_client_destroy(client);
  if (loaded) {
    *encoded_size = size;
  }
  return loaded;
}

bool multiplex_plex_report_timeline(
    const MultiplexAuthCredentials *credentials, const char *session_id,
    uint32_t rating_key, uint32_t position_ms, uint32_t duration_ms,
    const char *state) {
  if (credentials == NULL || credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0' ||
      credentials->plex_client_id[0] == '\0' || session_id == NULL ||
      session_id[0] == '\0' || rating_key == 0 || duration_ms == 0 ||
      state == NULL ||
      (strcmp(state, "playing") != 0 && strcmp(state, "paused") != 0 &&
       strcmp(state, "stopped") != 0)) {
    return false;
  }
  const size_t base_size = strlen(credentials->plex_server_url);
  char url[PLEX_CATALOG_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url),
      "%s%s:/timeline?ratingKey=%u&key=%%2Flibrary%%2Fmetadata%%2F%u&"
      "playbackTime=%u&time=%u&duration=%u&state=%s&hasMDE=1&"
      "X-Plex-Playback-Session-Id=%s",
      credentials->plex_server_url,
      base_size != 0 &&
              credentials->plex_server_url[base_size - 1u] == '/'
          ? ""
          : "/",
      rating_key, rating_key, position_ms, position_ms, duration_ms, state,
      session_id);
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }
  const HttpRequestHeader headers[] = {
      {.name = "Accept", .value = "application/xml"},
      {.name = "X-Plex-Token", .value = credentials->plex_server_token},
      {.name = "X-Plex-Product", .value = "Multiplex"},
      {.name = "X-Plex-Version", .value = "0.1.0"},
      {.name = "X-Plex-Platform", .value = "GameCube"},
      {.name = "X-Plex-Device", .value = "GameCube"},
      {.name = "X-Plex-Device-Name", .value = "Multiplex GameCube"},
      {.name = "X-Plex-Language", .value = "en"},
      {.name = "X-Plex-Client-Identifier",
       .value = credentials->plex_client_id},
  };
  char response_body[512];
  HttpJsonResponse response;
  const bool reported = http_client_request_with_headers(
                            "GET", url, headers,
                            sizeof(headers) / sizeof(headers[0]), NULL,
                            response_body, sizeof(response_body), &response) &&
                        response.status == 200;
  SYS_Report(
      "REFERENCE GX: direct Plex timeline rating-key=%u position=%u state=%s "
      "reported=%u\n",
      rating_key, position_ms, state, reported ? 1u : 0u);
  return reported;
}

bool multiplex_plex_mark_watched(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key) {
  if (credentials == NULL || credentials->plex_server_url[0] == '\0' ||
      credentials->plex_server_token[0] == '\0' ||
      credentials->plex_client_id[0] == '\0' || rating_key == 0) {
    return false;
  }
  const size_t base_size = strlen(credentials->plex_server_url);
  char url[PLEX_CATALOG_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url),
      "%s%s:/scrobble?key=%u&identifier=com.plexapp.plugins.library",
      credentials->plex_server_url,
      base_size != 0 && credentials->plex_server_url[base_size - 1u] == '/'
          ? ""
          : "/",
      rating_key);
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }
  const HttpRequestHeader headers[] = {
      {.name = "Accept", .value = "application/xml"},
      {.name = "X-Plex-Token", .value = credentials->plex_server_token},
      {.name = "X-Plex-Product", .value = "Multiplex"},
      {.name = "X-Plex-Version", .value = "0.1.0"},
      {.name = "X-Plex-Platform", .value = "GameCube"},
      {.name = "X-Plex-Client-Identifier",
       .value = credentials->plex_client_id},
  };
  char response_body[256];
  HttpJsonResponse response;
  const bool marked = http_client_request_with_headers(
                          "GET", url, headers,
                          sizeof(headers) / sizeof(headers[0]), NULL,
                          response_body, sizeof(response_body), &response) &&
                      response.status == 200;
  SYS_Report("REFERENCE GX: direct Plex scrobble rating-key=%u marked=%u\n",
             rating_key, marked ? 1u : 0u);
  return marked;
}
