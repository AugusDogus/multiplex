#include "app_services_internal.h"
#include "app_services_request_slots.h"

#include "media-source.h"

#include <stdlib.h>
#include <string.h>

uint32_t multiplex_app_services_next_token(MultiplexAppServices *services) {
  services->next_token += 1u;
  if (services->next_token == 0) {
    services->next_token = 1u;
  }
  return services->next_token;
}

MultiplexAppServices *multiplex_app_services_create(void) {
  MultiplexAppServices *services = calloc(1, sizeof(*services));
  if (services == NULL) {
    return NULL;
  }
  services->dispatch_result = MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  multiplex_app_services_auth_initialize(services);
  services->reset.kind = MULTIPLEX_APP_SERVICES_RESET_IDLE;
  multiplex_app_services_catalog_initialize(services);
  multiplex_app_services_watch_initialize(services);
  multiplex_app_services_scheduler_initialize(&services->scheduler);
  return services;
}

void multiplex_app_services_destroy(MultiplexAppServices **services) {
  if (services == NULL || *services == NULL) {
    return;
  }
  multiplex_app_services_watch_destroy(*services);
  memset(&(*services)->content, 0, sizeof((*services)->content));
  memset(&(*services)->auth, 0, sizeof((*services)->auth));
  free(*services);
  *services = NULL;
}

bool multiplex_app_services_queue(MultiplexAppServices *services,
                                  const MultiplexAppServicesEffect *effect) {
  if (services == NULL || effect == NULL ||
      services->effect_count >= MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY) {
    if (services != NULL) {
      services->dispatch_result =
          MULTIPLEX_APP_SERVICES_DISPATCH_EFFECT_OVERFLOW;
    }
    return false;
  }
  const uint8_t tail =
      (uint8_t)((services->effect_head + services->effect_count) %
                MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY);
  services->effects[tail] = *effect;
  services->effect_count += 1u;
  return true;
}

bool multiplex_app_services_queue_presentation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPresentationEffect *effect) {
  if (effect == NULL) {
    return false;
  }
  const MultiplexAppServicesEffect queued = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_PRESENTATION,
      .payload.presentation = *effect,
  };
  return multiplex_app_services_queue(services, &queued);
}

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

bool multiplex_app_services_queue_failure(MultiplexAppServices *services,
                                          MultiplexAppServicesFailure failure) {
  const MultiplexAppServicesEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_FAILED,
      .payload.failure = failure,
  };
  return multiplex_app_services_queue(services, &effect);
}

static void discard_queued_effects(MultiplexAppServices *services) {
  memset(services->effects, 0, sizeof(services->effects));
  services->effect_head = 0;
  services->effect_count = 0;
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

static bool request_auth_reset(MultiplexAppServices *services,
                               uint64_t now_ms) {
  if (services->reset.kind != MULTIPLEX_APP_SERVICES_RESET_IDLE ||
      !multiplex_app_services_auth_linked(services)) {
    return true;
  }
  const uint32_t token = multiplex_app_services_next_token(services);
  services->reset = (MultiplexAppServicesResetState){
      .kind = MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE,
      .state.wait_storage_quiesce =
          {
              .quiesce_token = token,
              .requested_at_ms = now_ms,
          },
  };
  const MultiplexAppServicesEffect quiesce = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_STORAGE_QUIESCE,
      .payload.storage_quiesce = {.token = token},
  };
  return multiplex_app_services_queue(services, &quiesce);
}

static void finish_cache_save_quiesce(MultiplexAppServices *services) {
  if (services->content.catalog.cache_save.kind !=
      MULTIPLEX_APP_SERVICES_LOAD_LOADING) {
    return;
  }
  services->content.catalog.cache_save.kind = MULTIPLEX_APP_SERVICES_LOAD_IDLE;
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG);
}

static bool
apply_reset_storage_quiesced(MultiplexAppServices *services,
                             const MultiplexAppServicesResetQuiesce *quiesced) {
  if (services->reset.kind !=
          MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE ||
      services->reset.state.wait_storage_quiesce.quiesce_token !=
          quiesced->token) {
    return true;
  }
  const MultiplexAppServicesResetWaitStorageQuiesce waiting =
      services->reset.state.wait_storage_quiesce;
  finish_cache_save_quiesce(services);
  MultiplexMemoryCardLocation location = {.slot = -1};
  bool deleted = false;
  if (!multiplex_app_services_auth_prepare_reset(services, &location,
                                                 &deleted)) {
    return false;
  }
  if (!deleted) {
    services->reset = (MultiplexAppServicesResetState){
        .kind = MULTIPLEX_APP_SERVICES_RESET_IDLE,
    };
    return multiplex_app_services_scheduler_run(services);
  }
  discard_queued_effects(services);
  const uint32_t runtime_token = multiplex_app_services_next_token(services);
  services->reset = (MultiplexAppServicesResetState){
      .kind = MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE,
      .state.wait_runtime_quiesce =
          {
              .quiesce_token = runtime_token,
              .requested_at_ms = waiting.requested_at_ms,
              .location = location,
          },
  };
  const MultiplexAppServicesEffect runtime_quiesce = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_RUNTIME_QUIESCE,
      .payload.runtime_quiesce = {.token = runtime_token},
  };
  return multiplex_app_services_queue_network_activity(services, false) &&
         multiplex_app_services_queue_blocking_activity(services, false) &&
         multiplex_app_services_queue(services, &runtime_quiesce);
}

static bool
apply_reset_runtime_quiesced(MultiplexAppServices *services,
                             const MultiplexAppServicesResetQuiesce *quiesced) {
  if (services->reset.kind !=
          MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE ||
      services->reset.state.wait_runtime_quiesce.quiesce_token !=
          quiesced->token) {
    return true;
  }
  const MultiplexAppServicesResetWaitRuntimeQuiesce waiting =
      services->reset.state.wait_runtime_quiesce;
  const uint32_t stop_token = multiplex_app_services_next_token(services);
  services->reset = (MultiplexAppServicesResetState){
      .kind = MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP,
      .state.wait_stop =
          {
              .stop_token = stop_token,
              .requested_at_ms = waiting.requested_at_ms,
              .location = waiting.location,
          },
  };
  const MultiplexAppServicesPlaybackEffect stop = {
      .token = stop_token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_STOP,
  };
  return multiplex_app_services_queue_playback(services, &stop);
}

static bool
apply_reset_playback_result(MultiplexAppServices *services,
                            const MultiplexAppServicesPlaybackResult *result) {
  if (services->reset.kind != MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP ||
      services->reset.state.wait_stop.stop_token != result->token) {
    return true;
  }
  if (result->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED) {
    return false;
  }

  const MultiplexAppServicesResetWaitStop waiting =
      services->reset.state.wait_stop;
  const bool watch_cleared = multiplex_app_services_watch_reset(services);
  memset(&services->content, 0, sizeof(services->content));
  multiplex_app_services_catalog_initialize(services);
  multiplex_app_services_scheduler_initialize(&services->scheduler);
  services->reset = (MultiplexAppServicesResetState){
      .kind = MULTIPLEX_APP_SERVICES_RESET_IDLE,
      .last_completed_stop_token = waiting.stop_token,
  };
  const bool pairing_started = multiplex_app_services_auth_begin_pairing(
      services, waiting.location, waiting.requested_at_ms,
      MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS);
  return watch_cleared && pairing_started;
}

bool multiplex_app_services_poll_effect(MultiplexAppServices *services,
                                        MultiplexAppServicesEffect *effect) {
  if (services == NULL || effect == NULL || services->effect_count == 0) {
    return false;
  }
  *effect = services->effects[services->effect_head];
  services->effect_head = (uint8_t)((services->effect_head + 1u) %
                                    MULTIPLEX_APP_SERVICES_EFFECT_CAPACITY);
  services->effect_count -= 1u;
  return true;
}

MultiplexAppServicesDispatchResult
multiplex_app_services_dispatch(MultiplexAppServices *services,
                                const MultiplexAppServicesInput *input) {
  if (services == NULL || input == NULL) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_INVALID_INPUT;
  }
  services->dispatch_result = MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  if (services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_IDLE &&
      input->kind == MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT &&
      input->payload.playback_result.kind ==
          MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED &&
      input->payload.playback_result.token != 0 &&
      input->payload.playback_result.token ==
          services->reset.last_completed_stop_token) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  }
  const bool reset_was_waiting =
      services->reset.kind != MULTIPLEX_APP_SERVICES_RESET_IDLE;
  if (services->reset.kind ==
          MULTIPLEX_APP_SERVICES_RESET_WAIT_STORAGE_QUIESCE &&
      input->kind != MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  }
  if (services->reset.kind ==
          MULTIPLEX_APP_SERVICES_RESET_WAIT_RUNTIME_QUIESCE &&
      input->kind != MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  }
  if (services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP &&
      input->kind != MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  }
  bool run_scheduler = !reset_was_waiting;
  bool accepted = false;
  switch (input->kind) {
  case MULTIPLEX_APP_SERVICES_INPUT_BOOT:
    accepted =
        multiplex_app_services_auth_boot(services, input->payload.boot.now_ms,
                                         input->payload.boot.network_allowed) &&
        multiplex_app_services_catalog_boot(services,
                                            input->payload.boot.now_ms);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_TICK:
    accepted =
        multiplex_app_services_auth_tick(services, input->payload.tick.now_ms,
                                         input->payload.tick.network_allowed) &&
        multiplex_app_services_catalog_tick(
            services, input->payload.tick.now_ms,
            input->payload.tick.network_allowed);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_AUTH_RESET_REQUESTED:
    run_scheduler = false;
    accepted = request_auth_reset(services, input->payload.auth_reset.now_ms);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_MODEL_REQUEST:
    switch (input->payload.model_request.kind) {
    case MULTIPLEX_APP_SERVICES_MODEL_BROWSE:
      accepted = multiplex_app_services_discovery_request_browse(
          services, &input->payload.model_request.payload.browse);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_SEARCH:
      accepted = multiplex_app_services_discovery_request_search(
          services, &input->payload.model_request.payload.search);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_DETAILS:
      accepted = multiplex_app_services_details_request_details(
          services, &input->payload.model_request.payload.details);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_DETAILS_CHILDREN:
      accepted = multiplex_app_services_details_request_children(
          services, &input->payload.model_request.payload.details_children);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK_NAVIGATION:
      accepted = multiplex_app_services_playback_request_navigation(
          services, &input->payload.model_request.payload.playback_navigation);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_MARK_WATCHED:
      accepted = multiplex_app_services_details_request_mark_watched(
          services, &input->payload.model_request.payload.mark_watched);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_FOCUS:
      services->focus = (MultiplexAppServicesFocusSnapshot){
          .kind = MULTIPLEX_APP_SERVICES_FOCUS_PRESENT,
          .value.view = input->payload.model_request.payload.focus,
      };
      accepted = multiplex_app_services_catalog_focus(
                     services, &input->payload.model_request.payload.focus) &&
                 multiplex_app_services_details_focus(
                     services, &input->payload.model_request.payload.focus);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_PLAYBACK:
      accepted =
          multiplex_app_services_watch_has_session(services)
              ? multiplex_app_services_watch_request_playback(
                    services, &input->payload.model_request.payload.playback)
              : multiplex_app_services_playback_request(
                    services, &input->payload.model_request.payload.playback);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_WATCH_CREATE:
      accepted = multiplex_app_services_watch_request_create(
          services, &input->payload.model_request.payload.watch_create);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_WATCH_JOIN:
      accepted = multiplex_app_services_watch_request_join(
          services, &input->payload.model_request.payload.watch_join);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_WATCH_EXIT:
      accepted = multiplex_app_services_watch_request_exit(
          services, &input->payload.model_request.payload.watch_exit);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_WATCH_LOBBY_LEAVE:
      accepted = multiplex_app_services_watch_request_lobby_leave(services);
      break;
    case MULTIPLEX_APP_SERVICES_MODEL_WATCH_RECONNECT:
      accepted = multiplex_app_services_watch_request_reconnect(
          services, &input->payload.model_request.payload.watch_reconnect);
      break;
    }
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW:
    if (input->payload.work_result.kind ==
        MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA) {
      accepted = multiplex_app_services_watch_apply_startup(
                     services, &input->payload.work_result) &&
                 multiplex_app_services_catalog_apply_work(
                     services, &input->payload.work_result);
    } else if (input->payload.work_result.kind ==
                   MULTIPLEX_APP_SERVICES_WORK_CATALOG ||
               input->payload.work_result.kind ==
                   MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE) {
      accepted = multiplex_app_services_catalog_apply_work(
          services, &input->payload.work_result);
    } else if (input->payload.work_result.kind ==
                   MULTIPLEX_APP_SERVICES_WORK_BROWSE ||
               input->payload.work_result.kind ==
                   MULTIPLEX_APP_SERVICES_WORK_SEARCH) {
      accepted = multiplex_app_services_discovery_apply_work(
          services, &input->payload.work_result);
    } else {
      accepted = multiplex_app_services_details_apply_work(
          services, &input->payload.work_result);
    }
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT:
    if (services->reset.kind == MULTIPLEX_APP_SERVICES_RESET_WAIT_STOP) {
      accepted = apply_reset_playback_result(services,
                                             &input->payload.playback_result);
    } else {
      services->content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
      services->content.playback.value.view =
          input->payload.playback_result.playback;
      accepted = multiplex_app_services_playback_apply_result(
                     services, &input->payload.playback_result) &&
                 multiplex_app_services_watch_apply_playback_result(
                     services, &input->payload.playback_result);
    }
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT:
    services->content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
    services->content.playback.value.view =
        input->payload.playback_event.playback;
    accepted = multiplex_app_services_playback_apply_event(
                   services, &input->payload.playback_event) &&
               multiplex_app_services_watch_apply_playback_event(
                   services, &input->payload.playback_event);
    if (accepted && input->payload.playback_event.kind ==
                        MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE) {
      accepted = multiplex_app_services_watch_tick(
          services, input->payload.playback_event.now_ms,
          &input->payload.playback_event.playback);
    }
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT:
    accepted = multiplex_app_services_scheduler_apply_poster_result(
        services, &input->payload.poster_result);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT:
    accepted = multiplex_app_services_details_apply_prefetch_result(
        services, &input->payload.prefetch_result);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED:
    run_scheduler = false;
    accepted = apply_reset_storage_quiesced(
        services, &input->payload.reset_storage_quiesced);
    break;
  case MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED:
    run_scheduler = false;
    accepted = apply_reset_runtime_quiesced(
        services, &input->payload.reset_runtime_quiesced);
    break;
  }
  if (accepted && run_scheduler) {
    accepted = multiplex_app_services_scheduler_run(services);
  }
  if (services->dispatch_result != MULTIPLEX_APP_SERVICES_DISPATCH_READY) {
    return services->dispatch_result;
  }
  if (accepted) {
    return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
  }
  MultiplexAppServicesFailure failure = MULTIPLEX_APP_SERVICES_FAILURE_UI_BIND;
  if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW) {
    failure = MULTIPLEX_APP_SERVICES_FAILURE_BACKGROUND_BIND;
  } else if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_RESULT ||
             input->kind == MULTIPLEX_APP_SERVICES_INPUT_PLAYBACK_EVENT ||
             input->kind == MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT) {
    failure = MULTIPLEX_APP_SERVICES_FAILURE_PLAYBACK_CONTINUATION;
  }
  return multiplex_app_services_queue_failure(services, failure)
             ? MULTIPLEX_APP_SERVICES_DISPATCH_FAILED
             : services->dispatch_result;
}

bool multiplex_app_services_copy_poster_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *plan,
    MultiplexGatewayItem *destination, uint16_t capacity,
    MultiplexAuthCredentials *credentials) {
  if (services == NULL || plan == NULL || destination == NULL ||
      plan->token == 0 || plan->token != services->content.poster_plan_token ||
      plan->item_count > capacity) {
    return false;
  }
  const MultiplexGatewayItem *items = NULL;
  uint16_t item_count = 0;
  if (plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG) {
    items = services->content.catalog.catalog.items;
    item_count = services->content.catalog.catalog.total_item_count;
  } else if (plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_BROWSE) {
    const MultiplexGatewayBrowsePage *page =
        multiplex_app_services_browse_slot_retained_result(
            &services->content.browse);
    if (page != NULL) {
      items = page->items;
      item_count = page->item_count;
    }
  } else if (plan->source == MULTIPLEX_APP_SERVICES_POSTER_SOURCE_SEARCH) {
    const MultiplexGatewaySearchPage *page =
        multiplex_app_services_search_slot_retained_result(
            &services->content.search);
    if (page != NULL) {
      items = page->items;
      item_count = page->item_count;
    }
  }
  if (items == NULL || item_count != plan->item_count) {
    return false;
  }
  memcpy(destination, items, (size_t)item_count * sizeof(*items));
  if (credentials != NULL) {
    const MultiplexAuthCredentials *source =
        multiplex_app_services_auth_credentials(services);
    if (source == NULL) {
      return false;
    }
    *credentials = *source;
  }
  return true;
}

bool multiplex_app_services_copy_cache_save_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesWorkRequest *request,
    MultiplexMemoryCardLocation *location, uint8_t *destination,
    size_t capacity) {
#if MULTIPLEX_PAIRING_ENABLED
  if (services == NULL || request == NULL || location == NULL ||
      destination == NULL || capacity < MULTIPLEX_CATALOG_CACHE_SIZE ||
      request->kind != MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE ||
      services->content.catalog.cache_save.kind !=
          MULTIPLEX_APP_SERVICES_LOAD_LOADING ||
      services->content.catalog.cache_save.token != request->token ||
      services->auth.kind != MULTIPLEX_APP_SERVICES_AUTH_LINKED ||
      !multiplex_catalog_cache_encode(destination,
                                      &services->content.catalog.catalog)) {
    return false;
  }
  *location = services->auth.state.linked.location;
  return true;
#else
  (void)services;
  (void)request;
  (void)location;
  (void)destination;
  (void)capacity;
  return false;
#endif
}

uint32_t multiplex_app_services_startup_rating_key(
    const MultiplexAppServices *services) {
  if (services == NULL) {
    return 0;
  }
  const MultiplexGatewayDetails *details =
      multiplex_app_services_details_slot_retained_result(
          &services->content.details);
  return details == NULL ? 0 : details->rating_key;
}
