#include "trpc_client.h"

#include <limits.h>
#include <string.h>

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
  char pattern[64];
  const size_t key_size = strlen(key);
  if (key_size + 3u > sizeof(pattern)) {
    return false;
  }
  pattern[0] = '"';
  memcpy(pattern + 1, key, key_size);
  pattern[key_size + 1u] = '"';
  pattern[key_size + 2u] = '\0';
  const char *cursor = find_bytes(span, pattern);
  if (cursor == NULL) {
    return false;
  }
  cursor = skip_space(cursor + key_size + 2u, span.end);
  if (cursor == span.end || *cursor++ != ':') {
    return false;
  }
  *value = skip_space(cursor, span.end);
  return *value < span.end;
}

static bool json_container(const char *cursor, const char *end, char opening,
                           char closing, JsonSpan *container,
                           const char **next) {
  cursor = skip_space(cursor, end);
  if (cursor == end || *cursor != opening) {
    return false;
  }
  const char *begin = cursor++;
  unsigned depth = 1;
  bool in_string = false;
  bool escaped = false;
  while (cursor < end) {
    const char value = *cursor++;
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (value == '\\') {
        escaped = true;
      } else if (value == '"') {
        in_string = false;
      }
      continue;
    }
    if (value == '"') {
      in_string = true;
    } else if (value == opening) {
      ++depth;
    } else if (value == closing && --depth == 0) {
      container->begin = begin;
      container->end = cursor;
      *next = cursor;
      return true;
    }
  }
  return false;
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
        /* JSON's direct single-character escapes. */
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
    if (value < 0x20 || output + 1u >= capacity) {
      return false;
    }
    destination[output++] = (char)value;
  }
  if (cursor == span.end || *cursor != '"' || output == 0) {
    return false;
  }
  destination[output] = '\0';
  return true;
}

static bool json_unsigned(JsonSpan span, const char *key,
                          uint32_t *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor) || *cursor < '0' || *cursor > '9') {
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

static bool json_array(JsonSpan span, const char *key, JsonSpan *array) {
  const char *value = NULL;
  const char *next = NULL;
  return json_value(span, key, &value) &&
         json_container(value, span.end, '[', ']', array, &next);
}

static bool count_array_objects(JsonSpan array, uint8_t *count) {
  const char *cursor = array.begin + 1;
  unsigned objects = 0;
  while (cursor < array.end) {
    cursor = skip_space(cursor, array.end);
    if (cursor == array.end || *cursor == ']') {
      *count = objects > UINT8_MAX ? UINT8_MAX : (uint8_t)objects;
      return true;
    }
    JsonSpan object;
    const char *next = NULL;
    if (!json_container(cursor, array.end, '{', '}', &object, &next)) {
      return false;
    }
    ++objects;
    cursor = skip_space(next, array.end);
    if (cursor < array.end && *cursor == ',') {
      ++cursor;
    }
  }
  return false;
}

static bool parse_room(JsonSpan room, MultiplexTrpcRoom *parsed) {
  uint32_t port = 0;
  JsonSpan users;
  memset(parsed, 0, sizeof(*parsed));
  if (!json_string(room, "id", parsed->id, sizeof(parsed->id)) ||
      !json_string(room, "title", parsed->title, sizeof(parsed->title)) ||
      !json_string(room, "sourceUri", parsed->source_uri,
                   sizeof(parsed->source_uri)) ||
      !json_string(room, "syncplayHost", parsed->syncplay_host,
                   sizeof(parsed->syncplay_host)) ||
      !json_unsigned(room, "syncplayPort", &port) || port > UINT16_MAX ||
      !json_array(room, "users", &users) ||
      !count_array_objects(users, &parsed->user_count)) {
    memset(parsed, 0, sizeof(*parsed));
    return false;
  }
  parsed->syncplay_port = (uint16_t)port;
  return true;
}

bool multiplex_trpc_parse_watch_together_rooms(const char *json, size_t size,
                                                MultiplexTrpcRoomList *list) {
  if (json == NULL || size == 0 || list == NULL) {
    return false;
  }
  memset(list, 0, sizeof(*list));
  const JsonSpan document = {.begin = json, .end = json + size};
  JsonSpan rooms;
  if (!json_array(document, "json", &rooms)) {
    return false;
  }
  const char *cursor = rooms.begin + 1;
  while (cursor < rooms.end) {
    cursor = skip_space(cursor, rooms.end);
    if (cursor == rooms.end || *cursor == ']') {
      return true;
    }
    JsonSpan room;
    const char *next = NULL;
    if (!json_container(cursor, rooms.end, '{', '}', &room, &next)) {
      return false;
    }
    if (list->room_count < MULTIPLEX_TRPC_MAX_ROOMS) {
      MultiplexTrpcRoom *parsed = &list->rooms[list->room_count];
      if (!parse_room(room, parsed)) {
        memset(list, 0, sizeof(*list));
        return false;
      }
      ++list->room_count;
    }
    cursor = skip_space(next, rooms.end);
    if (cursor < rooms.end && *cursor == ',') {
      ++cursor;
    }
  }
  memset(list, 0, sizeof(*list));
  return false;
}

bool multiplex_trpc_parse_watch_together_room(const char *json, size_t size,
                                              MultiplexTrpcRoom *room) {
  if (json == NULL || size == 0 || room == NULL) {
    return false;
  }
  const JsonSpan document = {.begin = json, .end = json + size};
  const char *value = NULL;
  JsonSpan object;
  const char *next = NULL;
  if (!json_value(document, "json", &value) ||
      !json_container(value, document.end, '{', '}', &object, &next) ||
      !parse_room(object, room)) {
    memset(room, 0, sizeof(*room));
    return false;
  }
  return true;
}

bool multiplex_trpc_parse_user_id(const char *json, size_t size,
                                  uint32_t *user_id) {
  if (json == NULL || size == 0 || user_id == NULL) {
    return false;
  }
  const JsonSpan document = {.begin = json, .end = json + size};
  uint32_t parsed = 0;
  if (!json_unsigned(document, "id", &parsed) || parsed == 0) {
    return false;
  }
  *user_id = parsed;
  return true;
}
