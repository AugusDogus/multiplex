#include "app_services_content_test_support.h"
#include "app_services_request_slots.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static AppServicesContentTestState *test_state;

static void late_browse_result_is_retained_without_binding(void) {
  MultiplexAppServices services = {0};
  const MultiplexAppServicesBrowseRequest request = {
      .section_id = 9u,
      .start = 21u,
      .previous_start = 0u,
  };
  multiplex_app_services_browse_slot_request(&services.content.browse,
                                             &request);
  assert(multiplex_app_services_browse_slot_activate(&services.content.browse,
                                                     71u));
  services.scheduler.foreground = (MultiplexAppServicesForegroundScheduler){
      .kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE,
      .state.active = {.domain = MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY},
  };
  services.focus = (MultiplexAppServicesFocusSnapshot){
      .kind = MULTIPLEX_APP_SERVICES_FOCUS_PRESENT,
      .value.view = {.screen = MULTIPLEX_APP_SERVICES_SCREEN_HOME},
  };
  const MultiplexGatewayBrowsePage page = {
      .section_id = 9u,
      .start = 21u,
      .item_count = 1u,
  };
  const MultiplexAppServicesWorkResultView result = {
      .token = 71u,
      .kind = MULTIPLEX_APP_SERVICES_WORK_BROWSE,
      .succeeded = true,
      .payload.browse = {.page = &page},
  };
  test_state->browse_bind_count = 0u;
  assert(multiplex_app_services_discovery_apply_work(&services, &result));
  assert(test_state->browse_bind_count == 0u);
  const MultiplexGatewayBrowsePage *retained =
      multiplex_app_services_browse_slot_retained_result(
          &services.content.browse);
  assert(retained != NULL && retained->start == 21u);
  assert(services.scheduler.posters.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE);
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY);
  assert(!services.effects[0].payload.presentation.payload.activity.visible);
}

static void late_foreground_details_is_retained_without_binding(void) {
  MultiplexAppServices services = {0};
  const MultiplexAppServicesDetailsRequest request = {
      .rating_key = 777u,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND,
  };
  assert(multiplex_app_services_details_slot_request(&services.content.details,
                                                     &request) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED);
  assert(multiplex_app_services_details_slot_activate(&services.content.details,
                                                      72u));
  services.scheduler.foreground = (MultiplexAppServicesForegroundScheduler){
      .kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE,
      .state.active = {.domain = MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS},
  };
  services.focus = (MultiplexAppServicesFocusSnapshot){
      .kind = MULTIPLEX_APP_SERVICES_FOCUS_PRESENT,
      .value.view =
          {
              .screen = MULTIPLEX_APP_SERVICES_SCREEN_DETAILS,
              .rating_key = 778u,
          },
  };
  const MultiplexGatewayDetails details = {
      .rating_key = 777u,
      .duration_ms = 60000u,
  };
  const MultiplexAppServicesWorkResultView result = {
      .token = 72u,
      .kind = MULTIPLEX_APP_SERVICES_WORK_DETAILS,
      .succeeded = true,
      .payload.details = {.details = &details},
  };
  test_state->details_commit_count = 0u;
  assert(multiplex_app_services_details_apply_work(&services, &result));
  assert(test_state->details_commit_count == 0u);
  const MultiplexGatewayDetails *retained =
      multiplex_app_services_details_slot_retained_result(
          &services.content.details);
  assert(retained != NULL && retained->rating_key == 777u);
  assert(services.content.details_prefetch.kind ==
         MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE);
  assert(services.effect_count == 1u);
  assert(services.effects[0].payload.presentation.kind ==
         MULTIPLEX_APP_SERVICES_PRESENTATION_NETWORK_ACTIVITY);
  assert(!services.effects[0].payload.presentation.payload.activity.visible);
}

static void replaces_browse_with_latest_request(void) {
  MultiplexAppServicesBrowseSlot slot = {0};
  const MultiplexAppServicesBrowseRequest first = {
      .section_id = 7,
      .start = 0,
      .previous_start = 0,
  };
  const MultiplexAppServicesBrowseRequest latest = {
      .section_id = 7,
      .start = 21,
      .previous_start = 0,
  };
  multiplex_app_services_browse_slot_request(&slot, &first);
  assert(multiplex_app_services_browse_slot_activate(&slot, 11));
  multiplex_app_services_browse_slot_request(&slot, &latest);

  MultiplexAppServicesBrowseRequest completed = {0};
  const MultiplexGatewayBrowsePage stale = {.section_id = 7, .start = 0};
  assert(multiplex_app_services_browse_slot_settle(&slot, 10, &stale,
                                                   &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_IGNORED);
  assert(multiplex_app_services_browse_slot_settle(&slot, 11, &stale,
                                                   &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED);
  assert(completed.start == 0);
  const MultiplexAppServicesBrowseRequest *queued =
      multiplex_app_services_browse_slot_queued(&slot);
  assert(queued != NULL && queued->start == 21);

  assert(multiplex_app_services_browse_slot_activate(&slot, 12));
  const MultiplexGatewayBrowsePage accepted = {.section_id = 7, .start = 21};
  assert(multiplex_app_services_browse_slot_settle(&slot, 12, &accepted,
                                                   &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED);
  assert(multiplex_app_services_browse_slot_retained_result(&slot)->start ==
         21);
}

static void cancels_browse_replacement_when_request_reverts(void) {
  MultiplexAppServicesBrowseSlot slot = {0};
  const MultiplexAppServicesBrowseRequest first = {
      .section_id = 7,
      .start = 0,
      .previous_start = 3,
  };
  const MultiplexAppServicesBrowseRequest replacement = {
      .section_id = 7,
      .start = 21,
  };
  multiplex_app_services_browse_slot_request(&slot, &first);
  assert(multiplex_app_services_browse_slot_activate(&slot, 20));
  multiplex_app_services_browse_slot_request(&slot, &replacement);
  multiplex_app_services_browse_slot_request(&slot, &first);
  const MultiplexGatewayBrowsePage page = {.section_id = 7, .start = 0};
  MultiplexAppServicesBrowseRequest completed = {0};
  assert(
      multiplex_app_services_browse_slot_settle(&slot, 20, &page, &completed) ==
      MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED);
}

static MultiplexAppServicesSearchRequest search_request(const char *query) {
  MultiplexAppServicesSearchRequest request = {
      .query_length = (uint16_t)strlen(query),
  };
  memcpy(request.query, query, request.query_length + 1u);
  return request;
}

static void replaces_search_with_latest_query(void) {
  MultiplexAppServicesSearchSlot slot = {0};
  const MultiplexAppServicesSearchRequest first = search_request("alpha");
  const MultiplexAppServicesSearchRequest latest = search_request("beta");
  multiplex_app_services_search_slot_request(&slot, &first);
  assert(multiplex_app_services_search_slot_activate(&slot, 31));
  multiplex_app_services_search_slot_request(&slot, &latest);

  MultiplexGatewaySearchPage stale = {0};
  memcpy(stale.query, "alpha", sizeof("alpha"));
  stale.query_length = 5;
  MultiplexAppServicesSearchRequest completed = {0};
  assert(multiplex_app_services_search_slot_settle(&slot, 31, &stale,
                                                   &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED);
  assert(strcmp(completed.query, "alpha") == 0);
  const MultiplexAppServicesSearchRequest *queued =
      multiplex_app_services_search_slot_queued(&slot);
  assert(queued != NULL && strcmp(queued->query, "beta") == 0);
}

static void replaces_details_without_publishing_stale_result(void) {
  MultiplexAppServicesDetailsSlot slot = {0};
  const MultiplexAppServicesDetailsRequest first = {
      .rating_key = 100,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND,
  };
  const MultiplexAppServicesDetailsRequest latest = {
      .rating_key = 200,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND,
  };
  assert(multiplex_app_services_details_slot_request(&slot, &first) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED);
  assert(multiplex_app_services_details_slot_activate(&slot, 41));
  assert(multiplex_app_services_details_slot_request(&slot, &latest) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_WAITING);

  MultiplexAppServicesDetailsRequest completed = {0};
  const MultiplexGatewayDetails stale = {.rating_key = 100};
  assert(multiplex_app_services_details_slot_settle(&slot, 41, &stale,
                                                    &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED);
  assert(completed.rating_key == 100);
  assert(multiplex_app_services_details_slot_retained_result(&slot) == NULL);
  const MultiplexAppServicesDetailsRequest *queued =
      multiplex_app_services_details_slot_queued(&slot);
  assert(queued != NULL && queued->rating_key == 200);

  assert(multiplex_app_services_details_slot_activate(&slot, 42));
  const MultiplexGatewayDetails accepted = {.rating_key = 200};
  assert(multiplex_app_services_details_slot_settle(&slot, 42, &accepted,
                                                    &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED);
  assert(
      multiplex_app_services_details_slot_retained_result(&slot)->rating_key ==
      200);
}

static void reuses_cached_details_and_retains_completed_prefetch(void) {
  MultiplexAppServicesDetailsSlot slot = {0};
  const MultiplexGatewayDetails cached = {.rating_key = 200};
  multiplex_app_services_details_slot_store_result(&slot, &cached);
  const MultiplexAppServicesDetailsRequest prefetch = {
      .rating_key = 100,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH,
  };
  assert(multiplex_app_services_details_slot_request(&slot, &prefetch) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED);
  assert(multiplex_app_services_details_slot_activate(&slot, 51));
  const MultiplexAppServicesDetailsRequest foreground = {
      .rating_key = 200,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND,
  };
  assert(multiplex_app_services_details_slot_request(&slot, &foreground) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_CACHED);
  const MultiplexGatewayDetails stale = {.rating_key = 100};
  MultiplexAppServicesDetailsRequest completed = {0};
  assert(multiplex_app_services_details_slot_settle(&slot, 51, &stale,
                                                    &completed) ==
         MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED);
  assert(completed.purpose == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH);
  assert(
      multiplex_app_services_details_slot_retained_result(&slot)->rating_key ==
      100);
}

static void preserves_foreground_details_priority(void) {
  MultiplexAppServicesDetailsSlot slot = {0};
  const MultiplexAppServicesDetailsRequest foreground = {
      .rating_key = 300,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND,
  };
  const MultiplexAppServicesDetailsRequest prefetch = {
      .rating_key = 300,
      .purpose = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH,
  };
  assert(multiplex_app_services_details_slot_request(&slot, &foreground) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED);
  assert(multiplex_app_services_details_slot_request(&slot, &prefetch) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED);
  assert(multiplex_app_services_details_slot_queued(&slot)->purpose ==
         MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND);
  assert(multiplex_app_services_details_slot_activate(&slot, 61));
  assert(multiplex_app_services_details_slot_request(&slot, &prefetch) ==
         MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_WAITING);
  MultiplexAppServicesDetailsRequest completed = {0};
  assert(
      multiplex_app_services_details_slot_settle(&slot, 61, NULL, &completed) ==
      MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED);
  assert(completed.purpose == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND);
}

int main(void) {
  app_services_content_test_reset();
  test_state = app_services_content_test_state();
  replaces_browse_with_latest_request();
  cancels_browse_replacement_when_request_reverts();
  replaces_search_with_latest_query();
  replaces_details_without_publishing_stale_result();
  reuses_cached_details_and_retains_completed_prefetch();
  preserves_foreground_details_priority();
  late_browse_result_is_retained_without_binding();
  late_foreground_details_is_retained_without_binding();
  puts("GameCube AppServices request-slot tests passed.");
  return 0;
}
