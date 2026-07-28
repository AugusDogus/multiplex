#ifndef MULTIPLEX_PLEX_CATALOG_H
#define MULTIPLEX_PLEX_CATALOG_H

#include "auth_record.h"
#include "gateway_client.h"

#include <stdbool.h>
#include <stddef.h>

bool multiplex_plex_catalog_parse_hubs(const char *json, size_t size,
                                       MultiplexGatewayCatalog *catalog);
bool multiplex_plex_catalog_parse_libraries(const char *json, size_t size,
                                            MultiplexGatewayCatalog *catalog);
bool multiplex_plex_load_catalog(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayCatalog *catalog);

#endif
