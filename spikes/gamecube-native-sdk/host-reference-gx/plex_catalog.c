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
#define PLEX_CATALOG_URL_CAPACITY 768u

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

static bool parse_hub_items(JsonSpan hub, MultiplexGatewayCatalog *catalog,
                            MultiplexGatewayRow *row) {
  const char *array = NULL;
  if (!metadata_array(hub, &array)) {
    return false;
  }
  row->item_offset = catalog->total_item_count;
  const char *cursor = array + 1;
  while (cursor < hub.end &&
         row->item_count < MULTIPLEX_GATEWAY_MAX_ITEMS) {
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
  HttpJsonResponse response;
  if (!http_client_request_with_headers(
          "GET", url, headers, sizeof(headers) / sizeof(headers[0]), NULL,
          destination, capacity, &response) ||
      response.status != 200) {
    return false;
  }
  *body_size = response.body_size;
  return true;
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
      request_plex_json(credentials, "hubs?onlyTransient=1&count=4", response,
                        PLEX_HUB_RESPONSE_CAPACITY, &response_size) &&
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
