#ifndef MULTIPLEX_HLS_PLAYLIST_H
#define MULTIPLEX_HLS_PLAYLIST_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define HLS_URI_CAPACITY 512u
#define HLS_MAX_SEGMENTS 32u

typedef struct {
  char uri[HLS_URI_CAPACITY];
  uint32_t bandwidth;
  unsigned width;
  unsigned height;
  uint32_t frame_rate_millihertz;
} HlsVariant;

typedef struct {
  char uri[HLS_URI_CAPACITY];
  uint32_t duration_ms;
  uint32_t sequence;
} HlsSegment;

typedef struct {
  HlsSegment segments[HLS_MAX_SEGMENTS];
  size_t segment_count;
  uint32_t media_sequence;
  uint32_t target_duration_seconds;
  bool end_list;
} HlsMediaPlaylist;

bool hls_playlist_parse_master(const char *text, size_t size,
                               HlsVariant *variant);
bool hls_playlist_parse_media(const char *text, size_t size,
                              HlsMediaPlaylist *playlist);

/*
 * Resolves HTTP, root-relative, and same-directory HLS URIs. HTTPS is
 * intentionally rejected because libogc2's BBA client currently speaks HTTP.
 */
bool hls_playlist_resolve_url(const char *base_url, const char *uri,
                              char *destination, size_t capacity);

#endif
