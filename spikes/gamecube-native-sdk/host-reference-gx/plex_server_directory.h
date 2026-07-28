#ifndef MULTIPLEX_PLEX_SERVER_DIRECTORY_H
#define MULTIPLEX_PLEX_SERVER_DIRECTORY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_PLEX_DIRECTORY_NAME_CAPACITY 96
#define MULTIPLEX_PLEX_DIRECTORY_ID_CAPACITY 64
#define MULTIPLEX_PLEX_DIRECTORY_TOKEN_CAPACITY 1024
#define MULTIPLEX_PLEX_DIRECTORY_HOST_CAPACITY 128
#define MULTIPLEX_PLEX_DIRECTORY_URL_CAPACITY 256

typedef struct {
  char name[MULTIPLEX_PLEX_DIRECTORY_NAME_CAPACITY];
  char machine_identifier[MULTIPLEX_PLEX_DIRECTORY_ID_CAPACITY];
  char access_token[MULTIPLEX_PLEX_DIRECTORY_TOKEN_CAPACITY];
  char host[MULTIPLEX_PLEX_DIRECTORY_HOST_CAPACITY];
  char url[MULTIPLEX_PLEX_DIRECTORY_URL_CAPACITY];
  uint16_t port;
  bool owned;
  bool presence;
} MultiplexPlexDirectoryServer;

bool multiplex_plex_server_directory_parse(
    const char *json, size_t size, MultiplexPlexDirectoryServer *server);

#endif
