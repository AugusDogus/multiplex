#ifndef MULTIPLEX_PLEX_CATALOG_H
#define MULTIPLEX_PLEX_CATALOG_H

#include "auth_record.h"
#include "gateway_client.h"
#include "http_cancellation.h"

#include <stdbool.h>
#include <stddef.h>

typedef enum {
  MULTIPLEX_PLEX_NEXT_EPISODE_ERROR = -1,
  MULTIPLEX_PLEX_NEXT_EPISODE_NONE = 0,
  MULTIPLEX_PLEX_NEXT_EPISODE_FOUND = 1,
} MultiplexPlexNextEpisodeResult;

bool multiplex_plex_catalog_parse_hubs(const char *json, size_t size,
                                       MultiplexGatewayCatalog *catalog);
bool multiplex_plex_catalog_parse_libraries(const char *json, size_t size,
                                            MultiplexGatewayCatalog *catalog);
bool multiplex_plex_catalog_parse_browse(const char *json, size_t size,
                                         const MultiplexGatewayLibrary *library,
                                         uint16_t start,
                                         MultiplexGatewayBrowsePage *page);
bool multiplex_plex_catalog_parse_details(const char *json, size_t size,
                                          MultiplexGatewayDetails *details);
bool multiplex_plex_catalog_parse_children(const char *json, size_t size,
                                           uint16_t start,
                                           MultiplexGatewayChildrenPage *page);
bool multiplex_plex_catalog_parse_search(const char *json, size_t size,
                                         const char *query,
                                         uint16_t query_length,
                                         MultiplexGatewaySearchPage *page);
bool multiplex_plex_load_catalog(const MultiplexAuthCredentials *credentials,
                                 MultiplexGatewayCatalog *catalog);
bool multiplex_plex_load_catalog_cancellable(
    const MultiplexAuthCredentials *credentials,
    MultiplexGatewayCatalog *catalog,
    const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_load_browse(const MultiplexAuthCredentials *credentials,
                                const MultiplexGatewayLibrary *library,
                                uint16_t start,
                                MultiplexGatewayBrowsePage *page);
bool multiplex_plex_load_browse_cancellable(
    const MultiplexAuthCredentials *credentials,
    const MultiplexGatewayLibrary *library, uint16_t start,
    MultiplexGatewayBrowsePage *page,
    const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_load_details(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key,
                                 MultiplexGatewayDetails *details);
bool multiplex_plex_load_details_cancellable(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayDetails *details,
    const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_load_children(const MultiplexAuthCredentials *credentials,
                                  uint32_t rating_key, uint16_t start,
                                  MultiplexGatewayChildrenPage *page);
MultiplexPlexNextEpisodeResult
multiplex_plex_load_next_episode(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key,
                                 MultiplexGatewayItem *episode);
MultiplexPlexNextEpisodeResult multiplex_plex_load_previous_episode(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayItem *episode);
bool multiplex_plex_load_search(const MultiplexAuthCredentials *credentials,
                                const char *query, uint16_t query_length,
                                MultiplexGatewaySearchPage *page);
bool multiplex_plex_load_search_cancellable(
    const MultiplexAuthCredentials *credentials, const char *query,
    uint16_t query_length, MultiplexGatewaySearchPage *page,
    const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_load_artwork(const MultiplexAuthCredentials *credentials,
                                 const char *artwork_path, uint8_t *destination,
                                 size_t capacity, size_t *encoded_size);
bool multiplex_plex_load_artwork_cancellable(
    const MultiplexAuthCredentials *credentials, const char *artwork_path,
    uint8_t *destination, size_t capacity, size_t *encoded_size,
    const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_report_timeline(const MultiplexAuthCredentials *credentials,
                                    const char *session_id, uint32_t rating_key,
                                    uint32_t position_ms, uint32_t duration_ms,
                                    const char *state);
bool multiplex_plex_report_timeline_cancellable(
    const MultiplexAuthCredentials *credentials, const char *session_id,
    uint32_t rating_key, uint32_t position_ms, uint32_t duration_ms,
    const char *state, const MultiplexHttpCancellation *cancellation);
bool multiplex_plex_mark_watched(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key);

#endif
