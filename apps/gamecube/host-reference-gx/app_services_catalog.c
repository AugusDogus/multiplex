#include "app_services_internal.h"

#include "native_ui.h"

#include <string.h>

#define CATALOG_RETRY_INITIAL_DELAY_MS 1000u
#define CATALOG_RETRY_MAX_DELAY_MS 8000u
#define STARTUP_DATA_IDLE_DELAY_MS 2000u

static bool bind_catalog(const MultiplexGatewayCatalog *catalog) {
  if (multiplex_native_app_catalog_begin(
          (const uint8_t *)catalog->server_name, catalog->server_name_length,
          catalog->row_count, catalog->library_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < catalog->library_count; ++index) {
    const MultiplexGatewayLibrary *library = &catalog->libraries[index];
    if (multiplex_native_app_catalog_library(
            index, library->section_id, library->media_type,
            (const uint8_t *)library->title, library->title_length) == 0) {
      return false;
    }
  }
  for (uint16_t row_index = 0; row_index < catalog->row_count; ++row_index) {
    const MultiplexGatewayRow *row = &catalog->rows[row_index];
    if (multiplex_native_app_catalog_row(row_index, (const uint8_t *)row->title,
                                         row->title_length,
                                         row->item_count) == 0) {
      return false;
    }
    for (uint16_t item_index = 0; item_index < row->item_count; ++item_index) {
      const MultiplexGatewayItem *item =
          &catalog->items[row->item_offset + item_index];
      if (multiplex_native_app_catalog_item(
              row_index, item_index, item->rating_key,
              (const uint8_t *)item->title, item->title_length,
              (const uint8_t *)item->subtitle, item->subtitle_length,
              item->artwork_slot, item->duration_ms, item->view_offset_ms,
              item->progress_percent) == 0) {
        return false;
      }
    }
  }
  return multiplex_native_app_catalog_commit() != 0;
}

static bool queue_home_posters(MultiplexAppServices *services) {
  if (services->content.catalog.catalog.total_item_count == 0) {
    return true;
  }
  services->content.poster_plan_token =
      multiplex_app_services_next_token(services);
  const MultiplexAppServicesPosterPlan plan = {
      .token = services->content.poster_plan_token,
      .source = MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG,
      .item_count = services->content.catalog.catalog.total_item_count,
  };
  return multiplex_app_services_scheduler_start_posters(services, &plan);
}

static MultiplexAppServicesDomainScheduleResult
schedule_catalog_work(MultiplexAppServices *services) {
  MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_CATALOG,
  };
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    const MultiplexAuthCredentials *credentials =
        multiplex_app_services_auth_credentials(services);
    if (credentials == NULL) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
    }
    request.payload.catalog.credentials = *credentials;
  }
  services->content.catalog.load = (MultiplexAppServicesLoadState){
      .kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING,
      .token = request.token,
  };
  return multiplex_app_services_queue_work(services, &request) &&
                 multiplex_app_services_queue_network_activity(
                     services, !services->content.catalog.available)
             ? MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED
             : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
}

static MultiplexAppServicesDomainScheduleResult
schedule_startup_work(MultiplexAppServices *services) {
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND !=
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA,
      .payload.startup_data = {.credentials = *credentials},
  };
  services->content.startup_data = (MultiplexAppServicesLoadState){
      .kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING,
      .token = request.token,
  };
  return multiplex_app_services_queue_work(services, &request)
             ? MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED
             : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
}

static MultiplexAppServicesDomainScheduleResult
schedule_cache_save(MultiplexAppServices *services) {
  const MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE,
  };
  services->content.catalog.cache_save = (MultiplexAppServicesLoadState){
      .kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING,
      .token = request.token,
  };
  return multiplex_app_services_queue_work(services, &request)
             ? MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED
             : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
}

bool multiplex_app_services_catalog_has_queued(
    const MultiplexAppServices *services) {
  if (services == NULL) {
    return false;
  }
  const bool credentials_ready =
      MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
          MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY ||
      multiplex_app_services_auth_credentials(services) != NULL;
  return (services->content.catalog.load.kind ==
              MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING &&
          credentials_ready) ||
         services->content.catalog.cache_save.kind ==
             MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING ||
         (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
              MULTIPLEX_APP_SERVICES_BACKEND_PLEX &&
          services->content.startup_data.kind ==
              MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING &&
          credentials_ready);
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_catalog_schedule_queued(MultiplexAppServices *services) {
  if (services->content.catalog.load.kind ==
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING) {
    return schedule_catalog_work(services);
  }
  if (services->content.catalog.cache_save.kind ==
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING) {
    return schedule_cache_save(services);
  }
  if (services->content.startup_data.kind ==
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING) {
    return schedule_startup_work(services);
  }
  return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

void multiplex_app_services_catalog_initialize(MultiplexAppServices *services) {
  multiplex_app_services_retry_initialize(&services->content.catalog.retry,
                                          CATALOG_RETRY_INITIAL_DELAY_MS,
                                          CATALOG_RETRY_MAX_DELAY_MS);
}

bool multiplex_app_services_catalog_boot(MultiplexAppServices *services,
                                         uint64_t now_ms) {
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
          MULTIPLEX_APP_SERVICES_BACKEND_PLEX &&
      services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_LINKED &&
      services->auth.state.linked.cached_catalog_available &&
      multiplex_catalog_cache_decode(services->auth.state.linked.cached_catalog,
                                     &services->content.catalog.catalog) &&
      bind_catalog(&services->content.catalog.catalog)) {
    services->content.catalog.available = true;
    services->content.catalog.load.kind =
        MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
    services->content.startup_data_not_before_ms =
        now_ms + STARTUP_DATA_IDLE_DELAY_MS;
  }
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
          MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY ||
      (services->auth.network_allowed &&
       multiplex_app_services_auth_linked(services))) {
    services->content.catalog.load.kind =
        MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  }
  return true;
}

bool multiplex_app_services_catalog_tick(MultiplexAppServices *services,
                                         uint64_t now_ms,
                                         bool network_allowed) {
  if (!network_allowed || !multiplex_app_services_auth_linked(services)) {
    return true;
  }
  if (multiplex_app_services_load_should_start(&services->content.catalog.load,
                                               network_allowed)) {
    services->content.catalog.load.kind =
        MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
    return true;
  }
  if (services->content.catalog.load.kind ==
          MULTIPLEX_APP_SERVICES_LOAD_RETRY_WAIT &&
      multiplex_app_services_retry_due(&services->content.catalog.retry,
                                       now_ms)) {
    services->content.catalog.load.kind =
        MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  }
  return true;
}

bool multiplex_app_services_catalog_focus(
    MultiplexAppServices *services,
    const MultiplexAppServicesFocusView *focus) {
  const bool prefetch_active =
      services->content.playback.kind ==
          MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN &&
      services->content.playback.value.view.prefetch_active;
  const MultiplexAppServicesLoadKind startup_kind =
      services->content.startup_data.kind;
  const bool startup_can_wait_for_idle =
      startup_kind == MULTIPLEX_APP_SERVICES_LOAD_IDLE ||
      startup_kind == MULTIPLEX_APP_SERVICES_LOAD_FAILED ||
      startup_kind == MULTIPLEX_APP_SERVICES_LOAD_RETRY_WAIT ||
      startup_kind == MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  if (focus->screen == MULTIPLEX_APP_SERVICES_SCREEN_HOME &&
      focus->active_input && startup_can_wait_for_idle) {
    services->content.startup_data.kind = MULTIPLEX_APP_SERVICES_LOAD_IDLE;
    services->content.startup_data_not_before_ms =
        focus->now_ms + STARTUP_DATA_IDLE_DELAY_MS;
    return true;
  }
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND !=
          MULTIPLEX_APP_SERVICES_BACKEND_PLEX ||
      focus->screen != MULTIPLEX_APP_SERVICES_SCREEN_HOME ||
      !services->content.catalog.available || prefetch_active ||
      services->content.startup_data.kind ==
          MULTIPLEX_APP_SERVICES_LOAD_READY ||
      services->content.startup_data.kind ==
          MULTIPLEX_APP_SERVICES_LOAD_LOADING ||
      services->content.startup_data.kind ==
          MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING ||
      focus->now_ms < services->content.startup_data_not_before_ms) {
    return true;
  }
  services->content.startup_data.kind =
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  return true;
}

static bool apply_catalog(MultiplexAppServices *services,
                          const MultiplexAppServicesWorkResultView *result) {
  if (!multiplex_app_services_accept_result(&services->content.catalog.load,
                                            result->token)) {
    return true;
  }
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG);
  if (!result->succeeded || result->payload.catalog.catalog == NULL) {
    services->content.catalog.load.kind =
        MULTIPLEX_APP_SERVICES_LOAD_RETRY_WAIT;
    multiplex_app_services_retry_schedule(&services->content.catalog.retry,
                                          result->now_ms);
    if (!services->content.catalog.available &&
        multiplex_native_app_pairing_status(MULTIPLEX_DEVICE_AUTH_UNAVAILABLE,
                                            (const uint8_t *)"", 0,
                                            (const uint8_t *)"", 0) == 0) {
      return false;
    }
    return multiplex_app_services_queue_network_activity(services, false) &&
           multiplex_app_services_queue_refresh(services, false);
  }
  services->content.catalog.catalog = *result->payload.catalog.catalog;
  services->content.catalog.available = true;
  services->content.catalog.load.kind = MULTIPLEX_APP_SERVICES_LOAD_READY;
  multiplex_app_services_retry_reset(&services->content.catalog.retry);
  if (!bind_catalog(&services->content.catalog.catalog) ||
      multiplex_native_app_pairing_status(MULTIPLEX_DEVICE_AUTH_LINKED,
                                          (const uint8_t *)"", 0,
                                          (const uint8_t *)"", 0) == 0) {
    return false;
  }
  services->content.startup_data_not_before_ms =
      result->now_ms + STARTUP_DATA_IDLE_DELAY_MS;
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    services->content.catalog.cache_save.kind =
        MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  }
  return queue_home_posters(services) &&
         multiplex_app_services_queue_network_activity(services, false) &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_catalog_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  switch (result->kind) {
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
    return apply_catalog(services, result);
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
    if (!multiplex_app_services_accept_result(
            &services->content.catalog.cache_save, result->token)) {
      return true;
    }
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG);
    services->content.catalog.cache_save.kind =
        result->succeeded ? MULTIPLEX_APP_SERVICES_LOAD_READY
                          : MULTIPLEX_APP_SERVICES_LOAD_FAILED;
    return true;
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA:
    if (!multiplex_app_services_accept_result(&services->content.startup_data,
                                              result->token)) {
      return true;
    }
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG);
    services->content.startup_data.kind =
        result->succeeded ? MULTIPLEX_APP_SERVICES_LOAD_READY
                          : MULTIPLEX_APP_SERVICES_LOAD_FAILED;
    if (!result->succeeded) {
      services->content.startup_data_not_before_ms =
          result->now_ms + STARTUP_DATA_IDLE_DELAY_MS;
    }
    return true;
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    return false;
  }
  return false;
}
