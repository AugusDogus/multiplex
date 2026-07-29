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
