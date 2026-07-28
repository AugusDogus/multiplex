#ifndef MULTIPLEX_MEMORY_CARD_AUTH_H
#define MULTIPLEX_MEMORY_CARD_AUTH_H

#include "auth_record.h"

typedef enum {
  MULTIPLEX_MEMORY_CARD_OK = 0,
  MULTIPLEX_MEMORY_CARD_NOT_FOUND,
  MULTIPLEX_MEMORY_CARD_NO_CARD,
  MULTIPLEX_MEMORY_CARD_NO_SPACE,
  MULTIPLEX_MEMORY_CARD_CORRUPT,
  MULTIPLEX_MEMORY_CARD_IO_ERROR,
  MULTIPLEX_MEMORY_CARD_INVALID_CREDENTIALS,
} MultiplexMemoryCardResult;

typedef struct {
  int slot;
  uint32_t generation;
} MultiplexMemoryCardLocation;

MultiplexMemoryCardResult multiplex_memory_card_load_auth(
    MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location);
MultiplexMemoryCardResult multiplex_memory_card_save_auth(
    const MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location);
const char *multiplex_memory_card_result_message(
    MultiplexMemoryCardResult result);

#endif
