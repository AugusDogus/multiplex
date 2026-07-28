#include "auth_record.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define SECTOR_SIZE 8192u

static MultiplexAuthCredentials credentials(const char *session_token) {
  MultiplexAuthCredentials value = {0};
  strcpy(value.origin, "https://multiplex.example");
  strcpy(value.session_token, session_token);
  strcpy(value.plex_token, "plex-device-token");
  strcpy(value.plex_client_id, "multiplex-gamecube-1234");
  value.session_expires_at_unix = UINT64_C(2000000000);
  return value;
}

static void test_round_trip(void) {
  uint8_t record[SECTOR_SIZE];
  const MultiplexAuthCredentials expected = credentials("session-one");
  MultiplexAuthCredentials actual;
  uint32_t generation = 0;

  assert(multiplex_auth_record_encode(record, sizeof(record), &expected, 7));
  assert(multiplex_auth_record_decode(record, sizeof(record), &actual,
                                      &generation));
  assert(generation == 7);
  assert(memcmp(&actual, &expected, sizeof(expected)) == 0);
}

static void test_rejects_corruption(void) {
  uint8_t record[SECTOR_SIZE];
  const MultiplexAuthCredentials expected = credentials("session-one");
  MultiplexAuthCredentials actual;
  uint32_t generation = 0;

  assert(multiplex_auth_record_encode(record, sizeof(record), &expected, 7));
  record[MULTIPLEX_AUTH_RECORD_HEADER_SIZE + 20] ^= 0x80;
  assert(!multiplex_auth_record_decode(record, sizeof(record), &actual,
                                       &generation));
}

static void test_selects_newest_valid_copy(void) {
  uint8_t first[SECTOR_SIZE];
  uint8_t second[SECTOR_SIZE];
  const MultiplexAuthCredentials old_credentials = credentials("old");
  const MultiplexAuthCredentials new_credentials = credentials("new");
  MultiplexAuthCredentials actual;
  uint32_t generation = 0;

  assert(multiplex_auth_record_encode(first, sizeof(first), &old_credentials,
                                      41));
  assert(multiplex_auth_record_encode(second, sizeof(second), &new_credentials,
                                      42));
  assert(multiplex_auth_record_select(
             first, sizeof(first), second, sizeof(second), &actual,
             &generation) == MULTIPLEX_AUTH_RECORD_SECOND);
  assert(generation == 42);
  assert(strcmp(actual.session_token, "new") == 0);

  second[0] = 0;
  assert(multiplex_auth_record_select(
             first, sizeof(first), second, sizeof(second), &actual,
             &generation) == MULTIPLEX_AUTH_RECORD_FIRST);
  assert(generation == 41);
  assert(strcmp(actual.session_token, "old") == 0);
}

static void test_generation_wrap(void) {
  uint8_t first[SECTOR_SIZE];
  uint8_t second[SECTOR_SIZE];
  const MultiplexAuthCredentials before_wrap = credentials("before-wrap");
  const MultiplexAuthCredentials after_wrap = credentials("after-wrap");
  MultiplexAuthCredentials actual;
  uint32_t generation = 0;

  assert(multiplex_auth_record_encode(first, sizeof(first), &before_wrap,
                                      UINT32_MAX));
  assert(multiplex_auth_record_encode(second, sizeof(second), &after_wrap, 0));
  assert(multiplex_auth_record_select(
             first, sizeof(first), second, sizeof(second), &actual,
             &generation) == MULTIPLEX_AUTH_RECORD_SECOND);
  assert(generation == 0);
  assert(strcmp(actual.session_token, "after-wrap") == 0);
}

static void test_requires_terminated_bounded_fields(void) {
  uint8_t record[SECTOR_SIZE];
  MultiplexAuthCredentials value = credentials("session-one");
  memset(value.origin, 'x', sizeof(value.origin));
  assert(!multiplex_auth_record_encode(record, sizeof(record), &value, 1));
}

int main(void) {
  test_round_trip();
  test_rejects_corruption();
  test_selects_newest_valid_copy();
  test_generation_wrap();
  test_requires_terminated_bounded_fields();
  puts("GameCube auth record tests passed.");
  return 0;
}
