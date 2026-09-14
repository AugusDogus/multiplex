#ifndef MULTIPLEX_DREAMCAST_GATEWAY_PROTOCOL_H
#define MULTIPLEX_DREAMCAST_GATEWAY_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
  DREAMCAST_GATEWAY_MAX_ITEMS = 4,
  DREAMCAST_GATEWAY_SERVER_CAPACITY = 64,
  DREAMCAST_GATEWAY_TITLE_CAPACITY = 48,
  DREAMCAST_GATEWAY_SUBTITLE_CAPACITY = 48,
  DREAMCAST_GATEWAY_MEDIA_URL_CAPACITY = 768,
  DREAMCAST_GATEWAY_MESSAGE_CAPACITY = 96,
};

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  char title[DREAMCAST_GATEWAY_TITLE_CAPACITY];
  char subtitle[DREAMCAST_GATEWAY_SUBTITLE_CAPACITY];
} DreamcastGatewayItem;

typedef struct {
  char server_name[DREAMCAST_GATEWAY_SERVER_CAPACITY];
  uint16_t item_count;
  DreamcastGatewayItem items[DREAMCAST_GATEWAY_MAX_ITEMS];
} DreamcastGatewayCatalog;

typedef struct {
  uint32_t rating_key;
  uint32_t media_duration_ms;
  uint32_t segment_start_ms;
  uint32_t segment_duration_ms;
  uint32_t container_bytes;
  char media_url[DREAMCAST_GATEWAY_MEDIA_URL_CAPACITY];
} DreamcastGatewayPlayback;

bool dreamcast_gateway_parse_catalog(const uint8_t *bytes, size_t size,
                                     DreamcastGatewayCatalog *catalog);
bool dreamcast_gateway_parse_playback(const uint8_t *bytes, size_t size,
                                      const char *base_url,
                                      DreamcastGatewayPlayback *playback);

#endif
