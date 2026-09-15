#include "gateway_catalog.h"

#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define CATALOG_RESPONSE_CAPACITY (24u * 1024u)
#define CATALOG_URL_CAPACITY 768u
#define SERVER_ID_CAPACITY 129u

typedef struct {
  const char *begin;
  const char *end;
} JsonSpan;

static const char *skip_space(const char *cursor, const char *end) {
  while (cursor < end && (*cursor == ' ' || *cursor == '\t' ||
                          *cursor == '\r' || *cursor == '\n')) {
    ++cursor;
  }
  return cursor;
}

static const char *find_bytes(JsonSpan span, const char *value) {
  const size_t size = strlen(value);
  for (const char *cursor = span.begin; size != 0 && cursor + size <= span.end;
       ++cursor) {
    if (memcmp(cursor, value, size) == 0) {
      return cursor;
    }
  }
  return NULL;
}

static bool json_value(JsonSpan span, const char *key, const char **value) {
  char pattern[80];
  const int size = snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  if (size <= 0 || (size_t)size >= sizeof(pattern)) {
    return false;
  }
  const char *cursor = find_bytes(span, pattern);
  if (cursor == NULL) {
    return false;
  }
  cursor = skip_space(cursor + size, span.end);
  if (cursor == span.end || *cursor++ != ':') {
    return false;
  }
  *value = skip_space(cursor, span.end);
  return *value < span.end;
}

static bool json_string(JsonSpan span, const char *key, char *destination,
                        size_t capacity) {
  const char *cursor = NULL;
  if (capacity == 0 || !json_value(span, key, &cursor) || *cursor++ != '"') {
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
      if (value == 'b') {
        value = '\b';
      } else if (value == 'f') {
        value = '\f';
      } else if (value == 'n') {
        value = '\n';
      } else if (value == 'r') {
        value = '\r';
      } else if (value == 't') {
        value = '\t';
      } else if (value != '"' && value != '\\' && value != '/') {
        return false;
      }
    }
    if (value < 0x20 || output + 1u >= capacity) {
      return false;
    }
    destination[output++] = (char)value;
  }
  if (cursor == span.end || *cursor != '"') {
    return false;
  }
  destination[output] = '\0';
  return output != 0;
}

static bool json_unsigned(JsonSpan span, const char *key,
                          uint32_t *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor) || cursor == span.end || *cursor < '0' ||
      *cursor > '9') {
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
    } else if (value == '"') {
      quoted = true;
    } else if (value == '{') {
      ++depth;
    } else if (value == '}' && --depth == 0) {
      *object = (JsonSpan){.begin = begin, .end = cursor};
      *next = cursor;
      return true;
    }
  }
  return false;
}

static bool build_url(const char *base_url, const char *path, char *url,
                      size_t capacity) {
  const size_t base_size = strlen(base_url);
  const int written = snprintf(
      url, capacity, "%s%s%s", base_url,
      base_size != 0 && base_url[base_size - 1u] == '/' ? "" : "/", path);
  return written > 0 && (size_t)written < capacity;
}

static bool parse_server(const char *json, char *server_id, char *server_name) {
  const JsonSpan document = {.begin = json, .end = json + strlen(json)};
  const char *array = NULL;
  JsonSpan server;
  const char *next = NULL;
  return json_value(document, "servers", &array) && *array == '[' &&
         json_object(array + 1, document.end, &server, &next) &&
         json_string(server, "id", server_id, SERVER_ID_CAPACITY) &&
         json_string(server, "name", server_name,
                     MULTIPLEX_XBOX_CATALOG_SERVER_CAPACITY);
}

static bool parse_item(JsonSpan object, MultiplexXboxCatalogItem *item) {
  memset(item, 0, sizeof(*item));
  if (!json_unsigned(object, "ratingKey", &item->rating_key) ||
      item->rating_key == 0 ||
      !json_string(object, "title", item->title, sizeof(item->title)) ||
      !json_string(object, "subtitle", item->subtitle,
                   sizeof(item->subtitle))) {
    return false;
  }
  json_unsigned(object, "durationMs", &item->duration_ms);
  json_unsigned(object, "viewOffsetMs", &item->view_offset_ms);
  return true;
}

static bool parse_row(JsonSpan object, MultiplexXboxCatalogRow *row) {
  memset(row, 0, sizeof(*row));
  const char *array = NULL;
  if (!json_string(object, "title", row->title, sizeof(row->title)) ||
      !json_value(object, "items", &array) || *array != '[') {
    return false;
  }
  const char *cursor = array + 1;
  while (row->item_count < MULTIPLEX_XBOX_CATALOG_MAX_ITEMS) {
    cursor = skip_space(cursor, object.end);
    if (cursor == object.end || *cursor == ']') {
      break;
    }
    JsonSpan item;
    const char *next = NULL;
    if (!json_object(cursor, object.end, &item, &next) ||
        !parse_item(item, &row->items[row->item_count])) {
      return false;
    }
    ++row->item_count;
    cursor = next;
  }
  return row->item_count != 0;
}

static bool parse_home(const char *json, MultiplexXboxCatalog *catalog) {
  const JsonSpan document = {.begin = json, .end = json + strlen(json)};
  const char *array = NULL;
  if (!json_value(document, "rows", &array) || *array != '[') {
    return false;
  }
  const char *cursor = array + 1;
  while (catalog->row_count < MULTIPLEX_XBOX_CATALOG_MAX_ROWS) {
    cursor = skip_space(cursor, document.end);
    if (cursor == document.end || *cursor == ']') {
      break;
    }
    JsonSpan row;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &row, &next) ||
        !parse_row(row, &catalog->rows[catalog->row_count])) {
      return false;
    }
    ++catalog->row_count;
    cursor = next;
  }
  return catalog->row_count != 0;
}

bool multiplex_xbox_catalog_load(const char *base_url,
                                 const char *session_token,
                                 MultiplexXboxHttpRequest request,
                                 void *request_context,
                                 MultiplexXboxCatalog *catalog) {
  if (base_url == NULL || base_url[0] == '\0' || session_token == NULL ||
      session_token[0] == '\0' || request == NULL || catalog == NULL) {
    return false;
  }
  memset(catalog, 0, sizeof(*catalog));
  char url[CATALOG_URL_CAPACITY];
  char response[CATALOG_RESPONSE_CAPACITY];
  char server_id[SERVER_ID_CAPACITY];
  unsigned status = 0;
  if (!build_url(base_url, "api/console/plex/servers", url, sizeof(url)) ||
      !request(request_context, "GET", url, session_token, NULL, response,
               sizeof(response), &status) ||
      status != 200 ||
      !parse_server(response, server_id, catalog->server_name)) {
    return false;
  }
  const int path_size = snprintf(
      url, sizeof(url), "%s%sapi/console/plex/home?serverId=%s", base_url,
      base_url[strlen(base_url) - 1u] == '/' ? "" : "/", server_id);
  return path_size > 0 && (size_t)path_size < sizeof(url) &&
         request(request_context, "GET", url, session_token, NULL, response,
                 sizeof(response), &status) &&
         status == 200 && parse_home(response, catalog);
}
