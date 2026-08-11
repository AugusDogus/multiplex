#include "app_services_content_test_support.h"

#include "native_ui.h"
#include "plex_catalog.h"

#include <assert.h>
#include <string.h>

static MultiplexAuthCredentials test_credentials;
static AppServicesContentTestState state;

AppServicesContentTestState *app_services_content_test_state(void) {
  return &state;
}

void app_services_content_test_reset(void) {
  memset(&state, 0, sizeof(state));
  state.details_load_succeeds = true;
}

const MultiplexAuthCredentials *app_services_content_test_credentials(void) {
  return &test_credentials;
}

uint32_t multiplex_app_services_next_token(MultiplexAppServices *services) {
  return ++services->next_token;
}

bool multiplex_app_services_queue(MultiplexAppServices *services,
                                  const MultiplexAppServicesEffect *effect) {
  assert(services->effect_count < MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY);
  services->effects[services->effect_count++] = *effect;
  return true;
}

bool multiplex_app_services_queue_presentation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPresentationEffect *effect) {
  const MultiplexAppServicesEffect queued = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION,
      .payload.presentation = *effect,
  };
  return multiplex_app_services_queue(services, &queued);
}

bool multiplex_app_services_scheduler_run(MultiplexAppServices *services) {
  if (multiplex_app_services_details_has_queued(services)) {
    services->scheduler.foreground.kind =
        MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE;
    services->scheduler.foreground.state.active.domain =
        MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS;
    return multiplex_app_services_details_schedule_queued(services) !=
           MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  if (multiplex_app_services_playback_has_queued(services)) {
    services->scheduler.foreground.kind =
        MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE;
    services->scheduler.foreground.state.active.domain =
        MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK;
    return multiplex_app_services_playback_schedule_queued(services) !=
           MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  return true;
}

void multiplex_app_services_scheduler_finish_foreground(
    MultiplexAppServices *services,
    MultiplexAppServicesForegroundDomain domain) {
  assert(domain == MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK ||
         domain == MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS ||
         domain == MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY);
  services->scheduler.foreground.kind = MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE;
  if (domain == MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK) {
    ++state.playback_finish_count;
  } else if (domain == MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS) {
    ++state.details_finish_count;
  }
}

bool multiplex_app_services_scheduler_start_posters(
    MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *plan) {
  return services != NULL && plan != NULL;
}

const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services) {
  (void)services;
  return &test_credentials;
}

bool multiplex_plex_load_details(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key,
                                 MultiplexGatewayDetails *details) {
  assert(credentials == &test_credentials);
  if (!state.details_load_succeeds) {
    return false;
  }
  memset(details, 0, sizeof(*details));
  details->rating_key = rating_key;
  details->duration_ms = 60000;
  memcpy(details->title, "Episode", sizeof("Episode"));
  details->title_length = 7;
  return true;
}

bool multiplex_plex_load_children(const MultiplexAuthCredentials *credentials,
                                  uint32_t rating_key, uint16_t start,
                                  MultiplexGatewayChildrenPage *page) {
  assert(credentials == &test_credentials);
  ++state.children_load_count;
  *page = (MultiplexGatewayChildrenPage){
      .version = 1,
      .start = start,
      .total_size = 0,
      .item_count = 0,
  };
  assert(rating_key == 400);
  return true;
}

bool multiplex_plex_mark_watched(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key) {
  assert(credentials == &test_credentials);
  assert(rating_key == 500);
  ++state.mark_watched_count;
  return true;
}

MultiplexPlexNextEpisodeResult
multiplex_plex_load_next_episode(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key,
                                 MultiplexGatewayItem *episode) {
  assert(credentials == &test_credentials);
  assert(rating_key == 100);
  memset(episode, 0, sizeof(*episode));
  episode->rating_key = 200;
  episode->duration_ms = 60000;
  memcpy(episode->title, "Next", sizeof("Next"));
  episode->title_length = 4;
  return MULTIPLEX_PLEX_NEXT_EPISODE_FOUND;
}

MultiplexPlexNextEpisodeResult multiplex_plex_load_previous_episode(
    const MultiplexAuthCredentials *credentials, uint32_t rating_key,
    MultiplexGatewayItem *episode) {
  return multiplex_plex_load_next_episode(credentials, rating_key, episode);
}

uint32_t multiplex_native_app_subtitles(uint32_t count, uint32_t selected,
                                        const uint8_t *labels,
                                        uint32_t label_stride,
                                        const uint8_t *label_lengths) {
  (void)count;
  (void)selected;
  (void)labels;
  (void)label_stride;
  (void)label_lengths;
  return 1;
}

uint32_t multiplex_native_app_subtitle_selection(void) { return 0; }
uint32_t multiplex_native_app_details_children_begin(uint32_t rating_key,
                                                     uint32_t start,
                                                     uint32_t total,
                                                     uint32_t item_count) {
  assert(rating_key == 400);
  assert(start == 3);
  assert(total == 0);
  assert(item_count == 0);
  return 1;
}

uint32_t multiplex_native_app_details_child(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent) {
  (void)item_index;
  (void)rating_key;
  (void)title;
  (void)title_length;
  (void)subtitle;
  (void)subtitle_length;
  (void)artwork_slot;
  (void)duration_ms;
  (void)view_offset_ms;
  (void)progress_percent;
  return 1;
}

uint32_t multiplex_native_app_details_children_commit(void) { return 1; }
uint32_t multiplex_native_app_details_commit(
    const uint8_t *title, uint32_t title_length, const uint8_t *secondary,
    uint32_t secondary_length, const uint8_t *hierarchy,
    uint32_t hierarchy_length, const uint8_t *media_type,
    uint32_t media_type_length, const uint8_t *library, uint32_t library_length,
    const uint8_t *content_rating, uint32_t content_rating_length,
    const uint8_t *facts, uint32_t facts_length, const uint8_t *summary,
    uint32_t summary_length, const uint8_t *genres, uint32_t genres_length,
    const uint8_t *directors, uint32_t directors_length, uint32_t playable) {
  (void)title;
  (void)title_length;
  (void)secondary;
  (void)secondary_length;
  (void)hierarchy;
  (void)hierarchy_length;
  (void)media_type;
  (void)media_type_length;
  (void)library;
  (void)library_length;
  (void)content_rating;
  (void)content_rating_length;
  (void)facts;
  (void)facts_length;
  (void)summary;
  (void)summary_length;
  (void)genres;
  (void)genres_length;
  (void)directors;
  (void)directors_length;
  (void)playable;
  ++state.details_commit_count;
  return 1;
}
uint32_t multiplex_native_app_details_fail(void) { return 1; }

uint32_t multiplex_native_app_browse_begin(uint32_t section_id,
                                           const uint8_t *title,
                                           uint32_t title_length,
                                           uint32_t start, uint32_t total,
                                           uint32_t item_count) {
  (void)section_id;
  (void)title;
  (void)title_length;
  (void)start;
  (void)total;
  (void)item_count;
  ++state.browse_bind_count;
  return 1;
}

uint32_t multiplex_native_app_browse_item(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent) {
  (void)item_index;
  (void)rating_key;
  (void)title;
  (void)title_length;
  (void)subtitle;
  (void)subtitle_length;
  (void)artwork_slot;
  (void)duration_ms;
  (void)view_offset_ms;
  (void)progress_percent;
  return 1;
}

uint32_t multiplex_native_app_browse_commit(void) { return 1; }
uint32_t multiplex_native_app_browse_fail(void) {
  ++state.browse_bind_count;
  return 1;
}

uint32_t multiplex_native_app_search_begin(const uint8_t *query,
                                           uint32_t query_length,
                                           uint32_t item_count) {
  (void)query;
  (void)query_length;
  (void)item_count;
  return 1;
}

uint32_t multiplex_native_app_search_item(
    uint32_t item_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, const uint8_t *subtitle, uint32_t subtitle_length,
    uint32_t artwork_slot, uint32_t duration_ms, uint32_t view_offset_ms,
    uint32_t progress_percent) {
  (void)item_index;
  (void)rating_key;
  (void)title;
  (void)title_length;
  (void)subtitle;
  (void)subtitle_length;
  (void)artwork_slot;
  (void)duration_ms;
  (void)view_offset_ms;
  (void)progress_percent;
  return 1;
}

uint32_t multiplex_native_app_search_commit(void) { return 1; }
uint32_t multiplex_native_app_search_fail(void) { return 1; }
uint32_t multiplex_native_app_mark_watched_commit(uint32_t succeeded) {
  return succeeded;
}

uint32_t multiplex_native_app_playback_navigation_clear(void) { return 1; }
uint32_t multiplex_native_app_playback_navigate(
    uint32_t rating_key, const uint8_t *title, uint32_t title_length,
    const uint8_t *secondary, uint32_t secondary_length,
    const uint8_t *hierarchy, uint32_t hierarchy_length, uint32_t duration_ms) {
  (void)title;
  (void)title_length;
  (void)secondary;
  (void)secondary_length;
  (void)hierarchy;
  (void)hierarchy_length;
  (void)duration_ms;
  assert(rating_key == 200);
  return 1;
}

uint32_t multiplex_native_app_playback_commit(void) {
  ++state.playback_commit_count;
  return 1;
}

uint32_t multiplex_native_app_playback_advance(uint32_t rating_key,
                                               const uint8_t *title,
                                               uint32_t title_length,
                                               uint32_t duration_ms) {
  (void)rating_key;
  (void)title;
  (void)title_length;
  (void)duration_ms;
  return 1;
}

uint32_t multiplex_native_app_playback_fail(void) {
  ++state.playback_fail_count;
  return 1;
}

uint32_t multiplex_native_app_playback_complete(void) { return 1; }

void app_services_content_test_reset_effects(MultiplexAppServices *services) {
  services->effect_count = 0;
  services->effect_head = 0;
}
