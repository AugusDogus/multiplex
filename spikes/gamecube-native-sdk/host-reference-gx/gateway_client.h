#ifndef MULTIPLEX_GATEWAY_CLIENT_H
#define MULTIPLEX_GATEWAY_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_GATEWAY_MAX_ITEMS 4
#define MULTIPLEX_GATEWAY_MAX_ROWS 3
#define MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS \
  (MULTIPLEX_GATEWAY_MAX_ITEMS * MULTIPLEX_GATEWAY_MAX_ROWS)
#define MULTIPLEX_GATEWAY_SERVER_CAPACITY 64
#define MULTIPLEX_GATEWAY_TITLE_CAPACITY 96
#define MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY 96
#define MULTIPLEX_GATEWAY_ARTWORK_WIDTH 80
#define MULTIPLEX_GATEWAY_ARTWORK_HEIGHT 120
#define MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES \
  (MULTIPLEX_GATEWAY_ARTWORK_WIDTH * MULTIPLEX_GATEWAY_ARTWORK_HEIGHT * 2)

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
  char subtitle[MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY];
  uint16_t subtitle_length;
  uint16_t artwork_slot;
  uint8_t progress_percent;
} MultiplexGatewayItem;

typedef struct {
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
  uint16_t item_count;
  uint16_t item_offset;
} MultiplexGatewayRow;

typedef struct {
  uint16_t version;
  uint16_t row_count;
  uint16_t total_item_count;
  char server_name[MULTIPLEX_GATEWAY_SERVER_CAPACITY];
  uint16_t server_name_length;
  MultiplexGatewayRow rows[MULTIPLEX_GATEWAY_MAX_ROWS];
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
} MultiplexGatewayCatalog;

bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog);
bool multiplex_gateway_load_artwork(const char *base_url,
                                    uint8_t *destination, size_t capacity,
                                    size_t *encoded_size);

#endif
