#ifndef MULTIPLEX_MEMORY_CARD_ENTROPY_H
#define MULTIPLEX_MEMORY_CARD_ENTROPY_H

#include "entropy_seed.h"

#include <stdint.h>

MultiplexEntropySeedResult multiplex_memory_card_rotate_entropy(
    const uint8_t additional[MULTIPLEX_ENTROPY_SEED_SIZE],
    uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE]);

#endif
