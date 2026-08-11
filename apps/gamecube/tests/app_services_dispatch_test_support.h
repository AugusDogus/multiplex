#ifndef MULTIPLEX_APP_SERVICES_DISPATCH_TEST_SUPPORT_H
#define MULTIPLEX_APP_SERVICES_DISPATCH_TEST_SUPPORT_H

#include "app_services_internal.h"

typedef struct {
  unsigned browse_requests;
  MultiplexAppServicesBrowsePayload last_browse;
  bool details_action_queued;
  bool details_schedule_starts;
  bool details_prefetch_queued;
  uint32_t details_prefetch_token;
  bool watch_action_queued;
  unsigned details_network_calls;
  unsigned watch_network_calls;
  unsigned watch_startup_results;
  MultiplexAppServicesStartupDataResultView last_watch_startup;
  bool auth_delete_succeeds;
  bool auth_delete_observed_cache_save_idle;
  unsigned auth_delete_attempts;
  unsigned auth_pairing_begins;
  unsigned auth_ticks;
  unsigned catalog_ticks;
  unsigned catalog_boots;
  uint64_t last_pairing_now_ms;
  uint32_t last_pairing_retry_delay_ms;
  MultiplexMemoryCardLocation last_pairing_location;
  unsigned watch_resets;
} AppServicesDispatchTestState;

#define APP_SERVICES_DISPATCH_TEST_PLAYBACK_TOKEN 77u

AppServicesDispatchTestState *app_services_dispatch_test_state(void);
void app_services_dispatch_test_reset(void);
void app_services_dispatch_test_assert_blocking(
    const MultiplexAppServicesEffect *effect, bool visible);
void app_services_dispatch_test_set_focus(MultiplexAppServices *services,
                                          MultiplexAppServicesScreen screen);
void app_services_dispatch_test_start_posters(MultiplexAppServices *services,
                                              uint32_t token);

#endif
