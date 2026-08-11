#include "app_services_dispatch_test_support.h"

#include <assert.h>
#include <string.h>

static AppServicesDispatchTestState state;

AppServicesDispatchTestState *app_services_dispatch_test_state(void) {
  return &state;
}

void app_services_dispatch_test_reset(void) {
  memset(&state, 0, sizeof(state));
}

void multiplex_app_services_auth_initialize(MultiplexAppServices *services) {
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_LINKED;
  services->auth.state.linked.location = (MultiplexMemoryCardLocation){
      .slot = 1,
      .generation = 2u,
      .needs_presentation = true,
  };
}

bool multiplex_app_services_auth_boot(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed) {
  (void)now_ms;
  (void)network_allowed;
  return services != NULL;
}

bool multiplex_app_services_auth_tick(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed) {
  state.auth_ticks += 1u;
  return multiplex_app_services_auth_boot(services, now_ms, network_allowed);
}

bool multiplex_app_services_auth_prepare_reset(
    const MultiplexAppServices *services, MultiplexMemoryCardLocation *location,
    bool *deleted) {
  if (services == NULL || location == NULL || deleted == NULL ||
      services->auth.kind != MULTIPLEX_APP_SERVICES_AUTH_LINKED) {
    return false;
  }
  state.auth_delete_attempts += 1u;
  state.auth_delete_observed_cache_save_idle =
      services->content.catalog.cache_save.kind ==
      MULTIPLEX_APP_SERVICES_LOAD_IDLE;
  *location = services->auth.state.linked.location;
  *deleted = state.auth_delete_succeeds;
  return true;
}

bool multiplex_app_services_auth_begin_pairing(
    MultiplexAppServices *services, MultiplexMemoryCardLocation location,
    uint64_t now_ms, uint32_t retry_delay_ms) {
  if (services == NULL) {
    return false;
  }
  state.auth_pairing_begins += 1u;
  state.last_pairing_now_ms = now_ms;
  state.last_pairing_retry_delay_ms = retry_delay_ms;
  state.last_pairing_location = location;
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_PAIRING;
  services->auth.state.pairing.location = location;
  return true;
}

bool multiplex_app_services_auth_linked(const MultiplexAppServices *services) {
  return services != NULL &&
         services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_LINKED;
}

const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services) {
  (void)services;
  return NULL;
}

void multiplex_app_services_catalog_initialize(MultiplexAppServices *services) {
  (void)services;
}

bool multiplex_app_services_catalog_boot(MultiplexAppServices *services,
                                         uint64_t now_ms) {
  (void)now_ms;
  if (services == NULL) {
    return false;
  }
  state.catalog_boots += 1u;
  services->content.catalog.load.kind =
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  return true;
}

bool multiplex_app_services_catalog_tick(MultiplexAppServices *services,
                                         uint64_t now_ms,
                                         bool network_allowed) {
  (void)now_ms;
  (void)network_allowed;
  state.catalog_ticks += 1u;
  return services != NULL;
}

bool multiplex_app_services_catalog_focus(
    MultiplexAppServices *services,
    const MultiplexAppServicesFocusView *focus) {
  return services != NULL && focus != NULL;
}

bool multiplex_app_services_catalog_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  return services != NULL && result != NULL;
}

bool multiplex_app_services_catalog_has_queued(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_catalog_schedule_queued(MultiplexAppServices *services) {
  return services == NULL ? MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED
                          : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

bool multiplex_app_services_discovery_request_browse(
    MultiplexAppServices *services,
    const MultiplexAppServicesBrowsePayload *request) {
  if (services == NULL || request == NULL) {
    return false;
  }
  state.browse_requests += 1u;
  state.last_browse = *request;
  return true;
}

bool multiplex_app_services_discovery_request_search(
    MultiplexAppServices *services,
    const MultiplexAppServicesSearchPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_discovery_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  return services != NULL && result != NULL;
}

bool multiplex_app_services_discovery_has_queued(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_discovery_schedule_queued(
    MultiplexAppServices *services) {
  return services == NULL ? MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED
                          : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

bool multiplex_app_services_details_request_details(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_details_request_children(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsChildrenPayload *request) {
  if (services == NULL || request == NULL) {
    return false;
  }
  state.details_action_queued = true;
  return true;
}

bool multiplex_app_services_playback_request(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request) {
  if (services == NULL || request == NULL) {
    return false;
  }
  const MultiplexAppServicesPresentationEffect blocking = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY,
      .payload.activity = {.visible = true},
  };
  const MultiplexAppServicesEffect playback = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK,
      .payload.playback =
          {
              .token = APP_SERVICES_DISPATCH_TEST_PLAYBACK_TOKEN,
              .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS,
              .payload.hls_open =
                  {
                      .rating_key = request->rating_key,
                      .offset_ms = request->offset_ms,
                  },
          },
  };
  return multiplex_app_services_queue_presentation(services, &blocking) &&
         multiplex_app_services_queue(services, &playback);
}

bool multiplex_app_services_playback_request_navigation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackNavigationPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_details_request_mark_watched(
    MultiplexAppServices *services,
    const MultiplexAppServicesMarkWatchedPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_details_focus(
    MultiplexAppServices *services,
    const MultiplexAppServicesFocusView *focus) {
  if (services == NULL || focus == NULL) {
    return false;
  }
  if (focus->screen == MULTIPLEX_APP_SERVICES_SCREEN_DETAILS) {
    state.details_prefetch_queued = true;
  }
  return true;
}

bool multiplex_app_services_details_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  return services != NULL && result != NULL;
}

bool multiplex_app_services_details_apply_prefetch_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPrefetchResult *result) {
  if (services == NULL || result == NULL) {
    return false;
  }
  if (result->token == state.details_prefetch_token &&
      result->kind == MULTIPLEX_APP_SERVICES_PREFETCH_READY) {
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS);
  }
  return true;
}

bool multiplex_app_services_playback_apply_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result) {
  if (services == NULL || result == NULL) {
    return false;
  }
  if (result->token != APP_SERVICES_DISPATCH_TEST_PLAYBACK_TOKEN) {
    return true;
  }
  const MultiplexAppServicesPresentationEffect blocking = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY,
      .payload.activity = {.visible = false},
  };
  return multiplex_app_services_queue_presentation(services, &blocking);
}

bool multiplex_app_services_playback_apply_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event) {
  return services != NULL && event != NULL;
}

bool multiplex_app_services_details_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL &&
         (state.details_action_queued || state.details_prefetch_queued);
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_details_schedule_queued(MultiplexAppServices *services) {
  if (services == NULL || !state.details_action_queued) {
    if (services == NULL || !state.details_prefetch_queued) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    state.details_prefetch_queued = false;
    state.details_prefetch_token = 901u;
    return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
  }
  state.details_action_queued = false;
  state.details_network_calls += 1u;
  return state.details_schedule_starts
             ? MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED
             : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

bool multiplex_app_services_playback_has_queued(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_playback_schedule_queued(
    MultiplexAppServices *services) {
  return services == NULL ? MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED
                          : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

void app_services_dispatch_test_assert_blocking(
    const MultiplexAppServicesEffect *effect, bool visible) {
  assert(effect->kind == MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION);
  assert(effect->payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY);
  assert(effect->payload.presentation.payload.activity.visible == visible);
}

void app_services_dispatch_test_set_focus(MultiplexAppServices *services,
                                          MultiplexAppServicesScreen screen) {
  services->focus = (MultiplexAppServicesFocusSnapshot){
      .kind = MULTIPLEX_APP_SERVICES_FOCUS_PRESENT,
      .value.view = {.screen = screen},
  };
}

void app_services_dispatch_test_start_posters(MultiplexAppServices *services,
                                              uint32_t token) {
  app_services_dispatch_test_set_focus(services,
                                       MULTIPLEX_APP_SERVICES_SCREEN_HOME);
  services->scheduler.posters.kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING;
  services->scheduler.posters.state.running.plan.token = token;
  services->scheduler.posters.state.running.latest.kind =
      MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE;
}
