#include "plex_bootstrap.h"

#include "http_client.h"
#include "plex_server_directory.h"

#include <gccore.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PLEX_DIRECTORY_RESPONSE_CAPACITY (64u * 1024u)
#define PLEX_IDENTITY_RESPONSE_CAPACITY 2048u
#define PLEX_BOOTSTRAP_URL_CAPACITY 512u

static bool build_url(const char *base_url, const char *path, char *url,
                      size_t capacity) {
  if (base_url == NULL || base_url[0] == '\0') {
    return false;
  }
  const size_t base_size = strlen(base_url);
  const int written =
      snprintf(url, capacity, "%s%s%s", base_url,
               base_url[base_size - 1u] == '/' ? "" : "/", path);
  return written > 0 && (size_t)written < capacity;
}

static bool validate_identity(const MultiplexPlexDirectoryServer *server,
                              const char *client_identifier) {
  char url[PLEX_BOOTSTRAP_URL_CAPACITY];
  if (!build_url(server->url, "identity", url, sizeof(url))) {
    return false;
  }
  const HttpRequestHeader headers[] = {
      {.name = "X-Plex-Token", .value = server->access_token},
      {.name = "X-Plex-Product", .value = "Multiplex"},
      {.name = "X-Plex-Version", .value = "0.1.0"},
      {.name = "X-Plex-Platform", .value = "GameCube"},
      {.name = "X-Plex-Client-Identifier", .value = client_identifier},
  };
  char response_body[PLEX_IDENTITY_RESPONSE_CAPACITY];
  HttpJsonResponse response;
  if (!http_client_request_with_headers(
          "GET", url, headers, sizeof(headers) / sizeof(headers[0]), NULL,
          response_body, sizeof(response_body), &response) ||
      response.status != 200) {
    return false;
  }
  char expected[128];
  const int expected_size =
      snprintf(expected, sizeof(expected), "\"machineIdentifier\":\"%s\"",
               server->machine_identifier);
  return expected_size > 0 && (size_t)expected_size < sizeof(expected) &&
         strstr(response_body, expected) != NULL;
}

bool multiplex_plex_bootstrap_credentials(MultiplexAuthCredentials *credentials,
                                          const char *preferred_server_url) {
  if (credentials == NULL || credentials->origin[0] == '\0' ||
      credentials->session_token[0] == '\0' ||
      credentials->plex_client_id[0] == '\0') {
    return false;
  }
  char url[PLEX_BOOTSTRAP_URL_CAPACITY];
  if (!build_url(credentials->origin,
                 "api/trpc/plex.getServers?"
                 "input=%7B%22json%22%3Anull%7D",
                 url, sizeof(url))) {
    return false;
  }

  char *response_body = malloc(PLEX_DIRECTORY_RESPONSE_CAPACITY);
  if (response_body == NULL) {
    return false;
  }
  HttpJsonResponse response;
  const bool requested = http_client_request_json(
      "GET", url, credentials->session_token, NULL, response_body,
      PLEX_DIRECTORY_RESPONSE_CAPACITY, &response);
  MultiplexPlexDirectoryServer server;
  const bool parsed = requested && response.status == 200 &&
                      multiplex_plex_server_directory_parse(
                          response_body, response.body_size, &server);
  free(response_body);
  if (parsed && preferred_server_url != NULL &&
      preferred_server_url[0] != '\0') {
    if (strlen(preferred_server_url) >= sizeof(server.url)) {
      return false;
    }
    strcpy(server.url, preferred_server_url);
  }
  if (!parsed || !validate_identity(&server, credentials->plex_client_id) ||
      strlen(server.url) >= sizeof(credentials->plex_server_url) ||
      strlen(server.access_token) >= sizeof(credentials->plex_server_token) ||
      strlen(server.machine_identifier) >=
          sizeof(credentials->plex_server_id) ||
      strlen(server.name) >= sizeof(credentials->plex_server_name)) {
    SYS_Report("REFERENCE GX: direct Plex bootstrap unavailable\n");
    return false;
  }

  strcpy(credentials->plex_server_url, server.url);
  strcpy(credentials->plex_server_token, server.access_token);
  strcpy(credentials->plex_server_id, server.machine_identifier);
  strcpy(credentials->plex_server_name, server.name);
  SYS_Report("REFERENCE GX: direct Plex server=%s endpoint=%s\n", server.name,
             server.url);
  return true;
}
