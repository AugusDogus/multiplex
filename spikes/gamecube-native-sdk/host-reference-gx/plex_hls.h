#ifndef MULTIPLEX_PLEX_HLS_H
#define MULTIPLEX_PLEX_HLS_H

#include "auth_record.h"
#include "hls_playlist.h"

#include <stdbool.h>
#include <stdint.h>

#define MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY 37u
#define MULTIPLEX_PLEX_HLS_URL_CAPACITY 1024u

typedef struct {
  char session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
  char master_url[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  char variant_url[MULTIPLEX_PLEX_HLS_URL_CAPACITY];
  HlsVariant variant;
  uint32_t next_sequence;
  bool started;
} MultiplexPlexHlsSession;

bool multiplex_plex_hls_start(const MultiplexAuthCredentials *credentials,
                              uint32_t rating_key, uint32_t offset_ms,
                              MultiplexPlexHlsSession *session);
bool multiplex_plex_hls_refresh(
    const MultiplexAuthCredentials *credentials,
    MultiplexPlexHlsSession *session, HlsMediaPlaylist *playlist);
void multiplex_plex_hls_stop(const MultiplexAuthCredentials *credentials,
                             MultiplexPlexHlsSession *session);

#endif
