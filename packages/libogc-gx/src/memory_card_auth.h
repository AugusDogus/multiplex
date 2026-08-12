#ifndef MULTIPLEX_MEMORY_CARD_AUTH_H
#define MULTIPLEX_MEMORY_CARD_AUTH_H

#include "auth_record.h"

#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_MEMORY_CARD_CACHE_CAPACITY 2048u

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
  bool needs_presentation;
} MultiplexMemoryCardLocation;

MultiplexMemoryCardResult
multiplex_memory_card_load_auth(MultiplexAuthCredentials *credentials,
                                MultiplexMemoryCardLocation *location);
MultiplexMemoryCardResult multiplex_memory_card_load_auth_with_cache(
    MultiplexAuthCredentials *credentials,
    MultiplexMemoryCardLocation *location, uint8_t *cache,
    size_t cache_capacity);
MultiplexMemoryCardResult
multiplex_memory_card_save_auth(const MultiplexAuthCredentials *credentials,
                                MultiplexMemoryCardLocation *location);
MultiplexMemoryCardResult
multiplex_memory_card_delete_auth(MultiplexMemoryCardLocation *location);
MultiplexMemoryCardResult
multiplex_memory_card_save_cache(const MultiplexMemoryCardLocation *location,
                                 const uint8_t *source, size_t size);
const char *
multiplex_memory_card_result_message(MultiplexMemoryCardResult result);

#endif
