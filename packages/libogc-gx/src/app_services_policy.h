#ifndef MULTIPLEX_APP_SERVICES_POLICY_H
#define MULTIPLEX_APP_SERVICES_POLICY_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  MULTIPLEX_APP_SERVICES_RETRY_INACTIVE = 0,
  MULTIPLEX_APP_SERVICES_RETRY_SCHEDULED = 1,
} MultiplexAppServicesRetryKind;

typedef struct {
  MultiplexAppServicesRetryKind kind;
  uint64_t at_ms;
  uint32_t delay_ms;
  uint32_t initial_delay_ms;
  uint32_t maximum_delay_ms;
} MultiplexAppServicesRetry;

typedef enum {
  MULTIPLEX_APP_SERVICES_LOAD_IDLE = 0,
  MULTIPLEX_APP_SERVICES_LOAD_LOADING = 1,
  MULTIPLEX_APP_SERVICES_LOAD_READY = 2,
  MULTIPLEX_APP_SERVICES_LOAD_FAILED = 3,
  MULTIPLEX_APP_SERVICES_LOAD_RETRY_WAIT = 4,
  MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING = 5,
} MultiplexAppServicesLoadKind;

typedef struct {
  MultiplexAppServicesLoadKind kind;
  uint32_t token;
} MultiplexAppServicesLoadState;

void multiplex_app_services_retry_initialize(MultiplexAppServicesRetry *retry,
                                             uint32_t initial_delay_ms,
                                             uint32_t maximum_delay_ms);
void multiplex_app_services_retry_reset(MultiplexAppServicesRetry *retry);
void multiplex_app_services_retry_schedule(MultiplexAppServicesRetry *retry,
                                           uint64_t now_ms);
bool multiplex_app_services_retry_due(const MultiplexAppServicesRetry *retry,
                                      uint64_t now_ms);
bool multiplex_app_services_presence_step(uint8_t expected, uint8_t present,
                                          uint64_t now_ms, uint64_t delay_ms,
                                          uint64_t *all_present_since_ms);
bool multiplex_app_services_accept_result(MultiplexAppServicesLoadState *state,
                                          uint32_t token);
bool multiplex_app_services_load_should_start(
    const MultiplexAppServicesLoadState *state, bool network_allowed);
#endif
