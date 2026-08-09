#ifndef MULTIPLEX_MEMORY_CARD_RECORDS_H
#define MULTIPLEX_MEMORY_CARD_RECORDS_H

#include "auth_record.h"
#include "memory_card_layout.h"

#include <stddef.h>
#include <stdint.h>

typedef struct {
  const uint8_t *bytes;
  size_t size;
} MultiplexMemoryCardSectorView;

typedef struct {
  MultiplexAuthCredentials credentials;
  uint32_t generation;
} MultiplexMemoryCardRecord;

typedef enum {
  MULTIPLEX_MEMORY_CARD_RECORDS_INVALID_INPUT = 0,
  MULTIPLEX_MEMORY_CARD_RECORDS_NONE,
  MULTIPLEX_MEMORY_CARD_RECORDS_FIRST,
  MULTIPLEX_MEMORY_CARD_RECORDS_SECOND,
  MULTIPLEX_MEMORY_CARD_RECORDS_LEGACY_FIRST,
} MultiplexMemoryCardRecordsResult;

MultiplexMemoryCardRecordsResult
multiplex_memory_card_records_select(MultiplexMemoryCardSectorView first,
                                     MultiplexMemoryCardSectorView second,
                                     MultiplexMemoryCardRecord *out_record);

#endif
