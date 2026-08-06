#include "entropy_seed.h"

#include <string.h>

#define ENTROPY_RECORD_VERSION 1u
#define ENTROPY_RECORD_HEADER_SIZE 12u

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

static uint16_t read_be16(const uint8_t *source) {
  return (uint16_t)(((uint16_t)source[0] << 8u) | source[1]);
}

static uint32_t read_be32(const uint8_t *source) {
  return ((uint32_t)source[0] << 24u) | ((uint32_t)source[1] << 16u) |
         ((uint32_t)source[2] << 8u) | source[3];
}

static uint32_t crc32(const uint8_t *bytes, size_t size) {
  uint32_t crc = UINT32_MAX;
  for (size_t index = 0; index < size; ++index) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8u; ++bit) {
      const uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
      crc = (crc >> 1u) ^ (UINT32_C(0xedb88320) & mask);
    }
  }
  return ~crc;
}

static bool generation_is_newer(uint32_t candidate, uint32_t current) {
  const uint32_t distance = candidate - current;
  return distance != 0 && distance < UINT32_C(0x80000000);
}

static bool record_is_empty(const uint8_t *record) {
  for (size_t index = 0; index < MULTIPLEX_ENTROPY_RECORD_SIZE; ++index) {
    if (record[index] != 0) {
      return false;
    }
  }
  return true;
}

static bool constant_time_equal(const uint8_t *left, const uint8_t *right,
                                size_t size) {
  uint8_t difference = 0;
  for (size_t index = 0; index < size; ++index) {
    difference |= left[index] ^ right[index];
  }
  return difference == 0;
}

static void clear_bytes(void *bytes, size_t size) {
  volatile uint8_t *cursor = bytes;
  while (size-- > 0) {
    *cursor++ = 0;
  }
}

bool multiplex_entropy_seed_record_encode(
    uint8_t *record, size_t size,
    const uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE], uint32_t generation) {
  if (record == NULL || seed == NULL ||
      size < MULTIPLEX_ENTROPY_RECORD_SIZE) {
    return false;
  }
  memset(record, 0, MULTIPLEX_ENTROPY_RECORD_SIZE);
  memcpy(record, "MPXR", 4u);
  write_be16(record + 4u, ENTROPY_RECORD_VERSION);
  write_be16(record + 6u, ENTROPY_RECORD_HEADER_SIZE);
  write_be32(record + 8u, generation);
  memcpy(record + ENTROPY_RECORD_HEADER_SIZE, seed,
         MULTIPLEX_ENTROPY_SEED_SIZE);
  write_be32(record + 44u, crc32(record, 44u));
  return true;
}

bool multiplex_entropy_seed_record_decode(
    const uint8_t *record, size_t size,
    uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE], uint32_t *generation) {
  if (record == NULL || seed == NULL || generation == NULL ||
      size < MULTIPLEX_ENTROPY_RECORD_SIZE || memcmp(record, "MPXR", 4u) != 0 ||
      read_be16(record + 4u) != ENTROPY_RECORD_VERSION ||
      read_be16(record + 6u) != ENTROPY_RECORD_HEADER_SIZE ||
      crc32(record, 44u) != read_be32(record + 44u)) {
    return false;
  }
  memcpy(seed, record + ENTROPY_RECORD_HEADER_SIZE,
         MULTIPLEX_ENTROPY_SEED_SIZE);
  *generation = read_be32(record + 8u);
  return true;
}

MultiplexEntropySeedResult multiplex_entropy_seed_rotate(
    const MultiplexEntropySeedStore *store, MultiplexEntropySeedDerive derive,
    void *derive_context,
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE]) {
  if (store == NULL || store->read == NULL || store->write == NULL ||
      derive == NULL || boot_seed == NULL) {
    return MULTIPLEX_ENTROPY_SEED_INVALID_ARGUMENT;
  }

  uint8_t records[2][MULTIPLEX_ENTROPY_RECORD_SIZE] = {{0}};
  if (!store->read(store->context, 0u, records[0], sizeof(records[0])) ||
      !store->read(store->context, 1u, records[1], sizeof(records[1]))) {
    clear_bytes(records, sizeof(records));
    return MULTIPLEX_ENTROPY_SEED_READ_FAILED;
  }
  uint8_t seeds[2][MULTIPLEX_ENTROPY_SEED_SIZE];
  uint32_t generations[2] = {0, 0};
  const bool valid[2] = {
      multiplex_entropy_seed_record_decode(records[0], sizeof(records[0]),
                                           seeds[0], &generations[0]),
      multiplex_entropy_seed_record_decode(records[1], sizeof(records[1]),
                                           seeds[1], &generations[1]),
  };
  if (!valid[0] && !valid[1]) {
    const MultiplexEntropySeedResult result =
        record_is_empty(records[0]) && record_is_empty(records[1])
            ? MULTIPLEX_ENTROPY_SEED_MISSING
            : MULTIPLEX_ENTROPY_SEED_CORRUPT;
    clear_bytes(records, sizeof(records));
    clear_bytes(seeds, sizeof(seeds));
    return result;
  }

  const unsigned current =
      valid[1] && (!valid[0] ||
                   generation_is_newer(generations[1], generations[0]))
          ? 1u
          : 0u;
  const unsigned target = current ^ 1u;
  uint8_t next_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  if (!derive(derive_context, seeds[current], boot_seed, next_seed)) {
    clear_bytes(records, sizeof(records));
    clear_bytes(seeds, sizeof(seeds));
    clear_bytes(next_seed, sizeof(next_seed));
    clear_bytes(boot_seed, MULTIPLEX_ENTROPY_SEED_SIZE);
    return MULTIPLEX_ENTROPY_SEED_DERIVE_FAILED;
  }

  uint8_t next_record[MULTIPLEX_ENTROPY_RECORD_SIZE];
  const uint32_t next_generation = generations[current] + 1u;
  if (!multiplex_entropy_seed_record_encode(next_record, sizeof(next_record),
                                            next_seed, next_generation) ||
      !store->write(store->context, target, next_record,
                    sizeof(next_record))) {
    clear_bytes(records, sizeof(records));
    clear_bytes(seeds, sizeof(seeds));
    clear_bytes(next_seed, sizeof(next_seed));
    clear_bytes(next_record, sizeof(next_record));
    clear_bytes(boot_seed, MULTIPLEX_ENTROPY_SEED_SIZE);
    return MULTIPLEX_ENTROPY_SEED_WRITE_FAILED;
  }

  uint8_t verification[MULTIPLEX_ENTROPY_RECORD_SIZE];
  uint8_t verified_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  uint32_t verified_generation = 0;
  const bool verified =
      store->read(store->context, target, verification, sizeof(verification)) &&
      multiplex_entropy_seed_record_decode(
          verification, sizeof(verification), verified_seed,
          &verified_generation) &&
      verified_generation == next_generation &&
      constant_time_equal(verified_seed, next_seed, sizeof(next_seed));
  clear_bytes(records, sizeof(records));
  clear_bytes(seeds, sizeof(seeds));
  clear_bytes(next_seed, sizeof(next_seed));
  clear_bytes(next_record, sizeof(next_record));
  clear_bytes(verification, sizeof(verification));
  clear_bytes(verified_seed, sizeof(verified_seed));
  if (!verified) {
    clear_bytes(boot_seed, MULTIPLEX_ENTROPY_SEED_SIZE);
    return MULTIPLEX_ENTROPY_SEED_VERIFY_FAILED;
  }
  return MULTIPLEX_ENTROPY_SEED_OK;
}

const char *multiplex_entropy_seed_result_message(
    MultiplexEntropySeedResult result) {
  switch (result) {
    case MULTIPLEX_ENTROPY_SEED_OK:
      return "ready";
    case MULTIPLEX_ENTROPY_SEED_INVALID_ARGUMENT:
      return "invalid entropy seed configuration";
    case MULTIPLEX_ENTROPY_SEED_READ_FAILED:
      return "entropy seed could not be read";
    case MULTIPLEX_ENTROPY_SEED_MISSING:
      return "entropy seed is missing; provision Multiplex TLS Entropy.gci";
    case MULTIPLEX_ENTROPY_SEED_CORRUPT:
      return "both entropy seed copies are corrupt; reprovision the seed";
    case MULTIPLEX_ENTROPY_SEED_DERIVE_FAILED:
      return "entropy seed derivation failed";
    case MULTIPLEX_ENTROPY_SEED_WRITE_FAILED:
      return "rotated entropy seed could not be written";
    case MULTIPLEX_ENTROPY_SEED_VERIFY_FAILED:
      return "rotated entropy seed could not be verified";
  }
  return "unknown entropy seed failure";
}
