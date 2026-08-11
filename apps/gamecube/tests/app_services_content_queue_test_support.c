#include "app_services_content_test_support.h"

bool multiplex_app_services_queue_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkRequest *request) {
  if (request == NULL) {
    return false;
  }
  const MultiplexAppServicesEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_WORK_REQUEST,
      .payload.work = *request,
  };
  return multiplex_app_services_queue(services, &effect);
}

bool multiplex_app_services_queue_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEffect *playback) {
  if (playback == NULL) {
    return false;
  }
  const MultiplexAppServicesEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK,
      .payload.playback = *playback,
  };
  return multiplex_app_services_queue(services, &effect);
}

bool multiplex_app_services_queue_refresh(MultiplexAppServices *services,
                                          bool asynchronous) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_REFRESH,
      .payload.refresh = {.asynchronous = asynchronous},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}

static bool queue_activity(MultiplexAppServices *services,
                           MultiplexAppServicesPresentationEffectKind kind,
                           bool visible) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = kind,
      .payload.activity = {.visible = visible},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}

bool multiplex_app_services_queue_network_activity(
    MultiplexAppServices *services, bool visible) {
  return queue_activity(
      services, MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY, visible);
}

bool multiplex_app_services_queue_blocking_activity(
    MultiplexAppServices *services, bool visible) {
  return queue_activity(
      services, MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY, visible);
}

bool multiplex_app_services_queue_controls_active(
    MultiplexAppServices *services, uint64_t now_ms) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_CONTROLS_ACTIVE,
      .payload.controls_active = {.now_ms = now_ms},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}
