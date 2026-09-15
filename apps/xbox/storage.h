#ifndef MULTIPLEX_XBOX_STORAGE_H
#define MULTIPLEX_XBOX_STORAGE_H

#include "auth_record.h"

#include <stdint.h>

typedef enum {
  MULTIPLEX_XBOX_STORAGE_OK = 0,
  MULTIPLEX_XBOX_STORAGE_NOT_FOUND = 1,
  MULTIPLEX_XBOX_STORAGE_CORRUPT = 2,
  MULTIPLEX_XBOX_STORAGE_IO_ERROR = 3,
  MULTIPLEX_XBOX_STORAGE_INVALID_CREDENTIALS = 4,
} MultiplexXboxStorageResult;

MultiplexXboxStorageResult
multiplex_xbox_storage_load(const char *directory,
                            MultiplexAuthCredentials *credentials,
                            uint32_t *generation);
MultiplexXboxStorageResult
multiplex_xbox_storage_save(const char *directory,
                            const MultiplexAuthCredentials *credentials,
                            uint32_t *generation);
const char *
multiplex_xbox_storage_result_message(MultiplexXboxStorageResult result);

#endif
