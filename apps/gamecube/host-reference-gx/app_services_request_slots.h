#ifndef MULTIPLEX_APP_SERVICES_REQUEST_SLOTS_H
#define MULTIPLEX_APP_SERVICES_REQUEST_SLOTS_H

#include "app_services_internal.h"

typedef enum {
  MULTIPLEX_APP_SERVICES_SLOT_IGNORED = 0,
  MULTIPLEX_APP_SERVICES_SLOT_ACCEPTED = 1,
  MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED = 2,
} MultiplexAppServicesSlotSettlement;

typedef enum {
  MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_QUEUED = 0,
  MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_WAITING = 1,
  MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_CACHED = 2,
} MultiplexAppServicesDetailsRequestEffect;

void multiplex_app_services_browse_slot_request(
    MultiplexAppServicesBrowseSlot *slot,
    const MultiplexAppServicesBrowseRequest *request);
bool multiplex_app_services_browse_slot_activate(
    MultiplexAppServicesBrowseSlot *slot, uint32_t token);
MultiplexAppServicesSlotSettlement multiplex_app_services_browse_slot_settle(
    MultiplexAppServicesBrowseSlot *slot, uint32_t token,
    const MultiplexGatewayBrowsePage *page,
    MultiplexAppServicesBrowseRequest *completed);
const MultiplexAppServicesBrowseRequest *
multiplex_app_services_browse_slot_queued(
    const MultiplexAppServicesBrowseSlot *slot);
const MultiplexGatewayBrowsePage *
multiplex_app_services_browse_slot_retained_result(
    const MultiplexAppServicesBrowseSlot *slot);

void multiplex_app_services_search_slot_request(
    MultiplexAppServicesSearchSlot *slot,
    const MultiplexAppServicesSearchRequest *request);
bool multiplex_app_services_search_slot_activate(
    MultiplexAppServicesSearchSlot *slot, uint32_t token);
MultiplexAppServicesSlotSettlement multiplex_app_services_search_slot_settle(
    MultiplexAppServicesSearchSlot *slot, uint32_t token,
    const MultiplexGatewaySearchPage *page,
    MultiplexAppServicesSearchRequest *completed);
const MultiplexAppServicesSearchRequest *
multiplex_app_services_search_slot_queued(
    const MultiplexAppServicesSearchSlot *slot);
const MultiplexGatewaySearchPage *
multiplex_app_services_search_slot_retained_result(
    const MultiplexAppServicesSearchSlot *slot);

MultiplexAppServicesDetailsRequestEffect
multiplex_app_services_details_slot_request(
    MultiplexAppServicesDetailsSlot *slot,
    const MultiplexAppServicesDetailsRequest *request);
bool multiplex_app_services_details_slot_activate(
    MultiplexAppServicesDetailsSlot *slot, uint32_t token);
MultiplexAppServicesSlotSettlement multiplex_app_services_details_slot_settle(
    MultiplexAppServicesDetailsSlot *slot, uint32_t token,
    const MultiplexGatewayDetails *details,
    MultiplexAppServicesDetailsRequest *completed);
const MultiplexAppServicesDetailsRequest *
multiplex_app_services_details_slot_queued(
    const MultiplexAppServicesDetailsSlot *slot);
const MultiplexGatewayDetails *
multiplex_app_services_details_slot_retained_result(
    const MultiplexAppServicesDetailsSlot *slot);
void multiplex_app_services_details_slot_store_result(
    MultiplexAppServicesDetailsSlot *slot,
    const MultiplexGatewayDetails *details);

#endif
