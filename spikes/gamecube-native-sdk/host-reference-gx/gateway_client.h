#ifndef MULTIPLEX_GATEWAY_CLIENT_H
#define MULTIPLEX_GATEWAY_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_GATEWAY_MAX_ITEMS 4
#define MULTIPLEX_GATEWAY_SERVER_CAPACITY 64
#define MULTIPLEX_GATEWAY_TITLE_CAPACITY 96

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
} MultiplexGatewayItem;

typedef struct {
  uint16_t version;
  uint16_t item_count;
  char server_name[MULTIPLEX_GATEWAY_SERVER_CAPACITY];
  uint16_t server_name_length;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_ITEMS];
} MultiplexGatewayCatalog;

bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog);

#endif
