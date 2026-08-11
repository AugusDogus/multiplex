#include "app_services_dispatch_test_support.h"

#include <string.h>

void multiplex_app_services_watch_initialize(MultiplexAppServices *services) {
  (void)services;
}

void multiplex_app_services_watch_destroy(MultiplexAppServices *services) {
  (void)services;
}

bool multiplex_app_services_watch_reset(MultiplexAppServices *services) {
  if (services == NULL) {
    return false;
  }
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  state->watch_resets += 1u;
  memset(&services->watch, 0, sizeof(services->watch));
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE;
  return true;
}

bool multiplex_app_services_watch_tick(
    MultiplexAppServices *services, uint64_t now_ms,
    const MultiplexAppServicesPlaybackView *playback) {
  (void)now_ms;
  return services != NULL && playback != NULL;
}

bool multiplex_app_services_watch_request_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_watch_request_create(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchCreatePayload *request) {
  if (services == NULL || request == NULL) {
    return false;
  }
  app_services_dispatch_test_state()->watch_action_queued = true;
  return true;
}

bool multiplex_app_services_watch_request_join(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchJoinPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_watch_request_exit(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchExitPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_watch_request_lobby_leave(
    MultiplexAppServices *services) {
  return services != NULL;
}

bool multiplex_app_services_watch_request_reconnect(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchReconnectPayload *request) {
  return services != NULL && request != NULL;
}

bool multiplex_app_services_watch_has_session(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

bool multiplex_app_services_watch_apply_startup(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  if (services == NULL || result == NULL ||
      result->kind != MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA) {
    return false;
  }
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  state->watch_startup_results += 1u;
  state->last_watch_startup = result->payload.startup_data;
  return true;
}

bool multiplex_app_services_watch_apply_playback_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result) {
  return services != NULL && result != NULL;
}

bool multiplex_app_services_watch_apply_playback_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event) {
  return services != NULL && event != NULL;
}

bool multiplex_app_services_watch_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL &&
         app_services_dispatch_test_state()->watch_action_queued;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_watch_schedule_queued(MultiplexAppServices *services) {
  AppServicesDispatchTestState *state = app_services_dispatch_test_state();
  if (services == NULL || !state->watch_action_queued) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  state->watch_action_queued = false;
  state->watch_network_calls += 1u;
  return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}
