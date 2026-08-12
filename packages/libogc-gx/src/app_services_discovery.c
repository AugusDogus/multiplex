#include "app_services_internal.h"
#include "app_services_request_slots.h"

#include "native_ui.h"

#include <string.h>

#define HOME_POSTER_COUNT MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS

static bool queue_page_posters(MultiplexAppServices *services,
                               MultiplexAppServicesPosterSource source,
                               const MultiplexGatewayBrowsePage *browse,
                               const MultiplexGatewaySearchPage *search) {
  const uint16_t item_count =
      browse != NULL ? browse->item_count : search->item_count;
  if (item_count == 0) {
    return true;
  }
  services->content.poster_plan_token =
      multiplex_app_services_next_token(services);
  MultiplexAppServicesPosterPlan plan = {
      .token = services->content.poster_plan_token,
      .source = source,
      .texture_offset = HOME_POSTER_COUNT,
      .item_count = item_count,
  };
  if (browse != NULL) {
    plan.payload.browse.section_id = browse->section_id;
    plan.payload.browse.start = browse->start;
  } else if (search != NULL) {
    plan.payload.search.query_length = search->query_length;
    memcpy(plan.payload.search.query, search->query, search->query_length + 1u);
  } else {
    return false;
  }
  return multiplex_app_services_scheduler_start_posters(services, &plan);
}

static bool bind_browse(const MultiplexGatewayBrowsePage *page) {
  if (multiplex_native_app_browse_begin(
          page->section_id, (const uint8_t *)page->title, page->title_length,
          page->start, page->total_size, page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_browse_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  return multiplex_native_app_browse_commit() != 0;
}

static bool bind_search(const MultiplexGatewaySearchPage *page) {
  if (multiplex_native_app_search_begin((const uint8_t *)page->query,
                                        page->query_length,
                                        page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_search_item(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  return multiplex_native_app_search_commit() != 0;
}

static MultiplexAppServicesDomainScheduleResult
schedule_queued_browse(MultiplexAppServices *services) {
  const MultiplexAppServicesBrowseRequest *queued =
      multiplex_app_services_browse_slot_queued(&services->content.browse);
  if (queued == NULL) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesBrowseRequest browse = *queued;
  const MultiplexGatewayLibrary *library = NULL;
  for (uint16_t index = 0;
       index < services->content.catalog.catalog.library_count; ++index) {
    const MultiplexGatewayLibrary *candidate =
        &services->content.catalog.catalog.libraries[index];
    if (candidate->section_id == browse.section_id) {
      library = candidate;
      break;
    }
  }
  if (library == NULL) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_BROWSE,
      .payload.browse =
          {
              .library = *library,
              .start = browse.start,
          },
  };
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    const MultiplexAuthCredentials *credentials =
        multiplex_app_services_auth_credentials(services);
    if (credentials == NULL) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    request.payload.browse.credentials = *credentials;
  }
  if (!multiplex_app_services_queue_work(services, &request) ||
      !multiplex_app_services_browse_slot_activate(&services->content.browse,
                                                   request.token)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  multiplex_app_services_queue_network_activity(services, true);
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

bool multiplex_app_services_discovery_request_browse(
    MultiplexAppServices *services,
    const MultiplexAppServicesBrowsePayload *model) {
  const MultiplexAppServicesBrowseRequest browse = {
      .section_id = model->section_id,
      .start = model->start,
      .previous_start = model->previous_start,
  };
  if (browse.section_id == 0) {
    return false;
  }
  multiplex_app_services_browse_slot_request(&services->content.browse,
                                             &browse);
  return true;
}

static MultiplexAppServicesDomainScheduleResult
schedule_queued_search(MultiplexAppServices *services) {
  const MultiplexAppServicesSearchRequest *queued =
      multiplex_app_services_search_slot_queued(&services->content.search);
  if (queued == NULL) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesSearchRequest search = *queued;
  MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_SEARCH,
  };
  request.payload.search.query_length = search.query_length;
  memcpy(request.payload.search.query, search.query, search.query_length + 1u);
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    const MultiplexAuthCredentials *credentials =
        multiplex_app_services_auth_credentials(services);
    if (credentials == NULL) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    request.payload.search.credentials = *credentials;
  }
  if (!multiplex_app_services_queue_work(services, &request) ||
      !multiplex_app_services_search_slot_activate(&services->content.search,
                                                   request.token)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  multiplex_app_services_queue_network_activity(services, true);
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

bool multiplex_app_services_discovery_request_search(
    MultiplexAppServices *services,
    const MultiplexAppServicesSearchPayload *model) {
  MultiplexAppServicesSearchRequest search = {
      .query_length = model->query_length,
  };
  if (search.query_length == 0 ||
      search.query_length >= MULTIPLEX_GATEWAY_SEARCH_QUERY_CAPACITY) {
    return false;
  }
  memcpy(search.query, model->query, search.query_length + 1u);
  multiplex_app_services_search_slot_request(&services->content.search,
                                             &search);
  return true;
}

bool multiplex_app_services_discovery_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL && (multiplex_app_services_browse_slot_queued(
                                  &services->content.browse) != NULL ||
                              multiplex_app_services_search_slot_queued(
                                  &services->content.search) != NULL);
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_discovery_schedule_queued(
    MultiplexAppServices *services) {
  if (multiplex_app_services_browse_slot_queued(&services->content.browse) !=
      NULL) {
    return schedule_queued_browse(services);
  }
  if (multiplex_app_services_search_slot_queued(&services->content.search) !=
      NULL) {
    return schedule_queued_search(services);
  }
  return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

static bool apply_browse(MultiplexAppServices *services,
                         const MultiplexAppServicesWorkResultView *result) {
  MultiplexAppServicesBrowseRequest completed = {0};
  const MultiplexAppServicesSlotSettlement settlement =
      multiplex_app_services_browse_slot_settle(
          &services->content.browse, result->token,
          result->succeeded ? result->payload.browse.page : NULL, &completed);
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_IGNORED) {
    return true;
  }
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY);
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED) {
    return true;
  }
  const bool focused =
      services->focus.kind == MULTIPLEX_APP_SERVICES_FOCUS_PRESENT &&
      services->focus.value.view.screen == MULTIPLEX_APP_SERVICES_SCREEN_BROWSE;
  if (!focused) {
    return multiplex_app_services_queue_network_activity(services, false);
  }
  const MultiplexGatewayBrowsePage *page =
      multiplex_app_services_browse_slot_retained_result(
          &services->content.browse);
  bool bound = false;
  if (result->succeeded && page != NULL) {
    bound = bind_browse(page) &&
            queue_page_posters(services,
                               MULTIPLEX_APP_SERVICES_POSTER_SOURCE_BROWSE,
                               page, NULL);
    if (bound) {
      const MultiplexAppServicesPresentationEffect motion = {
          .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_BROWSE_MOTION,
          .payload.browse_motion =
              {
                  .before = completed.previous_start,
                  .after = page->start,
              },
      };
      bound = multiplex_app_services_queue_presentation(services, &motion);
    }
  } else {
    bound = multiplex_native_app_browse_fail() != 0;
  }
  return bound &&
         multiplex_app_services_queue_network_activity(services, false) &&
         multiplex_app_services_queue_refresh(services, true);
}

static bool apply_search(MultiplexAppServices *services,
                         const MultiplexAppServicesWorkResultView *result) {
  MultiplexAppServicesSearchRequest completed = {0};
  const MultiplexAppServicesSlotSettlement settlement =
      multiplex_app_services_search_slot_settle(
          &services->content.search, result->token,
          result->succeeded ? result->payload.search.page : NULL, &completed);
  (void)completed;
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_IGNORED) {
    return true;
  }
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY);
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED) {
    return true;
  }
  const bool focused =
      services->focus.kind == MULTIPLEX_APP_SERVICES_FOCUS_PRESENT &&
      services->focus.value.view.screen == MULTIPLEX_APP_SERVICES_SCREEN_SEARCH;
  if (!focused) {
    return multiplex_app_services_queue_network_activity(services, false);
  }
  const MultiplexGatewaySearchPage *page =
      multiplex_app_services_search_slot_retained_result(
          &services->content.search);
  bool bound = false;
  if (result->succeeded && page != NULL) {
    bound = bind_search(page) &&
            queue_page_posters(services,
                               MULTIPLEX_APP_SERVICES_POSTER_SOURCE_SEARCH,
                               NULL, page);
  } else {
    bound = multiplex_native_app_search_fail() != 0;
  }
  return bound &&
         multiplex_app_services_queue_network_activity(services, false) &&
         multiplex_app_services_queue_refresh(services, true);
}

bool multiplex_app_services_discovery_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  switch (result->kind) {
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
    return apply_browse(services, result);
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
    return apply_search(services, result);
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA:
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    return false;
  }
  return false;
}
