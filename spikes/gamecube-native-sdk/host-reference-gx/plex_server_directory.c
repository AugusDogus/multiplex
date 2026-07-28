#include "plex_server_directory.h"

#include <stdio.h>
#include <string.h>

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
  const int pattern_size = snprintf(pattern, sizeof(pattern), "\"%s\"", key);
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
    if (value < 0x20 || output + 1u >= capacity) {
      return false;
    }
    destination[output++] = (char)value;
  }
  if (cursor == span.end || *cursor != '"') {
    return false;
  }
  destination[output] = '\0';
  return true;
}

static bool json_bool(JsonSpan span, const char *key, bool *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor)) {
    return false;
  }
  if (cursor + 4 <= span.end && memcmp(cursor, "true", 4) == 0) {
    *destination = true;
    return true;
  }
  if (cursor + 5 <= span.end && memcmp(cursor, "false", 5) == 0) {
    *destination = false;
    return true;
  }
  return false;
}

static bool json_port(JsonSpan span, const char *key, uint16_t *destination) {
  const char *cursor = NULL;
  if (!json_value(span, key, &cursor) || *cursor < '0' || *cursor > '9') {
    return false;
  }
  unsigned value = 0;
  do {
    value = value * 10u + (unsigned)(*cursor++ - '0');
    if (value > UINT16_MAX) {
      return false;
    }
  } while (cursor < span.end && *cursor >= '0' && *cursor <= '9');
  if (value == 0) {
    return false;
  }
  *destination = (uint16_t)value;
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

static bool safe_host(const char *host) {
  if (host[0] == '\0') {
    return false;
  }
  for (const char *cursor = host; *cursor != '\0'; ++cursor) {
    const char value = *cursor;
    if (!((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
          (value >= '0' && value <= '9') || value == '.' || value == '-')) {
      return false;
    }
  }
  return true;
}

static bool select_connection(JsonSpan server, char *host, size_t host_capacity,
                              uint16_t *port) {
  const char *connections = NULL;
  if (!json_value(server, "connections", &connections) || *connections != '[') {
    return false;
  }
  const char *cursor = connections + 1;
  unsigned best_rank = UINT32_MAX;
  bool found = false;
  while (cursor < server.end) {
    cursor = skip_space(cursor, server.end);
    if (cursor < server.end && *cursor == ']') {
      break;
    }
    JsonSpan connection;
    const char *next = NULL;
    if (!json_object(cursor, server.end, &connection, &next)) {
      return false;
    }
    char address[MULTIPLEX_PLEX_DIRECTORY_HOST_CAPACITY];
    char protocol[16];
    uint16_t candidate_port = 0;
    bool local = false;
    bool relay = false;
    if (json_string(connection, "address", address, sizeof(address)) &&
        json_string(connection, "protocol", protocol, sizeof(protocol)) &&
        json_port(connection, "port", &candidate_port) &&
        json_bool(connection, "local", &local) &&
        json_bool(connection, "relay", &relay) && safe_host(address)) {
      /*
       * An HTTP-capable console prefers the externally routable direct
       * address. Plex often reports a container-only address as "local".
       */
      const unsigned rank = relay ? 2u : (local ? 1u : 0u);
      if (rank < best_rank &&
          (strcmp(protocol, "http") == 0 || strcmp(protocol, "https") == 0)) {
        if (strlen(address) >= host_capacity) {
          return false;
        }
        strcpy(host, address);
        *port = candidate_port;
        best_rank = rank;
        found = true;
      }
    }
    cursor = next;
  }
  return found;
}

static bool parse_server(JsonSpan object,
                         MultiplexPlexDirectoryServer *server) {
  char product[32];
  bool https_required = true;
  if (!json_string(object, "product", product, sizeof(product)) ||
      strcmp(product, "Plex Media Server") != 0 ||
      !json_string(object, "name", server->name, sizeof(server->name)) ||
      !json_string(object, "clientIdentifier", server->machine_identifier,
                   sizeof(server->machine_identifier)) ||
      !json_string(object, "accessToken", server->access_token,
                   sizeof(server->access_token)) ||
      !json_bool(object, "owned", &server->owned) ||
      !json_bool(object, "presence", &server->presence) ||
      !json_bool(object, "httpsRequired", &https_required) || https_required ||
      !select_connection(object, server->host, sizeof(server->host),
                         &server->port)) {
    return false;
  }
  const int url_size = snprintf(server->url, sizeof(server->url),
                                "http://%s:%u", server->host, server->port);
  return url_size > 0 && (size_t)url_size < sizeof(server->url);
}

bool multiplex_plex_server_directory_parse(
    const char *json, size_t size, MultiplexPlexDirectoryServer *server) {
  if (json == NULL || server == NULL || size == 0) {
    return false;
  }
  JsonSpan document = {
      .begin = json,
      .end = json + size,
  };
  const char *array = NULL;
  if (!json_value(document, "json", &array) || *array != '[') {
    return false;
  }

  const char *cursor = array + 1;
  bool found = false;
  unsigned best_rank = UINT32_MAX;
  while (cursor < document.end) {
    cursor = skip_space(cursor, document.end);
    if (cursor < document.end && *cursor == ']') {
      break;
    }
    JsonSpan object;
    const char *next = NULL;
    if (!json_object(cursor, document.end, &object, &next)) {
      return false;
    }
    MultiplexPlexDirectoryServer candidate = {0};
    if (parse_server(object, &candidate)) {
      const unsigned rank = candidate.owned ? (candidate.presence ? 0u : 2u)
                                            : (candidate.presence ? 1u : 3u);
      if (rank < best_rank) {
        *server = candidate;
        best_rank = rank;
        found = true;
      }
    }
    cursor = next;
  }
  return found;
}
