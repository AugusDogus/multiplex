#ifndef MULTIPLEX_PLAYBACK_TIMELINE_H
#define MULTIPLEX_PLAYBACK_TIMELINE_H

#include "auth_record.h"
#include "gateway_client.h"
#include "playback_timeline_policy.h"
#include "plex_hls.h"
#include "plex_hls_demux.h"

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  PLAYBACK_TIMELINE_ROUTE_NONE = 0,
  PLAYBACK_TIMELINE_ROUTE_GATEWAY = 1,
  PLAYBACK_TIMELINE_ROUTE_PLEX = 2,
} PlaybackTimelineRouteKind;

typedef struct {
  PlaybackTimelineRouteKind kind;
  union {
    char gateway_url[MULTIPLEX_GATEWAY_MEDIA_URL_CAPACITY];
    struct {
      MultiplexAuthCredentials credentials;
      char session_id[MULTIPLEX_PLEX_HLS_SESSION_ID_CAPACITY];
    } plex;
  } value;
} PlaybackTimelineRoute;

typedef struct {
  uint32_t rating_key;
  uint32_t duration_ms;
} PlaybackTimelineItem;

typedef struct PlaybackTimeline PlaybackTimeline;

PlaybackTimeline *playback_timeline_create(void);
void playback_timeline_destroy(PlaybackTimeline **timeline);
void playback_timeline_cancel(PlaybackTimeline *timeline);
void playback_timeline_route_clear(PlaybackTimelineRoute *route);
bool playback_timeline_route_set_gateway(PlaybackTimelineRoute *route,
                                         const char *gateway_url);
bool playback_timeline_route_set_plex(
    PlaybackTimelineRoute *route, const MultiplexAuthCredentials *credentials,
    const char *session_id);
bool playback_timeline_update(PlaybackTimeline *timeline,
                              const PlaybackTimelineRoute *route,
                              PlexHlsDemux *hls_demux,
                              const PlaybackTimelineItem *item,
                              uint32_t position_ms,
                              PlaybackTimelineState state);
void playback_timeline_finish(PlaybackTimeline *timeline,
                              const PlaybackTimelineRoute *route,
                              const PlaybackTimelineItem *item,
                              uint32_t position_ms);

#endif
