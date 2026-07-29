#include "trpc_client.h"

#include "http_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef GEKKO
#include <gccore.h>
#else
#define SYS_Report(...) ((void)0)
#endif

#define TRPC_RESPONSE_CAPACITY (32u * 1024u)
#define TRPC_URL_CAPACITY 512u
#define TRPC_BODY_CAPACITY 512u

static bool append_json_string(char *destination, size_t capacity,
                               size_t *used, const char *value) {
  if (destination == NULL || used == NULL || value == NULL ||
      *used >= capacity) {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor != '\0'; ++cursor) {
    const unsigned char byte = *cursor;
    const char *escape = NULL;
    if (byte == '"' || byte == '\\') {
      escape = byte == '"' ? "\\\"" : "\\\\";
    } else if (byte == '\b') {
      escape = "\\b";
    } else if (byte == '\f') {
      escape = "\\f";
    } else if (byte == '\n') {
      escape = "\\n";
    } else if (byte == '\r') {
      escape = "\\r";
    } else if (byte == '\t') {
      escape = "\\t";
    } else if (byte < 0x20u) {
      return false;
    }
    if (escape != NULL) {
      if (*used + 2u >= capacity) {
        return false;
      }
      destination[(*used)++] = escape[0];
      destination[(*used)++] = escape[1];
    } else {
      if (*used + 1u >= capacity) {
        return false;
      }
      destination[(*used)++] = (char)byte;
    }
  }
  destination[*used] = '\0';
  return true;
}

static bool safe_server_id(const char *value) {
  if (value == NULL || value[0] == '\0') {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor != '\0'; ++cursor) {
    if (!((*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= 'a' && *cursor <= 'z') ||
          (*cursor >= '0' && *cursor <= '9') || *cursor == '-' ||
          *cursor == '_')) {
      return false;
    }
  }
  return true;
}

bool multiplex_trpc_load_watch_together_rooms(const char *base_url,
                                               const char *bearer_token,
                                               MultiplexTrpcRoomList *list) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || list == NULL) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  char url[TRPC_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url),
      "%s%sapi/trpc/plex.getWatchTogetherRooms?"
      "input=%%7B%%22json%%22%%3Anull%%7D",
      base_url, base_size != 0 && base_url[base_size - 1u] == '/' ? "" : "/");
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }
  char *response_body = malloc(TRPC_RESPONSE_CAPACITY);
  if (response_body == NULL) {
    return false;
  }
  HttpJsonResponse response;
  const bool loaded =
      http_client_request_json("GET", url, bearer_token, NULL, response_body,
                               TRPC_RESPONSE_CAPACITY, &response) &&
      response.status == 200 &&
      multiplex_trpc_parse_watch_together_rooms(response_body,
                                                 response.body_size, list);
  free(response_body);
  SYS_Report("REFERENCE GX: tRPC Watch Together rooms=%u loaded=%u\n",
             loaded ? list->room_count : 0, loaded ? 1u : 0u);
  return loaded;
}

bool multiplex_trpc_create_watch_together_room(
    const char *base_url, const char *bearer_token, const char *server_id,
    uint32_t rating_key, const char *title, MultiplexTrpcRoom *room) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || server_id == NULL || server_id[0] == '\0' ||
      !safe_server_id(server_id) || rating_key == 0 || title == NULL ||
      title[0] == '\0' || room == NULL) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  char url[TRPC_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url), "%s%sapi/trpc/plex.createWatchTogetherRoom", base_url,
      base_size != 0 && base_url[base_size - 1u] == '/' ? "" : "/");
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }

  char body[TRPC_BODY_CAPACITY];
  int prefix_size = snprintf(
      body, sizeof(body),
      "{\"json\":{\"serverId\":\"%s\",\"ratingKey\":\"%u\","
      "\"title\":\"",
      server_id, rating_key);
  if (prefix_size <= 0 || (size_t)prefix_size >= sizeof(body)) {
    return false;
  }
  size_t body_size = (size_t)prefix_size;
  if (!append_json_string(body, sizeof(body), &body_size, title)) {
    return false;
  }
  static const char suffix[] = "\",\"users\":[]}}";
  if (sizeof(suffix) > sizeof(body) - body_size) {
    return false;
  }
  memcpy(body + body_size, suffix, sizeof(suffix));

  char *response_body = malloc(TRPC_RESPONSE_CAPACITY);
  if (response_body == NULL) {
    return false;
  }
  HttpJsonResponse response;
  const bool created =
      http_client_request_json("POST", url, bearer_token, body, response_body,
                               TRPC_RESPONSE_CAPACITY, &response) &&
      response.status == 200 &&
      multiplex_trpc_parse_watch_together_room(
          response_body, response.body_size, room);
  free(response_body);
  SYS_Report("REFERENCE GX: tRPC Watch Together create status=%u\n",
             created ? 1u : 0u);
  return created;
}
