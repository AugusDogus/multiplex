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

static bool append_json_string(char *destination, size_t capacity, size_t *used,
                               const char *value) {
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

static bool safe_identifier(const char *value) {
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

bool multiplex_trpc_load_user_id(const char *base_url, const char *bearer_token,
                                 uint32_t *user_id) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || user_id == NULL) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  char url[TRPC_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url),
      "%s%sapi/trpc/plex.getUserInfo?"
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
  uint32_t parsed = 0;
  const bool loaded =
      http_client_request_json("GET", url, bearer_token, NULL, response_body,
                               TRPC_RESPONSE_CAPACITY, &response) &&
      response.status == 200 &&
      multiplex_trpc_parse_user_id(response_body, response.body_size, &parsed);
  free(response_body);
  if (loaded) {
    *user_id = parsed;
  }
  SYS_Report("REFERENCE GX: tRPC Plex user loaded=%u\n", loaded ? 1u : 0u);
  return loaded;
}

bool multiplex_trpc_load_watch_together_invitees(
    const char *base_url, const char *bearer_token,
    MultiplexTrpcInviteeList *list) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || list == NULL) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  char url[TRPC_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url),
      "%s%sapi/trpc/plex.getWatchTogetherInvitees?"
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
      multiplex_trpc_parse_watch_together_invitees(response_body,
                                                   response.body_size, list);
  free(response_body);
  SYS_Report("REFERENCE GX: tRPC Watch Together invitees=%u loaded=%u\n",
             loaded ? list->invitee_count : 0, loaded ? 1u : 0u);
  return loaded;
}

bool multiplex_trpc_create_watch_together_room(
    const char *base_url, const char *bearer_token, const char *server_id,
    uint32_t rating_key, const char *title, uint32_t invitee_user_id,
    MultiplexTrpcRoom *room) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || server_id == NULL || server_id[0] == '\0' ||
      !safe_identifier(server_id) || rating_key == 0 || title == NULL ||
      title[0] == '\0' || invitee_user_id == 0 || room == NULL) {
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
  int prefix_size =
      snprintf(body, sizeof(body),
               "{\"json\":{\"serverId\":\"%s\",\"ratingKey\":\"%u\","
               "\"key\":\"/library/metadata/%u\",\"title\":\"",
               server_id, rating_key, rating_key);
  if (prefix_size <= 0 || (size_t)prefix_size >= sizeof(body)) {
    return false;
  }
  size_t body_size = (size_t)prefix_size;
  if (!append_json_string(body, sizeof(body), &body_size, title)) {
    return false;
  }
  const int suffix_size = snprintf(body + body_size, sizeof(body) - body_size,
                                   "\",\"users\":[%u]}}", invitee_user_id);
  if (suffix_size <= 0 || (size_t)suffix_size >= sizeof(body) - body_size) {
    return false;
  }

  char *response_body = malloc(TRPC_RESPONSE_CAPACITY);
  if (response_body == NULL) {
    return false;
  }
  HttpJsonResponse response;
  const bool created =
      http_client_request_json("POST", url, bearer_token, body, response_body,
                               TRPC_RESPONSE_CAPACITY, &response) &&
      response.status == 200 &&
      multiplex_trpc_parse_watch_together_room(response_body,
                                               response.body_size, room);
  free(response_body);
  SYS_Report("REFERENCE GX: tRPC Watch Together create status=%u\n",
             created ? 1u : 0u);
  return created;
}

bool multiplex_trpc_delete_watch_together_room(const char *base_url,
                                               const char *bearer_token,
                                               const char *room_id) {
  if (base_url == NULL || base_url[0] == '\0' || bearer_token == NULL ||
      bearer_token[0] == '\0' || !safe_identifier(room_id)) {
    return false;
  }
  const size_t base_size = strlen(base_url);
  char url[TRPC_URL_CAPACITY];
  const int url_size = snprintf(
      url, sizeof(url), "%s%sapi/trpc/plex.deleteWatchTogetherRoom", base_url,
      base_size != 0 && base_url[base_size - 1u] == '/' ? "" : "/");
  if (url_size <= 0 || (size_t)url_size >= sizeof(url)) {
    return false;
  }

  char body[TRPC_BODY_CAPACITY];
  const int body_size =
      snprintf(body, sizeof(body), "{\"json\":{\"roomId\":\"%s\"}}", room_id);
  if (body_size <= 0 || (size_t)body_size >= sizeof(body)) {
    return false;
  }

  char response_body[256];
  HttpJsonResponse response;
  const bool deleted =
      http_client_request_json("POST", url, bearer_token, body, response_body,
                               sizeof(response_body), &response) &&
      response.status == 200;
  SYS_Report("REFERENCE GX: tRPC Watch Together delete status=%u\n",
             deleted ? 1u : 0u);
  return deleted;
}
