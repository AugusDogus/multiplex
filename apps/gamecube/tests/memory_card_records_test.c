#include "memory_card_records.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum {
  TEST_SECTOR_SIZE = 8192,
  TEST_LEGACY_V1_PAYLOAD_HEADER_SIZE = 16,
  TEST_LEGACY_V1_MAX_ENCODED_SIZE =
      MULTIPLEX_AUTH_RECORD_HEADER_SIZE + TEST_LEGACY_V1_PAYLOAD_HEADER_SIZE +
      (MULTIPLEX_AUTH_ORIGIN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY - 1u) +
      (MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY - 1u),
};

static const uint8_t LEGACY_V1_RECORD_FIXTURE[] = {
    0x4d, 0x50, 0x58, 0x41, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00,
    0x0a, 0x00, 0x00, 0x00, 0x1d, 0x94, 0xaa, 0xbb, 0xf5, 0xfd, 0x23,
    0x6e, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0xd2, 0x00,
    0x06, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x6c, 0x65, 0x67, 0x61,
    0x63, 0x79, 0x73, 0x65, 0x73, 0x73, 0x69, 0x6f, 0x6e,
};

static void write_be16(uint8_t *destination, uint16_t value) {
  destination[0] = (uint8_t)(value >> 8u);
  destination[1] = (uint8_t)value;
}

static void write_be32(uint8_t *destination, uint32_t value) {
  destination[0] = (uint8_t)(value >> 24u);
  destination[1] = (uint8_t)(value >> 16u);
  destination[2] = (uint8_t)(value >> 8u);
  destination[3] = (uint8_t)value;
}

static void write_be64(uint8_t *destination, uint64_t value) {
  write_be32(destination, (uint32_t)(value >> 32u));
  write_be32(destination + 4, (uint32_t)value);
}

static uint32_t crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = UINT32_MAX;
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8; ++bit) {
      const uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
      crc = (crc >> 1u) ^ (0xedb88320u & mask);
    }
  }
  return ~crc;
}

static size_t
encode_legacy_v1_record(uint8_t *destination, size_t capacity,
                        const MultiplexAuthCredentials *credentials,
                        uint32_t generation) {
  const size_t origin_length = strlen(credentials->origin);
  const size_t session_token_length = strlen(credentials->session_token);
  const size_t plex_token_length = strlen(credentials->plex_token);
  const size_t plex_client_id_length = strlen(credentials->plex_client_id);
  const size_t payload_size = TEST_LEGACY_V1_PAYLOAD_HEADER_SIZE +
                              origin_length + session_token_length +
                              plex_token_length + plex_client_id_length;
  const size_t encoded_size = MULTIPLEX_AUTH_RECORD_HEADER_SIZE + payload_size;
  assert(origin_length > 0 && origin_length < MULTIPLEX_AUTH_ORIGIN_CAPACITY);
  assert(session_token_length > 0 &&
         session_token_length < MULTIPLEX_AUTH_SESSION_TOKEN_CAPACITY);
  assert(plex_token_length < MULTIPLEX_AUTH_PLEX_TOKEN_CAPACITY);
  assert(plex_client_id_length < MULTIPLEX_AUTH_PLEX_CLIENT_ID_CAPACITY);
  assert(encoded_size <= capacity);

  memset(destination, 0, capacity);
  memcpy(destination, "MPXA", 4);
  write_be16(destination + 4, 1);
  write_be16(destination + 6, MULTIPLEX_AUTH_RECORD_HEADER_SIZE);
  write_be32(destination + 8, generation);
  write_be32(destination + 12, (uint32_t)payload_size);

  uint8_t *payload = destination + MULTIPLEX_AUTH_RECORD_HEADER_SIZE;
  write_be64(payload, credentials->session_expires_at_unix);
  write_be16(payload + 8, (uint16_t)origin_length);
  write_be16(payload + 10, (uint16_t)session_token_length);
  write_be16(payload + 12, (uint16_t)plex_token_length);
  write_be16(payload + 14, (uint16_t)plex_client_id_length);

  size_t cursor = TEST_LEGACY_V1_PAYLOAD_HEADER_SIZE;
  memcpy(payload + cursor, credentials->origin, origin_length);
  cursor += origin_length;
  memcpy(payload + cursor, credentials->session_token, session_token_length);
  cursor += session_token_length;
  memcpy(payload + cursor, credentials->plex_token, plex_token_length);
  cursor += plex_token_length;
  memcpy(payload + cursor, credentials->plex_client_id, plex_client_id_length);

  write_be32(destination + 16, crc32(payload, payload_size));
  write_be32(destination + 20, crc32(destination, 20));
  return encoded_size;
}

static MultiplexAuthCredentials credentials_for(const char *origin) {
  MultiplexAuthCredentials credentials = {0};
  strcpy(credentials.origin, origin);
  strcpy(credentials.session_token, "session");
  credentials.session_expires_at_unix = 1234;
  return credentials;
}

static void encode_record(uint8_t *bytes, size_t size, const char *origin,
                          uint32_t generation) {
  const MultiplexAuthCredentials credentials = credentials_for(origin);
  assert(multiplex_auth_record_encode(bytes, size, &credentials, generation));
}

static void assert_untouched(const MultiplexMemoryCardRecord *record,
                             const uint8_t *expected) {
  assert(memcmp(record, expected, sizeof(*record)) == 0);
}

static void assert_selection(MultiplexMemoryCardSectorView first,
                             MultiplexMemoryCardSectorView second,
                             MultiplexMemoryCardRecordsResult expected_result,
                             const char *expected_origin,
                             uint32_t expected_generation) {
  MultiplexMemoryCardRecord record = {0};
  const MultiplexMemoryCardRecordsResult result =
      multiplex_memory_card_records_select(first, second, &record);
  assert(result == expected_result);
  assert(strcmp(record.credentials.origin, expected_origin) == 0);
  assert(record.generation == expected_generation);
}

static void test_invalid_inputs(void) {
  uint8_t bytes[1] = {0};
  MultiplexMemoryCardRecord record;
  uint8_t expected[sizeof(record)];
  memset(&record, 0xa5, sizeof(record));
  memcpy(expected, &record, sizeof(record));

  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){NULL, 1},
             (MultiplexMemoryCardSectorView){bytes, sizeof(bytes)},
             &record) == MULTIPLEX_MEMORY_CARD_RECORDS_INVALID_INPUT);
  assert_untouched(&record, expected);

  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){bytes, sizeof(bytes)},
             (MultiplexMemoryCardSectorView){NULL, 1},
             &record) == MULTIPLEX_MEMORY_CARD_RECORDS_INVALID_INPUT);
  assert_untouched(&record, expected);

  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){NULL, 0},
             (MultiplexMemoryCardSectorView){NULL, 0},
             NULL) == MULTIPLEX_MEMORY_CARD_RECORDS_INVALID_INPUT);
}

static void test_empty_and_invalid_records(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  uint8_t second[TEST_SECTOR_SIZE] = {0};
  MultiplexMemoryCardRecord record;
  uint8_t expected[sizeof(record)];
  memset(&record, 0x5a, sizeof(record));
  memcpy(expected, &record, sizeof(record));

  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){NULL, 0},
             (MultiplexMemoryCardSectorView){NULL, 0},
             &record) == MULTIPLEX_MEMORY_CARD_RECORDS_NONE);
  assert_untouched(&record, expected);

  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){first, sizeof(first)},
             (MultiplexMemoryCardSectorView){second, sizeof(second)},
             &record) == MULTIPLEX_MEMORY_CARD_RECORDS_NONE);
  assert_untouched(&record, expected);
}

static void test_modern_selection(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  uint8_t second[TEST_SECTOR_SIZE] = {0};
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", 9);
  encode_record(second, sizeof(second), "second", 8);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 9);

  memset(first, 0, sizeof(first));
  memset(second, 0, sizeof(second));
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", 8);
  encode_record(second, sizeof(second), "second", 9);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_SECOND, "second", 9);

  first[MULTIPLEX_CARD_AUTH_OFFSET] = 'X';
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_SECOND, "second", 9);

  memset(first, 0, sizeof(first));
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", 10);
  encode_record(second, sizeof(second), "second", 10);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 10);
}

static void test_short_first_with_valid_second(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  uint8_t second[TEST_SECTOR_SIZE] = {0};
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", 3);
  encode_record(second, sizeof(second), "second", 4);

  assert_selection(
      (MultiplexMemoryCardSectorView){
          first,
          MULTIPLEX_CARD_AUTH_OFFSET + MULTIPLEX_AUTH_RECORD_HEADER_SIZE - 1u},
      (MultiplexMemoryCardSectorView){second, sizeof(second)},
      MULTIPLEX_MEMORY_CARD_RECORDS_SECOND, "second", 4);
}

static void test_generation_order(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  uint8_t second[TEST_SECTOR_SIZE] = {0};
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", UINT32_MAX);
  encode_record(second, sizeof(second), "second", 0);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_SECOND, "second", 0);

  memset(first, 0, sizeof(first));
  memset(second, 0, sizeof(second));
  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET,
                "first", 0);
  encode_record(second, sizeof(second), "second", UINT32_C(0x80000000));
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 0);
}

static void test_legacy_v1_selection(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  uint8_t second[TEST_SECTOR_SIZE] = {0};
  memcpy(first, LEGACY_V1_RECORD_FIXTURE, sizeof(LEGACY_V1_RECORD_FIXTURE));
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_LEGACY_FIRST, "legacy", 10);

  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                multiplex_memory_card_first_record_capacity(sizeof(first)),
                "first", 11);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 11);

  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                multiplex_memory_card_first_record_capacity(sizeof(first)),
                "first", 9);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_LEGACY_FIRST, "legacy", 10);

  encode_record(first + MULTIPLEX_CARD_AUTH_OFFSET,
                multiplex_memory_card_first_record_capacity(sizeof(first)),
                "first", 10);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 10);

  encode_record(second, sizeof(second), "second", 10);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_FIRST, "first", 10);

  first[MULTIPLEX_CARD_AUTH_OFFSET] = 0;
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){second, sizeof(second)},
                   MULTIPLEX_MEMORY_CARD_RECORDS_SECOND, "second", 10);
}

static void test_maximum_legacy_v1_record(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  MultiplexAuthCredentials credentials = {0};
  memset(credentials.origin, 'o', sizeof(credentials.origin) - 1u);
  memset(credentials.session_token, 's',
         sizeof(credentials.session_token) - 1u);
  memset(credentials.plex_token, 'p', sizeof(credentials.plex_token) - 1u);
  memset(credentials.plex_client_id, 'c',
         sizeof(credentials.plex_client_id) - 1u);
  credentials.session_expires_at_unix = UINT64_MAX;

  const size_t encoded_size = encode_legacy_v1_record(
      first, MULTIPLEX_CARD_AUTH_OFFSET, &credentials, 12);
  assert(encoded_size == TEST_LEGACY_V1_MAX_ENCODED_SIZE);
  assert(encoded_size <= MULTIPLEX_CARD_AUTH_OFFSET);
  assert_selection((MultiplexMemoryCardSectorView){first, sizeof(first)},
                   (MultiplexMemoryCardSectorView){NULL, 0},
                   MULTIPLEX_MEMORY_CARD_RECORDS_LEGACY_FIRST,
                   credentials.origin, 12);
}

static void test_legacy_window_truncates_oversized_record(void) {
  uint8_t first[TEST_SECTOR_SIZE] = {0};
  MultiplexAuthCredentials credentials = {0};
  memset(credentials.origin, 'o', sizeof(credentials.origin) - 1u);
  memset(credentials.session_token, 't',
         sizeof(credentials.session_token) - 1u);
  memset(credentials.plex_token, 'p', sizeof(credentials.plex_token) - 1u);
  memset(credentials.plex_client_id, 'c',
         sizeof(credentials.plex_client_id) - 1u);
  memset(credentials.plex_server_url, 'u',
         sizeof(credentials.plex_server_url) - 1u);
  memset(credentials.plex_server_token, 's',
         sizeof(credentials.plex_server_token) - 1u);
  memset(credentials.plex_server_id, 'i',
         sizeof(credentials.plex_server_id) - 1u);
  memset(credentials.plex_server_name, 'n',
         sizeof(credentials.plex_server_name) - 1u);
  credentials.session_expires_at_unix = UINT64_MAX;
  assert(multiplex_auth_record_encode(first, sizeof(first), &credentials, 11));
  assert(first[MULTIPLEX_CARD_AUTH_OFFSET] != 0);

  MultiplexAuthCredentials decoded;
  uint32_t generation = 0;
  assert(multiplex_auth_record_decode(first, sizeof(first), &decoded,
                                      &generation));
  assert(generation == 11);

  MultiplexMemoryCardRecord record;
  uint8_t expected[sizeof(record)];
  memset(&record, 0x3c, sizeof(record));
  memcpy(expected, &record, sizeof(record));
  assert(multiplex_memory_card_records_select(
             (MultiplexMemoryCardSectorView){first, sizeof(first)},
             (MultiplexMemoryCardSectorView){NULL, 0},
             &record) == MULTIPLEX_MEMORY_CARD_RECORDS_NONE);
  assert_untouched(&record, expected);
}

int main(void) {
  test_invalid_inputs();
  test_empty_and_invalid_records();
  test_modern_selection();
  test_short_first_with_valid_second();
  test_generation_order();
  test_legacy_v1_selection();
  test_maximum_legacy_v1_record();
  test_legacy_window_truncates_oversized_record();
  puts("GameCube memory card record tests passed.");
  return 0;
}
