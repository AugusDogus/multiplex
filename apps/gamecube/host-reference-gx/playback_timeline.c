#include "playback_timeline.h"

#include "plex_catalog.h"

#include <gccore.h>
#include <ogc/lwp.h>
#include <stdlib.h>
#include <string.h>

#define TIMELINE_REPORT_STACK_SIZE (128u * 1024u)

typedef struct {
  PlaybackTimelineRoute route;
  PlaybackTimelineState state;
  uint32_t rating_key;
  uint32_t position_ms;
  uint32_t duration_ms;
  lwp_t thread;
  void *stack;
  volatile bool complete;
  volatile bool succeeded;
} PlaybackTimelineRequest;

struct PlaybackTimeline {
  PlaybackTimelineRequest request;
  PlaybackTimelineCursor cursor;
};

static const char *timeline_state_name(PlaybackTimelineState state) {
  switch (state) {
  case PLAYBACK_TIMELINE_STATE_STOPPED:
    return "stopped";
  case PLAYBACK_TIMELINE_STATE_PAUSED:
    return "paused";
  case PLAYBACK_TIMELINE_STATE_PLAYING:
    return "playing";
  }
  return "stopped";
}

static bool dispatch_request(const PlaybackTimelineRequest *request) {
  const char *state = timeline_state_name(request->state);
  switch (request->route.kind) {
  case PLAYBACK_TIMELINE_ROUTE_NONE:
    return false;
  case PLAYBACK_TIMELINE_ROUTE_GATEWAY:
    return multiplex_gateway_report_timeline(
        request->route.value.gateway_url, request->rating_key,
        request->position_ms, request->duration_ms, state);
  case PLAYBACK_TIMELINE_ROUTE_PLEX:
    return multiplex_plex_report_timeline(
        &request->route.value.plex.credentials,
        request->route.value.plex.session_id, request->rating_key,
        request->position_ms, request->duration_ms, state);
  }
  return false;
}

static void *run_request(void *context) {
  PlaybackTimelineRequest *request = context;
  request->succeeded = dispatch_request(request);
  request->complete = true;
  return NULL;
}

static void finish_request(PlaybackTimelineRequest *request) {
  if (request->thread != LWP_THREAD_NULL) {
    LWP_JoinThread(request->thread, NULL);
    request->thread = LWP_THREAD_NULL;
  }
  free(request->stack);
  request->stack = NULL;
  request->complete = false;
}

static bool route_valid(const PlaybackTimelineRoute *route) {
  if (route == NULL) {
    return false;
  }
  switch (route->kind) {
  case PLAYBACK_TIMELINE_ROUTE_NONE:
    return false;
  case PLAYBACK_TIMELINE_ROUTE_GATEWAY:
    return route->value.gateway_url[0] != '\0';
  case PLAYBACK_TIMELINE_ROUTE_PLEX:
    return route->value.plex.credentials.plex_server_url[0] != '\0' &&
           route->value.plex.credentials.plex_server_token[0] != '\0' &&
           route->value.plex.session_id[0] != '\0';
  }
  return false;
}

static void record_cursor(PlaybackTimeline *timeline,
                          const PlaybackTimelineItem *item,
                          uint32_t position_ms, PlaybackTimelineState state) {
  timeline->cursor.has_report = true;
  timeline->cursor.rating_key = item->rating_key;
  timeline->cursor.position_ms = position_ms;
  timeline->cursor.state = state;
}

static bool schedule_request(PlaybackTimeline *timeline,
                             const PlaybackTimelineRoute *route,
                             const PlaybackTimelineItem *item,
                             uint32_t position_ms, PlaybackTimelineState state,
                             PlaybackTimelineDue due) {
  PlaybackTimelineRequest *request = &timeline->request;
  if (request->thread != LWP_THREAD_NULL && request->complete) {
    finish_request(request);
  }
  if (request->thread != LWP_THREAD_NULL || !route_valid(route) ||
      item->rating_key == 0 || item->duration_ms == 0 ||
      due == PLAYBACK_TIMELINE_DUE_NONE) {
    return false;
  }

  request->route = *route;
  request->state = state;
  request->rating_key = item->rating_key;
  request->position_ms = position_ms;
  request->duration_ms = item->duration_ms;
  request->stack = malloc(TIMELINE_REPORT_STACK_SIZE);
  if (request->stack == NULL ||
      LWP_CreateThread(&request->thread, run_request, request, request->stack,
                       TIMELINE_REPORT_STACK_SIZE, LWP_PRIO_NORMAL / 2) != 0) {
    free(request->stack);
    request->stack = NULL;
    request->thread = LWP_THREAD_NULL;
    SYS_Report("REFERENCE GX: timeline report allocation failed\n");
    return false;
  }
  record_cursor(timeline, item, position_ms, state);
  SYS_Report("REFERENCE GX: timeline-report queued rating-key=%u position=%u "
             "state=%u\n",
             item->rating_key, position_ms, (unsigned)state);
  return true;
}

static bool dispatch_hls(PlexHlsDemux *demux, const PlaybackTimelineItem *item,
                         uint32_t position_ms, PlaybackTimelineState state,
                         PlaybackTimelineDue due) {
  if (demux == NULL) {
    return false;
  }
  switch (playback_timeline_hls_action(due)) {
  case PLAYBACK_TIMELINE_HLS_NONE:
    return false;
  case PLAYBACK_TIMELINE_HLS_REPORT_NOW:
    return plex_hls_demux_report_timeline_now(demux, position_ms,
                                              item->duration_ms, state);
  case PLAYBACK_TIMELINE_HLS_QUEUE:
    return plex_hls_demux_request_timeline(demux, position_ms,
                                           item->duration_ms, state);
  }
  return false;
}

PlaybackTimeline *playback_timeline_create(void) {
  PlaybackTimeline *timeline = calloc(1, sizeof(*timeline));
  if (timeline != NULL) {
    timeline->request.thread = LWP_THREAD_NULL;
  }
  return timeline;
}

void playback_timeline_destroy(PlaybackTimeline **timeline) {
  if (timeline == NULL || *timeline == NULL) {
    return;
  }
  finish_request(&(*timeline)->request);
  free(*timeline);
  *timeline = NULL;
}

void playback_timeline_route_clear(PlaybackTimelineRoute *route) {
  if (route != NULL) {
    memset(route, 0, sizeof(*route));
  }
}

bool playback_timeline_route_set_gateway(PlaybackTimelineRoute *route,
                                         const char *gateway_url) {
  if (route == NULL || gateway_url == NULL || gateway_url[0] == '\0' ||
      strlen(gateway_url) >= sizeof(route->value.gateway_url)) {
    return false;
  }
  playback_timeline_route_clear(route);
  route->kind = PLAYBACK_TIMELINE_ROUTE_GATEWAY;
  memcpy(route->value.gateway_url, gateway_url, strlen(gateway_url) + 1u);
  return true;
}

bool playback_timeline_route_set_plex(
    PlaybackTimelineRoute *route, const MultiplexAuthCredentials *credentials,
    const char *session_id) {
  if (route == NULL || credentials == NULL || session_id == NULL ||
      session_id[0] == '\0' ||
      strlen(session_id) >= sizeof(route->value.plex.session_id)) {
    return false;
  }
  playback_timeline_route_clear(route);
  route->kind = PLAYBACK_TIMELINE_ROUTE_PLEX;
  route->value.plex.credentials = *credentials;
  memcpy(route->value.plex.session_id, session_id, strlen(session_id) + 1u);
  return true;
}

bool playback_timeline_update(PlaybackTimeline *timeline,
                              const PlaybackTimelineRoute *route,
                              PlexHlsDemux *hls_demux,
                              const PlaybackTimelineItem *item,
                              uint32_t position_ms,
                              PlaybackTimelineState state) {
  if (timeline == NULL || !route_valid(route) || item == NULL ||
      item->rating_key == 0 || item->duration_ms == 0) {
    return false;
  }
  const PlaybackTimelineDue due = playback_timeline_due(
      &timeline->cursor, item->rating_key, position_ms, state, false);
  if (due == PLAYBACK_TIMELINE_DUE_NONE) {
    return false;
  }

  bool scheduled = false;
  switch (route->kind) {
  case PLAYBACK_TIMELINE_ROUTE_NONE:
    return false;
  case PLAYBACK_TIMELINE_ROUTE_GATEWAY:
    scheduled =
        schedule_request(timeline, route, item, position_ms, state, due);
    break;
  case PLAYBACK_TIMELINE_ROUTE_PLEX:
    scheduled = dispatch_hls(hls_demux, item, position_ms, state, due);
    if (scheduled) {
      record_cursor(timeline, item, position_ms, state);
    }
    break;
  }
  return scheduled;
}

void playback_timeline_finish(PlaybackTimeline *timeline,
                              const PlaybackTimelineRoute *route,
                              const PlaybackTimelineItem *item,
                              uint32_t position_ms) {
  if (timeline == NULL) {
    return;
  }
  finish_request(&timeline->request);
  if (!route_valid(route) || item == NULL || item->rating_key == 0 ||
      item->duration_ms == 0) {
    return;
  }
  const PlaybackTimelineDue due =
      playback_timeline_due(&timeline->cursor, item->rating_key, position_ms,
                            PLAYBACK_TIMELINE_STATE_STOPPED, true);
  if (schedule_request(timeline, route, item, position_ms,
                       PLAYBACK_TIMELINE_STATE_STOPPED, due)) {
    finish_request(&timeline->request);
  }
}
