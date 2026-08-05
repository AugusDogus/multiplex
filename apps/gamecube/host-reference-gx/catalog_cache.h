#ifndef MULTIPLEX_CATALOG_CACHE_H
#define MULTIPLEX_CATALOG_CACHE_H

#include "gateway_client.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_CATALOG_CACHE_SIZE 2048u

bool multiplex_catalog_cache_encode(
    uint8_t destination[MULTIPLEX_CATALOG_CACHE_SIZE],
    const MultiplexGatewayCatalog *catalog);
bool multiplex_catalog_cache_decode(
    const uint8_t source[MULTIPLEX_CATALOG_CACHE_SIZE],
    MultiplexGatewayCatalog *catalog);

#endif
