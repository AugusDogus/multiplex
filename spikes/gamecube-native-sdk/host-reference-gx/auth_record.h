#ifndef MULTIPLEX_AUTH_RECORD_H
#define MULTIPLEX_AUTH_RECORD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_AUTH_ORIGIN_CAPACITY 256
#define MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY 256
#define MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY 1024
#define MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY 96
#define MULTIPLEX_AUTH_RECORD_HEADER_SIZE 24u

typedef struct {
  char origin[MULTIPLEX_AUTH_ORIGIN_CAPACITY];
  char session_token[MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY];
  char plex_token[MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY];
  char plex_client_id[MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY];
  uint64_t session_expires_at_unix;
} MultiplexAuthCredentials;

typedef enum {
  MULTIPLEX_AUTH_RECORD_NONE = 0,
  MULTIPLEX_AUTH_RECORD_FIRST = 1,
  MULTIPLEX_AUTH_RECORD_SECOND = 2,
} MultiplexAuthRecordSelection;

bool multiplex_auth_record_encode(uint8_t *destination, size_t capacity,
                                  const MultiplexAuthCredentials *credentials,
                                  uint32_t generation);
bool multiplex_auth_record_decode(const uint8_t *record, size_t size,
                                  MultiplexAuthCredentials *credentials,
                                  uint32_t *generation);
MultiplexAuthRecordSelection multiplex_auth_record_select(
    const uint8_t *first, size_t first_size, const uint8_t *second,
    size_t second_size, MultiplexAuthCredentials *credentials,
    uint32_t *generation);

#endif
