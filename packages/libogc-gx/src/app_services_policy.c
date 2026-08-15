#include "app_services_policy.h"

#include <limits.h>
#include <stddef.h>

void multiplex_app_services_retry_initialize(MultiplexAppServicesRetry *retry,
                                             uint32_t initial_delay_ms,
                                             uint32_t maximum_delay_ms) {
  retry->kind = MULTIPLEX_APP_SERVICES_RETRY_INACTIVE;
  retry->at_ms = 0;
  retry->delay_ms = initial_delay_ms;
  retry->initial_delay_ms = initial_delay_ms;
  retry->maximum_delay_ms = maximum_delay_ms;
}

void multiplex_app_services_retry_reset(MultiplexAppServicesRetry *retry) {
  retry->kind = MULTIPLEX_APP_SERVICES_RETRY_INACTIVE;
  retry->at_ms = 0;
  retry->delay_ms = retry->initial_delay_ms;
}

void multiplex_app_services_retry_schedule(MultiplexAppServicesRetry *retry,
                                           uint64_t now_ms) {
  retry->kind = MULTIPLEX_APP_SERVICES_RETRY_SCHEDULED;
  retry->at_ms = now_ms + retry->delay_ms;
  if (retry->delay_ms < retry->maximum_delay_ms) {
    const uint32_t doubled =
        retry->delay_ms > UINT32_MAX / 2u ? UINT32_MAX : retry->delay_ms * 2u;
    retry->delay_ms =
        doubled < retry->maximum_delay_ms ? doubled : retry->maximum_delay_ms;
  }
}

bool multiplex_app_services_retry_due(const MultiplexAppServicesRetry *retry,
                                      uint64_t now_ms) {
  return retry->kind == MULTIPLEX_APP_SERVICES_RETRY_SCHEDULED &&
         now_ms >= retry->at_ms;
}

bool multiplex_app_services_presence_step(uint8_t expected, uint8_t present,
                                          uint64_t now_ms, uint64_t delay_ms,
                                          uint64_t *all_present_since_ms) {
  if (all_present_since_ms == NULL) {
    return false;
  }
  if (expected <= 1u || present < expected) {
    *all_present_since_ms = 0;
    return false;
  }
  if (*all_present_since_ms == 0) {
    *all_present_since_ms = now_ms;
    return false;
  }
  return now_ms - *all_present_since_ms >= delay_ms;
}

bool multiplex_app_services_accept_result(MultiplexAppServicesLoadState *state,
                                          uint32_t token) {
  if (state->kind != MULTIPLEX_APP_SERVICES_LOAD_LOADING ||
      state->token != token) {
    return false;
  }
  state->kind = MULTIPLEX_APP_SERVICES_LOAD_IDLE;
  state->token = 0;
  return true;
}

bool multiplex_app_services_load_should_start(
    const MultiplexAppServicesLoadState *state, bool network_allowed) {
  if (state == NULL || !network_allowed) {
    return false;
  }
  return state->kind == MULTIPLEX_APP_SERVICES_LOAD_IDLE ||
         state->kind == MULTIPLEX_APP_SERVICES_LOAD_FAILED ||
         state->kind == MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
}

bool multiplex_app_services_watch_should_follow_room(uint32_t duration_ms,
                                                     uint32_t local_position_ms,
                                                     uint32_t room_position_ms,
                                                     bool room_position_known) {
  const uint32_t end_tolerance_ms = 500u;
  if (!room_position_known || duration_ms == 0 ||
      room_position_ms <= local_position_ms) {
    return false;
  }
  const uint32_t end_threshold =
      duration_ms > end_tolerance_ms ? duration_ms - end_tolerance_ms : 0;
  return room_position_ms >= end_threshold;
}
