#ifndef MULTIPLEX_GATEWAY_CLIENT_H
#define MULTIPLEX_GATEWAY_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_GATEWAY_MAX_ITEMS 4
#define MULTIPLEX_GATEWAY_MAX_HOME_ITEMS 8
#define MULTIPLEX_GATEWAY_MAX_ROWS 3
#define MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS \
  (MULTIPLEX_GATEWAY_MAX_HOME_ITEMS * MULTIPLEX_GATEWAY_MAX_ROWS)
#define MULTIPLEX_GATEWAY_MAX_LIBRARIES 8
#define MULTIPLEX_GATEWAY_SERVER_CAPACITY 64
#define MULTIPLEX_GATEWAY_TITLE_CAPACITY 96
#define MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY 96
#define MULTIPLEX_GATEWAY_ARTWORK_PATH_CAPACITY 256
#define MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY 25
#define MULTIPLEX_GATEWAY_DETAIL_TYPE_CAPACITY 32
#define MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY 128
#define MULTIPLEX_GATEWAY_DETAIL_SUMMARY_CAPACITY 384
#define MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY 768
#define MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS 4
#define MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY 64
#define MULTIPLEX_GATEWAY_SUBTITLE_CODEC_CAPACITY 16
#define MULTIPLEX_GATEWAY_PAIRING_CODE_CAPACITY 5
#define MULTIPLEX_GATEWAY_PAIRING_URL_CAPACITY 256
#define MULTIPLEX_GATEWAY_ARTWORK_WIDTH 96
#define MULTIPLEX_GATEWAY_ARTWORK_HEIGHT 144
#define MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES \
  (MULTIPLEX_GATEWAY_ARTWORK_WIDTH * MULTIPLEX_GATEWAY_ARTWORK_HEIGHT * 2)

typedef struct {
  uint32_t id;
  uint32_t index;
  char label[MULTIPLEX_GATEWAY_SUBTITLE_LABEL_CAPACITY];
  char codec[MULTIPLEX_GATEWAY_SUBTITLE_CODEC_CAPACITY];
  bool has_index;
  bool selected;
} MultiplexGatewaySubtitleStream;

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
  char subtitle[MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY];
  uint16_t subtitle_length;
  char artwork_path[MULTIPLEX_GATEWAY_ARTWORK_PATH_CAPACITY];
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
  uint16_t section_id;
  uint8_t media_type;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
} MultiplexGatewayLibrary;

typedef struct {
  uint16_t version;
  uint16_t row_count;
  uint16_t total_item_count;
  uint16_t library_count;
  char server_name[MULTIPLEX_GATEWAY_SERVER_CAPACITY];
  uint16_t server_name_length;
  MultiplexGatewayRow rows[MULTIPLEX_GATEWAY_MAX_ROWS];
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  MultiplexGatewayLibrary libraries[MULTIPLEX_GATEWAY_MAX_LIBRARIES];
} MultiplexGatewayCatalog;

typedef struct {
  uint16_t version;
  uint16_t section_id;
  uint16_t item_count;
  uint16_t start;
  uint16_t total_size;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_ITEMS];
} MultiplexGatewayBrowsePage;

typedef struct {
  uint16_t version;
  uint16_t item_count;
  char query[MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY];
  uint16_t query_length;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_ITEMS];
} MultiplexGatewaySearchPage;

typedef struct {
  uint16_t version;
  uint16_t item_count;
  uint16_t start;
  uint16_t total_size;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_ITEMS];
} MultiplexGatewayChildrenPage;

typedef struct {
  uint16_t version;
  uint16_t flags;
  uint32_t rating_key;
  uint32_t parent_rating_key;
  uint32_t grandparent_rating_key;
  uint32_t parent_index;
  uint32_t index;
  uint32_t duration_ms;
  uint32_t view_offset_ms;
  uint16_t year;
  uint16_t rating_tenths;
  char title[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t title_length;
  char secondary[MULTIPLEX_GATEWAY_SUBTITLE_CAPACITY];
  uint16_t secondary_length;
  char media_type[MULTIPLEX_GATEWAY_DETAIL_TYPE_CAPACITY];
  uint16_t media_type_length;
  char library[MULTIPLEX_GATEWAY_TITLE_CAPACITY];
  uint16_t library_length;
  char content_rating[MULTIPLEX_GATEWAY_DETAIL_TYPE_CAPACITY];
  uint16_t content_rating_length;
  char summary[MULTIPLEX_GATEWAY_DETAIL_SUMMARY_CAPACITY];
  uint16_t summary_length;
  char genres[MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY];
  uint16_t genres_length;
  char directors[MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY];
  uint16_t directors_length;
  uint8_t subtitle_stream_count;
  MultiplexGatewaySubtitleStream
      subtitle_streams[MULTIPLEX_GATEWAY_MAX_SUBTITLE_STREAMS];
} MultiplexGatewayDetails;

typedef struct {
  uint16_t version;
  uint16_t flags;
  uint32_t rating_key;
  uint32_t media_duration_ms;
  uint32_t segment_start_ms;
  uint32_t segment_duration_ms;
  uint32_t container_bytes;
  uint32_t video_bytes;
  uint32_t audio_bytes;
  uint32_t video_packets;
  uint32_t audio_packets;
  int64_t first_video_pts90k;
  int64_t first_audio_pts90k;
  uint32_t subtitle_stream_index;
  bool burn_subtitles;
  char media_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
} MultiplexGatewayPlaybackManifest;

typedef struct {
  uint16_t version;
  uint16_t status;
  char code[MULTIPLEX_GATEWAY_PAIRING_CODE_CAPACITY];
  uint16_t code_length;
  char link_url[MULTIPLEX_GATEWAY_PAIRING_URL_CAPACITY];
  uint16_t link_url_length;
} MultiplexGatewayPairing;

bool multiplex_gateway_load_pairing(const char *base_url,
                                    MultiplexGatewayPairing *pairing);
bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog);
bool multiplex_gateway_load_artwork(const char *base_url,
                                    uint8_t *destination, size_t capacity,
                                    size_t *encoded_size);
bool multiplex_gateway_load_browse(const char *base_url, uint16_t section_id,
                                   uint16_t start,
                                   MultiplexGatewayBrowsePage *page);
bool multiplex_gateway_load_browse_artwork(
    const char *base_url, uint16_t section_id, uint16_t start,
    uint8_t *destination, size_t capacity, size_t *encoded_size);
bool multiplex_gateway_load_search(const char *base_url, const char *query,
                                   uint16_t query_length,
                                   MultiplexGatewaySearchPage *page);
bool multiplex_gateway_load_search_artwork(
    const char *base_url, const char *query, uint16_t query_length,
    uint8_t *destination, size_t capacity, size_t *encoded_size);
bool multiplex_gateway_load_details(const char *base_url, uint32_t rating_key,
                                    MultiplexGatewayDetails *details);
bool multiplex_gateway_load_playback_manifest(
    const char *base_url, uint32_t rating_key, uint32_t offset_ms,
    MultiplexGatewayPlaybackManifest *manifest);
bool multiplex_gateway_report_timeline(
    const char *base_url, uint32_t rating_key, uint32_t position_ms,
    uint32_t duration_ms, const char *state);

#endif
