#ifndef MULTIPLEX_DREAMCAST_GATEWAY_CLIENT_H
#define MULTIPLEX_DREAMCAST_GATEWAY_CLIENT_H

#include "gateway_protocol.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool dreamcast_gateway_load_catalog(const char *base_url,
                                    DreamcastGatewayCatalog *catalog,
                                    char *error, size_t error_capacity);
bool dreamcast_gateway_load_playback(const char *base_url, uint32_t rating_key,
                                     uint32_t offset_ms,
                                     DreamcastGatewayPlayback *playback,
                                     char *error, size_t error_capacity);
bool dreamcast_gateway_download_media(const DreamcastGatewayPlayback *playback,
                                      const char *path, char *error,
                                      size_t error_capacity);
bool dreamcast_gateway_report_timeline(const char *base_url,
                                       uint32_t rating_key,
                                       uint32_t position_ms,
                                       uint32_t duration_ms, const char *state);

#endif
