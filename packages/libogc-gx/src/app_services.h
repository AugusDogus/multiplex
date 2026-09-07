#ifndef MULTIPLEX_APP_SERVICES_H
#define MULTIPLEX_APP_SERVICES_H

#include "app_services_contract.h"
#include "memory_card_auth.h"

#include <stddef.h>

typedef struct MultiplexAppServices MultiplexAppServices;

typedef enum {
  MULTIPLEX_APP_SERVICES_STARTUP_LOADING = 0,
  MULTIPLEX_APP_SERVICES_STARTUP_READY,
  MULTIPLEX_APP_SERVICES_STARTUP_ACCOUNT_ERROR,
  MULTIPLEX_APP_SERVICES_STARTUP_LIBRARY_ERROR,
} MultiplexAppServicesStartupStatus;

MultiplexAppServicesStartupStatus
multiplex_app_services_startup_status(const MultiplexAppServices *services);
void multiplex_app_services_retry_startup(MultiplexAppServices *services,
                                          uint64_t now_ms);

MultiplexAppServices *multiplex_app_services_create(void);
void multiplex_app_services_destroy(MultiplexAppServices **services);
MultiplexAppServicesDispatchResult
multiplex_app_services_dispatch(MultiplexAppServices *services,
                                const MultiplexAppServicesInput *input);
bool multiplex_app_services_poll_effect(MultiplexAppServices *services,
                                        MultiplexAppServicesEffect *effect);
bool multiplex_app_services_copy_poster_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *plan,
    MultiplexGatewayItem *destination, uint16_t capacity,
    MultiplexAuthCredentials *credentials);
bool multiplex_app_services_copy_cache_save_plan(
    const MultiplexAppServices *services,
    const MultiplexAppServicesWorkRequest *request,
    MultiplexMemoryCardLocation *location, uint8_t *destination,
    size_t capacity);
uint32_t
multiplex_app_services_startup_rating_key(const MultiplexAppServices *services);

#endif
