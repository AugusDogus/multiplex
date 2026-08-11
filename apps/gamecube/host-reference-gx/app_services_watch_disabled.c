#include "app_services_internal.h"

#include <string.h>

#if !MULTIPLEX_PAIRING_ENABLED

void multiplex_app_services_watch_initialize(MultiplexAppServices *services) {
  memset(&services->watch, 0, sizeof(services->watch));
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE;
}

void multiplex_app_services_watch_destroy(MultiplexAppServices *services) {
  if (services != NULL) {
    multiplex_app_services_watch_initialize(services);
  }
}

bool multiplex_app_services_watch_reset(MultiplexAppServices *services) {
  multiplex_app_services_watch_destroy(services);
  return services != NULL;
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
  return services != NULL && request != NULL;
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

bool multiplex_app_services_watch_has_queued(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_watch_schedule_queued(MultiplexAppServices *services) {
  return services == NULL ? MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED
                          : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

bool multiplex_app_services_watch_has_session(
    const MultiplexAppServices *services) {
  (void)services;
  return false;
}

bool multiplex_app_services_watch_apply_startup(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  return services != NULL && result != NULL;
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

#endif
