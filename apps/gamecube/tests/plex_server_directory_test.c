#include "plex_server_directory.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_prefers_present_owned_server_and_routable_connection(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":["
      "{\"name\":\"Shared\",\"product\":\"Plex Media Server\","
      "\"clientIdentifier\":\"shared-id\",\"accessToken\":\"shared-token\","
      "\"owned\":false,\"presence\":true,\"httpsRequired\":false,"
      "\"connections\":[{\"protocol\":\"https\","
      "\"address\":\"shared.example\",\"port\":32400,\"local\":false,"
      "\"relay\":false}]},"
      "{\"name\":\"Augie's Haus\",\"product\":\"Plex Media Server\","
      "\"clientIdentifier\":\"owned-id\",\"accessToken\":\"owned-token\","
      "\"owned\":true,\"presence\":true,\"httpsRequired\":false,"
      "\"connections\":["
      "{\"protocol\":\"https\",\"address\":\"172.18.0.12\",\"port\":32400,"
      "\"local\":true,\"relay\":false},"
      "{\"protocol\":\"https\",\"address\":\"plex.example\",\"port\":32400,"
      "\"local\":false,\"relay\":false}]}"
      "]}}}";
  MultiplexPlexDirectoryServer server;

  assert(multiplex_plex_server_directory_parse(response, strlen(response),
                                               &server));
  assert(strcmp(server.name, "Augie's Haus") == 0);
  assert(strcmp(server.machine_identifier, "owned-id") == 0);
  assert(strcmp(server.access_token, "owned-token") == 0);
  assert(strcmp(server.host, "plex.example") == 0);
  assert(strcmp(server.url, "http://plex.example:32400") == 0);
  assert(server.port == 32400);
  assert(server.owned);
  assert(server.presence);
}

static void test_rejects_https_only_server(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":[{"
      "\"name\":\"Secure\",\"product\":\"Plex Media Server\","
      "\"clientIdentifier\":\"secure-id\",\"accessToken\":\"token\","
      "\"owned\":true,\"presence\":true,\"httpsRequired\":true,"
      "\"connections\":[{\"protocol\":\"https\","
      "\"address\":\"secure.example\",\"port\":443,\"local\":false,"
      "\"relay\":false}]}]}}}";
  MultiplexPlexDirectoryServer server;

  assert(!multiplex_plex_server_directory_parse(response, strlen(response),
                                                &server));
}

static void test_rejects_header_injection_host(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":[{"
      "\"name\":\"Unsafe\",\"product\":\"Plex Media Server\","
      "\"clientIdentifier\":\"unsafe-id\",\"accessToken\":\"token\","
      "\"owned\":true,\"presence\":true,\"httpsRequired\":false,"
      "\"connections\":[{\"protocol\":\"http\","
      "\"address\":\"plex.example\\r\\nInjected\",\"port\":32400,"
      "\"local\":false,\"relay\":false}]}]}}}";
  MultiplexPlexDirectoryServer server;

  assert(!multiplex_plex_server_directory_parse(response, strlen(response),
                                                &server));
}

int main(void) {
  test_prefers_present_owned_server_and_routable_connection();
  test_rejects_https_only_server();
  test_rejects_header_injection_host();
  puts("GameCube Plex server directory tests passed.");
  return 0;
}
