#include "entropy_seed.h"

#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  uint8_t records[2][MULTIPLEX_ENTROPY_RECORD_SIZE];
  bool fail_read;
  bool fail_write;
  bool corrupt_write;
} FakeStore;

static bool read_record(void *context, unsigned index, uint8_t *record,
                        size_t size) {
  FakeStore *store = context;
  if (store->fail_read || index >= 2u ||
      size != MULTIPLEX_ENTROPY_RECORD_SIZE) {
    return false;
  }
  memcpy(record, store->records[index], size);
  return true;
}

static bool write_record(void *context, unsigned index, const uint8_t *record,
                         size_t size) {
  FakeStore *store = context;
  if (store->fail_write || index >= 2u ||
      size != MULTIPLEX_ENTROPY_RECORD_SIZE) {
    return false;
  }
  memcpy(store->records[index], record, size);
  if (store->corrupt_write) {
    store->records[index][20] ^= 0x80u;
  }
  return true;
}

static bool derive(void *context,
                   const uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE],
                   uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE],
                   uint8_t next_seed[MULTIPLEX_ENTROPY_SEED_SIZE]) {
  const bool fail = context != NULL;
  if (fail) {
    return false;
  }
  for (size_t index = 0; index < MULTIPLEX_ENTROPY_SEED_SIZE; ++index) {
    boot_seed[index] = seed[index] ^ 0xa5u;
    next_seed[index] = seed[index] ^ 0x5au;
  }
  return true;
}

static MultiplexEntropySeedStore seed_store(FakeStore *fake) {
  const MultiplexEntropySeedStore store = {
      .context = fake,
      .read = read_record,
      .write = write_record,
  };
  return store;
}

static void provision(FakeStore *store, uint8_t fill, uint32_t generation) {
  uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  memset(seed, fill, sizeof(seed));
  assert(multiplex_entropy_seed_record_encode(
      store->records[0], sizeof(store->records[0]), seed, generation));
}

static void test_rotates_and_preserves_previous_copy(void) {
  FakeStore fake = {0};
  provision(&fake, 0x11u, 7u);
  const MultiplexEntropySeedStore store = seed_store(&fake);
  uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_OK);
  assert(boot_seed[0] == (uint8_t)(0x11u ^ 0xa5u));

  uint8_t decoded[MULTIPLEX_ENTROPY_SEED_SIZE];
  uint32_t generation = 0;
  assert(multiplex_entropy_seed_record_decode(
      fake.records[0], sizeof(fake.records[0]), decoded, &generation));
  assert(generation == 7u && decoded[0] == 0x11u);
  assert(multiplex_entropy_seed_record_decode(
      fake.records[1], sizeof(fake.records[1]), decoded, &generation));
  assert(generation == 8u && decoded[0] == (uint8_t)(0x11u ^ 0x5au));
}

static void test_deterministic_fail_closed_paths(void) {
  uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  FakeStore fake = {0};
  MultiplexEntropySeedStore store = seed_store(&fake);
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_MISSING);

  fake.records[0][0] = 1u;
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_CORRUPT);

  memset(&fake, 0, sizeof(fake));
  provision(&fake, 0x22u, 1u);
  fake.fail_read = true;
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_READ_FAILED);
  fake.fail_read = false;
  assert(multiplex_entropy_seed_rotate(&store, derive, &fake, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_DERIVE_FAILED);
  fake.fail_write = true;
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_WRITE_FAILED);
  fake.fail_write = false;
  fake.corrupt_write = true;
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_VERIFY_FAILED);
}

static void test_recovers_from_one_corrupt_copy(void) {
  FakeStore fake = {0};
  provision(&fake, 0x33u, 4u);
  uint8_t newer[MULTIPLEX_ENTROPY_SEED_SIZE];
  memset(newer, 0x44, sizeof(newer));
  assert(multiplex_entropy_seed_record_encode(
      fake.records[1], sizeof(fake.records[1]), newer, 5u));
  fake.records[1][18] ^= 0x01u;
  const MultiplexEntropySeedStore store = seed_store(&fake);
  uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  assert(multiplex_entropy_seed_rotate(&store, derive, NULL, boot_seed) ==
         MULTIPLEX_ENTROPY_SEED_OK);
  assert(boot_seed[0] == (uint8_t)(0x33u ^ 0xa5u));
}

int main(void) {
  test_rotates_and_preserves_previous_copy();
  test_deterministic_fail_closed_paths();
  test_recovers_from_one_corrupt_copy();
  puts("GameCube entropy seed tests passed.");
  return 0;
}
