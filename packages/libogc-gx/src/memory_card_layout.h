#ifndef MULTIPLEX_MEMORY_CARD_LAYOUT_H
#define MULTIPLEX_MEMORY_CARD_LAYOUT_H

#include <stddef.h>

#define MULTIPLEX_CARD_AUTH_OFFSET 2560u
#define MULTIPLEX_CARD_CACHE_OFFSET 6144u

static inline size_t
multiplex_memory_card_first_record_capacity(size_t sector_size) {
  if (sector_size <= MULTIPLEX_CARD_AUTH_OFFSET) {
    return 0;
  }
  const size_t available = sector_size - MULTIPLEX_CARD_AUTH_OFFSET;
  const size_t maximum =
      MULTIPLEX_CARD_CACHE_OFFSET - MULTIPLEX_CARD_AUTH_OFFSET;
  return available < maximum ? available : maximum;
}

#endif
