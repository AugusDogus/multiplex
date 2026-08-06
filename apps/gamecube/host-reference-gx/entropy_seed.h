#ifndef MULTIPLEX_ENTROPY_SEED_H
#define MULTIPLEX_ENTROPY_SEED_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_ENTROPY_SEED_SIZE 32u
#define MULTIPLEX_ENTROPY_RECORD_SIZE 48u

typedef bool (*MultiplexEntropySeedRead)(void *context, unsigned index,
                                        uint8_t *record, size_t size);
typedef bool (*MultiplexEntropySeedWrite)(void *context, unsigned index,
                                         const uint8_t *record, size_t size);
typedef bool (*MultiplexEntropySeedDerive)(
    void *context, const uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t next_seed[MULTIPLEX_ENTROPY_SEED_SIZE]);

typedef struct {
  void *context;
  MultiplexEntropySeedRead read;
  MultiplexEntropySeedWrite write;
} MultiplexEntropySeedStore;

typedef enum {
  MULTIPLEX_ENTROPY_SEED_OK = 0,
  MULTIPLEX_ENTROPY_SEED_INVALID_ARGUMENT,
  MULTIPLEX_ENTROPY_SEED_READ_FAILED,
  MULTIPLEX_ENTROPY_SEED_MISSING,
  MULTIPLEX_ENTROPY_SEED_CORRUPT,
  MULTIPLEX_ENTROPY_SEED_DERIVE_FAILED,
  MULTIPLEX_ENTROPY_SEED_WRITE_FAILED,
  MULTIPLEX_ENTROPY_SEED_VERIFY_FAILED,
} MultiplexEntropySeedResult;

bool multiplex_entropy_seed_record_encode(
    uint8_t *record, size_t size,
    const uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE], uint32_t generation);
bool multiplex_entropy_seed_record_decode(
    const uint8_t *record, size_t size,
    uint8_t seed[MULTIPLEX_ENTROPY_SEED_SIZE], uint32_t *generation);
MultiplexEntropySeedResult multiplex_entropy_seed_rotate(
    const MultiplexEntropySeedStore *store, MultiplexEntropySeedDerive derive,
    void *derive_context,
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE]);
const char *multiplex_entropy_seed_result_message(
    MultiplexEntropySeedResult result);

#endif
