#include "memory_card_records.h"

enum {
  AUTH_RECORD_V1_PAYLOAD_HEADER_SIZE = 16u,
  AUTH_RECORD_V2_PAYLOAD_HEADER_SIZE = 24u,
  AUTH_RECORD_V1_MAX_FIELD_BYTES =
      (MULTIPLEX_AUTH_ORIGIN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY - 1u),
  AUTH_RECORD_V2_MAX_FIELD_BYTES =
      AUTH_RECORD_V1_MAX_FIELD_BYTES +
      (MULTIPLEX_AUTH_PLEX_SERVER_URL_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_SERVER_TOKEN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_SERVER_ID_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_SERVER_NAME_CAPACITY - 1u),
  AUTH_RECORD_V1_MAX_ENCODED_SIZE = MULTIPLEX_AUTH_RECORD_HEADER_SIZE +
                                    AUTH_RECORD_V1_PAYLOAD_HEADER_SIZE +
                                    AUTH_RECORD_V1_MAX_FIELD_BYTES,
  AUTH_RECORD_V2_MAX_ENCODED_SIZE = MULTIPLEX_AUTH_RECORD_HEADER_SIZE +
                                    AUTH_RECORD_V2_PAYLOAD_HEADER_SIZE +
                                    AUTH_RECORD_V2_MAX_FIELD_BYTES,
};

_Static_assert(AUTH_RECORD_V1_MAX_ENCODED_SIZE <= MULTIPLEX_CARD_AUTH_OFFSET,
               "legacy v1 auth record exceeds its memory-card slot");
_Static_assert(AUTH_RECORD_V2_MAX_ENCODED_SIZE <=
                   MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
               "v2 auth record exceeds its memory-card slot");

static MultiplexMemoryCardSectorView
bounded_view(MultiplexMemoryCardSectorView sector, size_t start, size_t limit) {
  const size_t end = sector.size < limit ? sector.size : limit;
  if (end <= start) {
    return (MultiplexMemoryCardSectorView){NULL, 0};
  }
  return (MultiplexMemoryCardSectorView){sector.bytes + start, end - start};
}

MultiplexMemoryCardRecordsResult
multiplex_memory_card_records_select(MultiplexMemoryCardSectorView first,
                                     MultiplexMemoryCardSectorView second,
                                     MultiplexMemoryCardRecord *out_record) {
  if ((first.bytes == NULL && first.size != 0) ||
      (second.bytes == NULL && second.size != 0) || out_record == NULL) {
    return MULTIPLEX_MEMORY_CARD_RECORDS_INVALID_INPUT;
  }

  const size_t modern_first_capacity =
      multiplex_memory_card_first_record_capacity(first.size);
  const MultiplexMemoryCardSectorView modern_first =
      modern_first_capacity == 0 ? (MultiplexMemoryCardSectorView){NULL, 0}
                                 : (MultiplexMemoryCardSectorView){
                                       first.bytes + MULTIPLEX_CARD_AUTH_OFFSET,
                                       modern_first_capacity,
                                   };
  const MultiplexMemoryCardSectorView legacy_first =
      bounded_view(first, 0, MULTIPLEX_CARD_AUTH_OFFSET);
  MultiplexAuthCredentials credentials;
  uint32_t generation = 0;
  const MultiplexAuthRecordSelection modern_selection =
      multiplex_auth_record_select(modern_first.bytes, modern_first.size,
                                   second.bytes, second.size, &credentials,
                                   &generation);

  MultiplexMemoryCardSectorView modern = {NULL, 0};
  MultiplexMemoryCardRecordsResult modern_result =
      MULTIPLEX_MEMORY_CARD_RECORDS_NONE;
  if (modern_selection == MULTIPLEX_AUTH_RECORD_FIRST) {
    modern = modern_first;
    modern_result = MULTIPLEX_MEMORY_CARD_RECORDS_FIRST;
  } else if (modern_selection == MULTIPLEX_AUTH_RECORD_SECOND) {
    modern = second;
    modern_result = MULTIPLEX_MEMORY_CARD_RECORDS_SECOND;
  }

  const MultiplexAuthRecordSelection final_selection =
      multiplex_auth_record_select(modern.bytes, modern.size,
                                   legacy_first.bytes, legacy_first.size,
                                   &credentials, &generation);
  if (final_selection == MULTIPLEX_AUTH_RECORD_NONE) {
    return MULTIPLEX_MEMORY_CARD_RECORDS_NONE;
  }

  *out_record = (MultiplexMemoryCardRecord){
      .credentials = credentials,
      .generation = generation,
  };
  return final_selection == MULTIPLEX_AUTH_RECORD_SECOND
             ? MULTIPLEX_MEMORY_CARD_RECORDS_LEGACY_FIRST
             : modern_result;
}
