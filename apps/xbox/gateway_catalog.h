#ifndef MULTIPLEX_XBOX_GATEWAY_CATALOG_H
#define MULTIPLEX_XBOX_GATEWAY_CATALOG_H

#include "http.h"

#include <stdbool.h>
#include <stdint.h>

#define MULTIPLEX_XBOX_CATALOG_MAX_ROWS 3u
#define MULTIPLEX_XBOX_CATALOG_MAX_ITEMS 4u
#define MULTIPLEX_XBOX_CATALOG_SERVER_CAPACITY 64u
#define MULTIPLEX_XBOX_CATALOG_TITLE_CAPACITY 96u
#define MULTIPLEX_XBOX_CATALOG_SUBTITLE_CAPACITY 96u

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  char title[MULTIPLEX_XBOX_CATALOG_TITLE_CAPACITY];
  char subtitle[MULTIPLEX_XBOX_CATALOG_SUBTITLE_CAPACITY];
} MultiplexXboxCatalogItem;

typedef struct {
  char title[MULTIPLEX_XBOX_CATALOG_TITLE_CAPACITY];
  uint16_t item_count;
  MultiplexXboxCatalogItem items[MULTIPLEX_XBOX_CATALOG_MAX_ITEMS];
} MultiplexXboxCatalogRow;

typedef struct {
  char server_name[MULTIPLEX_XBOX_CATALOG_SERVER_CAPACITY];
  uint16_t row_count;
  MultiplexXboxCatalogRow rows[MULTIPLEX_XBOX_CATALOG_MAX_ROWS];
} MultiplexXboxCatalog;

bool multiplex_xbox_catalog_load(const char *base_url,
                                 const char *session_token,
                                 MultiplexXboxHttpRequest request,
                                 void *request_context,
                                 MultiplexXboxCatalog *catalog);

#endif
