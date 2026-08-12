#include "app_services_request_slots.h"

#include <string.h>

static bool
browse_requests_match(const MultiplexAppServicesBrowseRequest *left,
                      const MultiplexAppServicesBrowseRequest *right) {
  return left->section_id == right->section_id && left->start == right->start;
}

void multiplex_app_services_browse_slot_request(
    MultiplexAppServicesBrowseSlot *slot,
    const MultiplexAppServicesBrowseRequest *request) {
  if (slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_ACTIVE) {
    if (browse_requests_match(&slot->state.active.request, request)) {
      slot->state.active.request.previous_start = request->previous_start;
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_BROWSE_LATEST_NONE;
    } else {
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_BROWSE_LATEST_PRESENT;
      slot->state.active.latest.value.request = *request;
    }
    return;
  }
  const MultiplexAppServicesBrowseResult result =
      slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_IDLE
          ? slot->state.idle.result
          : slot->state.queued.result;
  slot->kind = MULTIPLEX_APP_SERVICES_BROWSE_QUEUED;
  slot->state.queued.request = *request;
  slot->state.queued.result = result;
}

bool multiplex_app_services_browse_slot_activate(
    MultiplexAppServicesBrowseSlot *slot, uint32_t token) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_BROWSE_QUEUED || token == 0) {
    return false;
  }
  const MultiplexAppServicesBrowseRequest request = slot->state.queued.request;
  const MultiplexAppServicesBrowseResult result = slot->state.queued.result;
  slot->kind = MULTIPLEX_APP_SERVICES_BROWSE_ACTIVE;
  slot->state.active.token = token;
  slot->state.active.request = request;
  slot->state.active.latest.kind = MULTIPLEX_APP_SERVICES_BROWSE_LATEST_NONE;
  slot->state.active.result = result;
  return true;
}

MultiplexAppServicesSlotSettlement multiplex_app_services_browse_slot_settle(
    MultiplexAppServicesBrowseSlot *slot, uint32_t token,
    const MultiplexGatewayBrowsePage *page,
    MultiplexAppServicesBrowseRequest *completed) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_BROWSE_ACTIVE ||
      slot->state.active.token != token) {
    return MULTIPLEX_APP_SERVICES_SLOT_IGNORED;
  }
  *completed = slot->state.active.request;
  const MultiplexAppServicesBrowseResult prior = slot->state.active.result;
  if (slot->state.active.latest.kind ==
      MULTIPLEX_APP_SERVICES_BROWSE_LATEST_PRESENT) {
    const MultiplexAppServicesBrowseRequest latest =
        slot->state.active.latest.value.request;
    slot->kind = MULTIPLEX_APP_SERVICES_BROWSE_QUEUED;
    slot->state.queued.request = latest;
    slot->state.queued.result = prior;
    return MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED;
  }
  slot->kind = MULTIPLEX_APP_SERVICES_BROWSE_IDLE;
  slot->state.idle.result = prior;
  if (page != NULL) {
    slot->state.idle.result.kind = MULTIPLEX_APP_SERVICES_BROWSE_RESULT_PRESENT;
    slot->state.idle.result.value.page = *page;
  }
  return MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED;
}

const MultiplexAppServicesBrowseRequest *
multiplex_app_services_browse_slot_queued(
    const MultiplexAppServicesBrowseSlot *slot) {
  return slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_QUEUED
             ? &slot->state.queued.request
             : NULL;
}

const MultiplexGatewayBrowsePage *
multiplex_app_services_browse_slot_retained_result(
    const MultiplexAppServicesBrowseSlot *slot) {
  const MultiplexAppServicesBrowseResult *result = NULL;
  if (slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_IDLE) {
    result = &slot->state.idle.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_QUEUED) {
    result = &slot->state.queued.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_BROWSE_ACTIVE) {
    result = &slot->state.active.result;
  }
  if (result == NULL ||
      result->kind != MULTIPLEX_APP_SERVICES_BROWSE_RESULT_PRESENT) {
    return NULL;
  }
  return &result->value.page;
}

static bool
search_requests_match(const MultiplexAppServicesSearchRequest *left,
                      const MultiplexAppServicesSearchRequest *right) {
  return left->query_length == right->query_length &&
         memcmp(left->query, right->query, left->query_length) == 0;
}

static MultiplexAppServicesDetailsPurpose
details_request_purpose(MultiplexAppServicesDetailsPurpose current,
                        MultiplexAppServicesDetailsPurpose requested) {
  return current == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND ||
                 requested == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND
             ? MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND
             : MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH;
}

void multiplex_app_services_search_slot_request(
    MultiplexAppServicesSearchSlot *slot,
    const MultiplexAppServicesSearchRequest *request) {
  if (slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_ACTIVE) {
    if (search_requests_match(&slot->state.active.request, request)) {
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_SEARCH_LATEST_NONE;
    } else {
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_SEARCH_LATEST_PRESENT;
      slot->state.active.latest.value.request = *request;
    }
    return;
  }
  const MultiplexAppServicesSearchResult result =
      slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_IDLE
          ? slot->state.idle.result
          : slot->state.queued.result;
  slot->kind = MULTIPLEX_APP_SERVICES_SEARCH_QUEUED;
  slot->state.queued.request = *request;
  slot->state.queued.result = result;
}

bool multiplex_app_services_search_slot_activate(
    MultiplexAppServicesSearchSlot *slot, uint32_t token) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_SEARCH_QUEUED || token == 0) {
    return false;
  }
  const MultiplexAppServicesSearchRequest request = slot->state.queued.request;
  const MultiplexAppServicesSearchResult result = slot->state.queued.result;
  slot->kind = MULTIPLEX_APP_SERVICES_SEARCH_ACTIVE;
  slot->state.active.token = token;
  slot->state.active.request = request;
  slot->state.active.latest.kind = MULTIPLEX_APP_SERVICES_SEARCH_LATEST_NONE;
  slot->state.active.result = result;
  return true;
}

MultiplexAppServicesSlotSettlement multiplex_app_services_search_slot_settle(
    MultiplexAppServicesSearchSlot *slot, uint32_t token,
    const MultiplexGatewaySearchPage *page,
    MultiplexAppServicesSearchRequest *completed) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_SEARCH_ACTIVE ||
      slot->state.active.token != token) {
    return MULTIPLEX_APP_SERVICES_SLOT_IGNORED;
  }
  *completed = slot->state.active.request;
  const MultiplexAppServicesSearchResult prior = slot->state.active.result;
  if (slot->state.active.latest.kind ==
      MULTIPLEX_APP_SERVICES_SEARCH_LATEST_PRESENT) {
    const MultiplexAppServicesSearchRequest latest =
        slot->state.active.latest.value.request;
    slot->kind = MULTIPLEX_APP_SERVICES_SEARCH_QUEUED;
    slot->state.queued.request = latest;
    slot->state.queued.result = prior;
    return MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED;
  }
  slot->kind = MULTIPLEX_APP_SERVICES_SEARCH_IDLE;
  slot->state.idle.result = prior;
  if (page != NULL) {
    slot->state.idle.result.kind = MULTIPLEX_APP_SERVICES_SEARCH_RESULT_PRESENT;
    slot->state.idle.result.value.page = *page;
  }
  return MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED;
}

const MultiplexAppServicesSearchRequest *
multiplex_app_services_search_slot_queued(
    const MultiplexAppServicesSearchSlot *slot) {
  return slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_QUEUED
             ? &slot->state.queued.request
             : NULL;
}

const MultiplexGatewaySearchPage *
multiplex_app_services_search_slot_retained_result(
    const MultiplexAppServicesSearchSlot *slot) {
  const MultiplexAppServicesSearchResult *result = NULL;
  if (slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_IDLE) {
    result = &slot->state.idle.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_QUEUED) {
    result = &slot->state.queued.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_SEARCH_ACTIVE) {
    result = &slot->state.active.result;
  }
  if (result == NULL ||
      result->kind != MULTIPLEX_APP_SERVICES_SEARCH_RESULT_PRESENT) {
    return NULL;
  }
  return &result->value.page;
}

MultiplexAppServicesDetailsRequestEffect
multiplex_app_services_details_slot_request(
    MultiplexAppServicesDetailsSlot *slot,
    const MultiplexAppServicesDetailsRequest *request) {
  if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_ACTIVE) {
    if (slot->state.active.request.rating_key == request->rating_key) {
      slot->state.active.request.purpose = details_request_purpose(
          slot->state.active.request.purpose, request->purpose);
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_DETAILS_LATEST_NONE;
      return MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_WAITING;
    }
    if (slot->state.active.result.kind ==
            MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT &&
        slot->state.active.result.value.details.rating_key ==
            request->rating_key) {
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_DETAILS_LATEST_NONE;
      return MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_CACHED;
    }
    if (slot->state.active.latest.kind ==
            MULTIPLEX_APP_SERVICES_DETAILS_LATEST_PRESENT &&
        slot->state.active.latest.value.request.rating_key ==
            request->rating_key) {
      slot->state.active.latest.value.request.purpose = details_request_purpose(
          slot->state.active.latest.value.request.purpose, request->purpose);
    } else {
      slot->state.active.latest.kind =
          MULTIPLEX_APP_SERVICES_DETAILS_LATEST_PRESENT;
      slot->state.active.latest.value.request = *request;
    }
    return MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_WAITING;
  }
  MultiplexAppServicesDetailsResult result =
      slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_IDLE
          ? slot->state.idle.result
          : slot->state.queued.result;
  if (result.kind == MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT &&
      result.value.details.rating_key == request->rating_key) {
    return MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_CACHED;
  }
  MultiplexAppServicesDetailsRequest queued = *request;
  if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_QUEUED &&
      slot->state.queued.request.rating_key == request->rating_key) {
    queued.purpose = details_request_purpose(slot->state.queued.request.purpose,
                                             request->purpose);
  }
  slot->kind = MULTIPLEX_APP_SERVICES_DETAILS_QUEUED;
  slot->state.queued.request = queued;
  slot->state.queued.result = result;
  return MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED;
}

bool multiplex_app_services_details_slot_activate(
    MultiplexAppServicesDetailsSlot *slot, uint32_t token) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_DETAILS_QUEUED || token == 0) {
    return false;
  }
  const MultiplexAppServicesDetailsRequest request = slot->state.queued.request;
  const MultiplexAppServicesDetailsResult result = slot->state.queued.result;
  slot->kind = MULTIPLEX_APP_SERVICES_DETAILS_ACTIVE;
  slot->state.active.token = token;
  slot->state.active.request = request;
  slot->state.active.latest.kind = MULTIPLEX_APP_SERVICES_DETAILS_LATEST_NONE;
  slot->state.active.result = result;
  return true;
}

MultiplexAppServicesSlotSettlement multiplex_app_services_details_slot_settle(
    MultiplexAppServicesDetailsSlot *slot, uint32_t token,
    const MultiplexGatewayDetails *details,
    MultiplexAppServicesDetailsRequest *completed) {
  if (slot->kind != MULTIPLEX_APP_SERVICES_DETAILS_ACTIVE ||
      slot->state.active.token != token) {
    return MULTIPLEX_APP_SERVICES_SLOT_IGNORED;
  }
  const MultiplexAppServicesDetailsRequest active = slot->state.active.request;
  *completed = active;
  const MultiplexAppServicesDetailsResult prior = slot->state.active.result;
  if (slot->state.active.latest.kind ==
      MULTIPLEX_APP_SERVICES_DETAILS_LATEST_PRESENT) {
    const MultiplexAppServicesDetailsRequest latest =
        slot->state.active.latest.value.request;
    slot->kind = MULTIPLEX_APP_SERVICES_DETAILS_QUEUED;
    slot->state.queued.request = latest;
    slot->state.queued.result = prior;
    return MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED;
  }
  slot->kind = MULTIPLEX_APP_SERVICES_DETAILS_IDLE;
  slot->state.idle.result = prior;
  if (details != NULL) {
    slot->state.idle.result.kind =
        MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT;
    slot->state.idle.result.value.details = *details;
  }
  return MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED;
}

const MultiplexAppServicesDetailsRequest *
multiplex_app_services_details_slot_queued(
    const MultiplexAppServicesDetailsSlot *slot) {
  return slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_QUEUED
             ? &slot->state.queued.request
             : NULL;
}

const MultiplexGatewayDetails *
multiplex_app_services_details_slot_retained_result(
    const MultiplexAppServicesDetailsSlot *slot) {
  const MultiplexAppServicesDetailsResult *result = NULL;
  if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_IDLE) {
    result = &slot->state.idle.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_QUEUED) {
    result = &slot->state.queued.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_ACTIVE) {
    result = &slot->state.active.result;
  }
  return result != NULL &&
                 result->kind == MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT
             ? &result->value.details
             : NULL;
}

void multiplex_app_services_details_slot_store_result(
    MultiplexAppServicesDetailsSlot *slot,
    const MultiplexGatewayDetails *details) {
  MultiplexAppServicesDetailsResult *result = NULL;
  if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_IDLE) {
    result = &slot->state.idle.result;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_DETAILS_QUEUED) {
    result = &slot->state.queued.result;
  } else {
    result = &slot->state.active.result;
  }
  result->kind = MULTIPLEX_APP_SERVICES_DETAILS_RESULT_PRESENT;
  result->value.details = *details;
}
