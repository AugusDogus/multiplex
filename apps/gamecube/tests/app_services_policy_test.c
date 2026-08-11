#include "app_services_policy.h"

#include <assert.h>
#include <stdio.h>

static void rejects_stale_results(void) {
  MultiplexAppServicesLoadState state = {
      .kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING,
      .token = 7,
  };
  assert(!multiplex_app_services_accept_result(&state, 6));
  assert(state.kind == MULTIPLEX_APP_SERVICES_LOAD_LOADING);
  assert(state.token == 7);
  assert(multiplex_app_services_accept_result(&state, 7));
  assert(state.kind == MULTIPLEX_APP_SERVICES_LOAD_IDLE);
  assert(state.token == 0);
  assert(!multiplex_app_services_accept_result(&state, 7));
}

static void advances_and_resets_auth_retry(void) {
  MultiplexAppServicesRetry retry;
  multiplex_app_services_retry_initialize(&retry, 1000, 8000);
  assert(!multiplex_app_services_retry_due(&retry, 1000));

  multiplex_app_services_retry_schedule(&retry, 500);
  assert(retry.at_ms == 1500);
  assert(retry.delay_ms == 2000);
  assert(!multiplex_app_services_retry_due(&retry, 1499));
  assert(multiplex_app_services_retry_due(&retry, 1500));

  multiplex_app_services_retry_schedule(&retry, 1500);
  assert(retry.at_ms == 3500);
  assert(retry.delay_ms == 4000);
  multiplex_app_services_retry_reset(&retry);
  assert(retry.kind == MULTIPLEX_APP_SERVICES_RETRY_INACTIVE);
  assert(retry.delay_ms == 1000);
}

static void starts_cached_refresh_after_network_recovery(void) {
  const MultiplexAppServicesLoadState cached = {
      .kind = MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING,
  };
  assert(!multiplex_app_services_load_should_start(&cached, false));
  assert(multiplex_app_services_load_should_start(&cached, true));

  const MultiplexAppServicesLoadState ready = {
      .kind = MULTIPLEX_APP_SERVICES_LOAD_READY,
  };
  assert(!multiplex_app_services_load_should_start(&ready, true));
}

static void schedules_watch_reconnect(void) {
  MultiplexAppServicesRetry reconnect;
  multiplex_app_services_retry_initialize(&reconnect, 1000, 1000);
  multiplex_app_services_retry_schedule(&reconnect, 9000);
  assert(!multiplex_app_services_retry_due(&reconnect, 9999));
  assert(multiplex_app_services_retry_due(&reconnect, 10000));
  multiplex_app_services_retry_schedule(&reconnect, 10000);
  assert(reconnect.at_ms == 11000);
  assert(reconnect.delay_ms == 1000);
}

static void drives_watch_presence(void) {
  uint64_t gathered_at = 0;
  assert(!multiplex_app_services_presence_step(2, 1, 1000, 1200, &gathered_at));
  assert(gathered_at == 0);
  assert(!multiplex_app_services_presence_step(2, 2, 2000, 1200, &gathered_at));
  assert(gathered_at == 2000);
  assert(!multiplex_app_services_presence_step(2, 2, 3199, 1200, &gathered_at));
  assert(multiplex_app_services_presence_step(2, 2, 3200, 1200, &gathered_at));
  assert(!multiplex_app_services_presence_step(2, 1, 3201, 1200, &gathered_at));
  assert(gathered_at == 0);
}

int main(void) {
  rejects_stale_results();
  advances_and_resets_auth_retry();
  starts_cached_refresh_after_network_recovery();
  schedules_watch_reconnect();
  drives_watch_presence();
  puts("GameCube AppServices policy tests passed.");
  return 0;
}
