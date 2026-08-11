#include "app_jobs_test_support.h"

#include "gateway_client.h"
#include "memory_card_auth.h"
#include "plex_catalog.h"
#include "poster_jpeg.h"
#include "trpc_client.h"

#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

void SYS_Report(const char *message, ...) { (void)message; }

MultiplexAppServicesDispatchResult
multiplex_app_services_dispatch(MultiplexAppServices *services,
                                const MultiplexAppServicesInput *input) {
  (void)services;
  (void)input;
  return MULTIPLEX_APP_SERVICES_DISPATCH_READY;
}

bool multiplex_app_services_copy_cache_save_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesWorkRequest *request,
    MultiplexMemoryCardLocation *location, uint8_t *destination,
    size_t capacity) {
  AppJobsTestFixture *fixture = services->fixture;
  (void)fixture;
  if (request->kind != MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE) {
    return false;
  }
  memset(destination, 0x5a, capacity);
  *location = (MultiplexMemoryCardLocation){.slot = 1, .generation = 7};
  return true;
}

bool multiplex_app_services_copy_poster_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *plan,
    MultiplexGatewayItem *destination, uint16_t capacity,
    MultiplexAuthCredentials *credentials) {
  AppJobsTestFixture *fixture = services->fixture;
  if (capacity < plan->item_count) {
    return false;
  }
  fixture->poster_copy_count += 1;
  memset(credentials, 0xa5, sizeof(*credentials));
  for (uint16_t index = 0; index < plan->item_count; ++index) {
    memset(&destination[index], 0, sizeof(destination[index]));
    destination[index].rating_key = 100u + index;
    snprintf(destination[index].artwork_path,
             sizeof(destination[index].artwork_path), "/poster/%u", index);
  }
  return true;
}

bool multiplex_plex_load_catalog(const MultiplexAuthCredentials *credentials,
                                 MultiplexGatewayCatalog *catalog) {
  (void)credentials;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_CATALOG, catalog);
  return true;
}

bool multiplex_plex_load_browse(const MultiplexAuthCredentials *credentials,
                                const MultiplexGatewayLibrary *library,
                                uint16_t start,
                                MultiplexGatewayBrowsePage *page) {
  (void)credentials;
  (void)library;
  (void)start;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_BROWSE, page);
  return true;
}

bool multiplex_plex_load_search(const MultiplexAuthCredentials *credentials,
                                const char *query, uint16_t query_length,
                                MultiplexGatewaySearchPage *page) {
  (void)credentials;
  (void)query;
  (void)query_length;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_SEARCH, page);
  return true;
}

bool multiplex_plex_load_details(const MultiplexAuthCredentials *credentials,
                                 uint32_t rating_key,
                                 MultiplexGatewayDetails *details) {
  (void)credentials;
  (void)rating_key;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_DETAILS, details);
  return true;
}

bool multiplex_plex_load_artwork(const MultiplexAuthCredentials *credentials,
                                 const char *artwork_path, uint8_t *destination,
                                 size_t capacity, size_t *encoded_size) {
  (void)credentials;
  (void)artwork_path;
  if (capacity == 0) {
    return false;
  }
  destination[0] = 0xff;
  *encoded_size = 1;
  return true;
}

MultiplexMemoryCardResult
multiplex_memory_card_save_cache(const MultiplexMemoryCardLocation *location,
                                 const uint8_t *source, size_t size) {
  AppJobsTestFixture *fixture = app_jobs_test_current();
  fixture->work_runs[MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE] += 1;
  fixture->work_run_order[fixture->work_run_count++] =
      MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE;
  fixture->cache_snapshot_seen =
      location->generation == 7 && size != 0 && source[0] == 0x5a;
  return MULTIPLEX_MEMORY_CARD_OK;
}

bool multiplex_trpc_load_user_id(const char *base_url, const char *bearer_token,
                                 uint32_t *user_id) {
  (void)base_url;
  (void)bearer_token;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA, user_id);
  *user_id = 42;
  return true;
}

bool multiplex_trpc_load_watch_together_rooms(const char *base_url,
                                              const char *bearer_token,
                                              MultiplexTrpcRoomList *list) {
  (void)base_url;
  (void)bearer_token;
  memset(list, 0, sizeof(*list));
  return true;
}

bool multiplex_trpc_load_watch_together_invitees(
    const char *base_url, const char *bearer_token,
    MultiplexTrpcInviteeList *list) {
  (void)base_url;
  (void)bearer_token;
  memset(list, 0, sizeof(*list));
  return true;
}

bool multiplex_gateway_load_catalog(const char *base_url,
                                    MultiplexGatewayCatalog *catalog) {
  (void)base_url;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_CATALOG, catalog);
  return true;
}

bool multiplex_gateway_load_browse(const char *base_url, uint16_t section_id,
                                   uint16_t start,
                                   MultiplexGatewayBrowsePage *page) {
  (void)base_url;
  (void)section_id;
  (void)start;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_BROWSE, page);
  return true;
}

bool multiplex_gateway_load_search(const char *base_url, const char *query,
                                   uint16_t query_length,
                                   MultiplexGatewaySearchPage *page) {
  (void)base_url;
  (void)query;
  (void)query_length;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_SEARCH, page);
  return true;
}

bool multiplex_gateway_load_details(const char *base_url, uint32_t rating_key,
                                    MultiplexGatewayDetails *details) {
  (void)base_url;
  (void)rating_key;
  app_jobs_test_record_work(MULTIPLEX_APP_SERVICES_WORK_DETAILS, details);
  return true;
}

bool multiplex_gateway_load_artwork(const char *base_url, uint8_t *destination,
                                    size_t capacity, size_t *encoded_size) {
  (void)base_url;
  if (capacity == 0) {
    return false;
  }
  destination[0] = 0xff;
  *encoded_size = 1;
  return true;
}

bool multiplex_gateway_load_browse_artwork(const char *base_url,
                                           uint16_t section_id, uint16_t start,
                                           uint8_t *destination,
                                           size_t capacity,
                                           size_t *encoded_size) {
  (void)section_id;
  (void)start;
  return multiplex_gateway_load_artwork(base_url, destination, capacity,
                                        encoded_size);
}

bool multiplex_gateway_load_search_artwork(
    const char *base_url, const char *query, uint16_t query_length,
    uint8_t *destination, size_t capacity, size_t *encoded_size) {
  (void)query;
  (void)query_length;
  return multiplex_gateway_load_artwork(base_url, destination, capacity,
                                        encoded_size);
}

bool poster_jpeg_decode_single(const uint8_t *encoded, size_t encoded_size,
                               uint8_t *texture_pixels,
                               size_t texture_capacity) {
  AppJobsTestFixture *fixture = app_jobs_test_current();
  if (!fixture->poster_decode_succeeds || encoded_size == 0 ||
      texture_capacity < MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES) {
    return false;
  }
  memset(texture_pixels, encoded[0], MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES);
  return true;
}

bool poster_jpeg_decode(const uint8_t *encoded, size_t encoded_size,
                        uint16_t item_count, uint8_t *texture_pixels,
                        size_t texture_capacity) {
  (void)encoded;
  (void)encoded_size;
  (void)item_count;
  (void)texture_pixels;
  (void)texture_capacity;
  return true;
}

bool poster_jpeg_decode_columns(const uint8_t *encoded, size_t encoded_size,
                                uint16_t item_count, unsigned columns,
                                uint8_t *texture_pixels,
                                size_t texture_capacity) {
  (void)columns;
  return poster_jpeg_decode(encoded, encoded_size, item_count, texture_pixels,
                            texture_capacity);
}

bool multiplex_presentation_posters_begin(
    MultiplexPresentation *presentation, uint16_t offset, uint16_t count,
    MultiplexPresentationPosterWriteMode mode,
    MultiplexPresentationPosterWrite *write) {
  AppJobsTestFixture *fixture = presentation->fixture;
  (void)offset;
  (void)mode;
  if (count > 4) {
    return false;
  }
  fixture->poster_begin_count += 1;
  *write = (MultiplexPresentationPosterWrite){
      .pixels = fixture->poster_pixels,
      .token = fixture->poster_begin_count,
  };
  return true;
}

bool multiplex_presentation_posters_reuse(
    MultiplexPresentation *presentation,
    const MultiplexPresentationPosterWrite *write, uint16_t index,
    uint32_t rating_key) {
  (void)write;
  (void)index;
  (void)rating_key;
  return presentation->fixture->poster_reuse_all;
}

bool multiplex_presentation_posters_commit(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write, const uint32_t *rating_keys) {
  AppJobsTestFixture *fixture = presentation->fixture;
  (void)write;
  (void)rating_keys;
  fixture->poster_commit_count += 1;
  if (fixture->poster_begin_count > 1) {
    fixture->poster_consumed_count += 1;
  }
  return true;
}

void multiplex_presentation_posters_cancel(
    MultiplexPresentation *presentation,
    MultiplexPresentationPosterWrite *write) {
  (void)write;
  presentation->fixture->poster_cancel_count += 1;
}

bool multiplex_playback_session_retain_hls_prefetch(
    MultiplexPlaybackSession *session,
    const MultiplexPlaybackPrefetchRequest *request) {
  AppJobsTestFixture *fixture = session->fixture;
  if (request->rating_key == 0) {
    return false;
  }
  fixture->prefetch_retain_count += 1;
  return fixture->prefetch_retain_succeeds;
}

bool multiplex_playback_session_release_hls_prefetch(
    MultiplexPlaybackSession *session) {
  AppJobsTestFixture *fixture = session->fixture;
  fixture->prefetch_release_count += 1;
  return fixture->prefetch_release_succeeds;
}

MultiplexPlaybackHlsPrefetchStatus
multiplex_playback_session_hls_prefetch_status(
    MultiplexPlaybackSession *session) {
  return session->fixture->prefetch_status;
}

void multiplex_playback_session_discard_hls_prefetch(
    MultiplexPlaybackSession *session) {
  AppJobsTestFixture *fixture = session->fixture;
  fixture->prefetch_discard_count += 1;
  assert(fixture->event_count < APP_JOBS_TEST_MAX_EVENTS);
  fixture->events[fixture->event_count++] = 'D';
}
