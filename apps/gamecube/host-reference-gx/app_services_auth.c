#include "app_services_internal.h"

#include "media-source.h"
#include "native_ui.h"
#include "plex_bootstrap.h"

#include <ogc/system.h>

#include <string.h>

#define PAIRING_POLL_INTERVAL_FRAMES 60u
#define PAIRING_RETRY_MAX_DELAY_MS 8000u

static bool bind_pairing(const MultiplexDeviceAuth *auth) {
  return multiplex_native_app_pairing_status(
             auth->status, (const uint8_t *)auth->user_code,
             strlen(auth->user_code), (const uint8_t *)auth->link_url,
             strlen(auth->link_url)) != 0;
}

static MultiplexMemoryCardLocation
auth_location(const MultiplexAppServicesAuthState *auth) {
  switch (auth->kind) {
  case MULTIPLEX_APP_SERVICES_AUTH_RESTORING:
    return auth->state.restoring.location;
  case MULTIPLEX_APP_SERVICES_AUTH_PAIRING:
    return auth->state.pairing.location;
  case MULTIPLEX_APP_SERVICES_AUTH_LINKED:
    return auth->state.linked.location;
  case MULTIPLEX_APP_SERVICES_AUTH_RETRY_WAIT:
    return auth->state.retry_wait.location;
  }
  return (MultiplexMemoryCardLocation){.slot = -1};
}

static void initialize_retry(MultiplexAppServicesRetry *retry) {
  multiplex_app_services_retry_initialize(
      retry, MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS,
      PAIRING_RETRY_MAX_DELAY_MS);
}

static void persist_linked(MultiplexAppServices *services) {
  MultiplexAppServicesAuthLinked *linked = &services->auth.state.linked;
  const MultiplexMemoryCardResult saved =
      multiplex_memory_card_save_auth(&linked->credentials, &linked->location);
  SYS_Report("REFERENCE GX: auth persistence=%s\n",
             multiplex_memory_card_result_message(saved));
}

static void refresh_linked(MultiplexAppServices *services) {
  MultiplexAppServicesAuthLinked *linked = &services->auth.state.linked;
  bool changed = false;
  if (linked->credentials.plex_token[0] == '\0') {
    changed = multiplex_device_auth_refresh_credentials(
        linked->credentials.origin, &linked->credentials);
  }
  if (linked->credentials.plex_server_url[0] == '\0' &&
      multiplex_plex_bootstrap_credentials(&linked->credentials,
                                           MULTIPLEX_PLEX_BASE_URL)) {
    changed = true;
  }
  if (changed || linked->location.needs_presentation) {
    persist_linked(services);
  }
}

static bool enter_retry_wait(MultiplexAppServices *services,
                             MultiplexMemoryCardLocation location,
                             uint64_t now_ms, uint32_t retry_delay_ms) {
  MultiplexDeviceAuth unavailable = {
      .status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE,
  };
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_RETRY_WAIT;
  services->auth.state.retry_wait = (MultiplexAppServicesAuthRetryWait){
      .location = location,
      .device_auth = unavailable,
  };
  initialize_retry(&services->auth.state.retry_wait.retry);
  services->auth.state.retry_wait.retry.delay_ms = retry_delay_ms;
  multiplex_app_services_retry_schedule(&services->auth.state.retry_wait.retry,
                                        now_ms);
  return bind_pairing(&unavailable) &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_auth_begin_pairing(
    MultiplexAppServices *services, MultiplexMemoryCardLocation location,
    uint64_t now_ms, uint32_t retry_delay_ms) {
  MultiplexAppServicesAuthPairing pairing = {
      .location = location,
  };
  if (!multiplex_device_auth_begin(MULTIPLEX_BASE_URL, &pairing.device_auth)) {
    return enter_retry_wait(services, location, now_ms, retry_delay_ms);
  }
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_PAIRING;
  services->auth.state.pairing = pairing;
  return bind_pairing(&services->auth.state.pairing.device_auth) &&
         multiplex_app_services_queue_refresh(services, false);
}

void multiplex_app_services_auth_initialize(MultiplexAppServices *services) {
  services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_RESTORING;
  services->auth.network_allowed = false;
  services->auth.state.restoring.location.slot = -1;
}

bool multiplex_app_services_auth_boot(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed) {
  services->auth.network_allowed = network_allowed;
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY) {
    services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_LINKED;
    services->auth.state.linked = (MultiplexAppServicesAuthLinked){
        .location = {.slot = -1},
    };
    return true;
  }
  MultiplexAuthCredentials credentials = {0};
  MultiplexMemoryCardLocation location = {.slot = -1};
  uint8_t cached_catalog[MULTIPLEX_CATALOG_CACHE_SIZE] = {0};
  const MultiplexMemoryCardResult stored =
      multiplex_memory_card_load_auth_with_cache(
          &credentials, &location, cached_catalog, sizeof(cached_catalog));
  if (stored == MULTIPLEX_MEMORY_CARD_OK) {
    services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_LINKED;
    services->auth.state.linked = (MultiplexAppServicesAuthLinked){
        .credentials = credentials,
        .location = location,
        .cached_catalog_available = true,
    };
    memcpy(services->auth.state.linked.cached_catalog, cached_catalog,
           sizeof(cached_catalog));
    if (network_allowed) {
      refresh_linked(services);
    }
    const MultiplexDeviceAuth linked = {
        .status = MULTIPLEX_DEVICE_AUTH_LINKED,
    };
    return bind_pairing(&linked) &&
           multiplex_app_services_queue_refresh(services, false);
  }
  return network_allowed
             ? multiplex_app_services_auth_begin_pairing(
                   services, location, now_ms,
                   MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS)
             : enter_retry_wait(
                   services, location, now_ms,
                   MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS);
}

bool multiplex_app_services_auth_tick(MultiplexAppServices *services,
                                      uint64_t now_ms, bool network_allowed) {
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY) {
    return true;
  }
  const bool network_recovered =
      !services->auth.network_allowed && network_allowed;
  services->auth.network_allowed = network_allowed;
  if (services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_LINKED) {
    if (network_recovered) {
      refresh_linked(services);
    }
    return true;
  }
  if (!network_allowed) {
    return true;
  }
  if (services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_RETRY_WAIT) {
    MultiplexAppServicesAuthRetryWait *retry = &services->auth.state.retry_wait;
    if (multiplex_app_services_retry_due(&retry->retry, now_ms)) {
      const MultiplexMemoryCardLocation location = retry->location;
      const uint32_t next_delay_ms = retry->retry.delay_ms;
      return multiplex_app_services_auth_begin_pairing(services, location,
                                                       now_ms, next_delay_ms);
    }
    return true;
  }
  if (services->auth.kind != MULTIPLEX_APP_SERVICES_AUTH_PAIRING) {
    return true;
  }
  MultiplexAppServicesAuthPairing *pairing = &services->auth.state.pairing;
  if (pairing->device_auth.status != MULTIPLEX_DEVICE_AUTH_WAITING) {
    return true;
  }
  pairing->pairing_poll_frames += 1u;
  const uint32_t interval_frames =
      (uint32_t)pairing->device_auth.interval_seconds *
      PAIRING_POLL_INTERVAL_FRAMES;
  if (pairing->pairing_poll_frames < interval_frames) {
    return true;
  }
  pairing->pairing_poll_frames = 0;
  const MultiplexDeviceAuthStatus previous = pairing->device_auth.status;
  if (!multiplex_device_auth_poll(MULTIPLEX_BASE_URL, &pairing->device_auth,
                                  &pairing->credentials)) {
    SYS_Report("REFERENCE GX: device authorization poll unavailable\n");
  }
  if (pairing->device_auth.status == previous) {
    return true;
  }
  const MultiplexDeviceAuth status = pairing->device_auth;
  if (status.status == MULTIPLEX_DEVICE_AUTH_LINKED) {
    const MultiplexAuthCredentials credentials = pairing->credentials;
    const MultiplexMemoryCardLocation location = pairing->location;
    services->auth.kind = MULTIPLEX_APP_SERVICES_AUTH_LINKED;
    services->auth.state.linked = (MultiplexAppServicesAuthLinked){
        .credentials = credentials,
        .location = location,
    };
    multiplex_plex_bootstrap_credentials(
        &services->auth.state.linked.credentials, MULTIPLEX_PLEX_BASE_URL);
    persist_linked(services);
  } else if (status.status == MULTIPLEX_DEVICE_AUTH_UNAVAILABLE) {
    const MultiplexMemoryCardLocation location = pairing->location;
    return enter_retry_wait(
        services, location, now_ms,
        MULTIPLEX_APP_SERVICES_PAIRING_RETRY_INITIAL_DELAY_MS);
  }
  return bind_pairing(&status) &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_auth_prepare_reset(
    const MultiplexAppServices *services, MultiplexMemoryCardLocation *location,
    bool *deleted) {
  if (services == NULL || location == NULL || deleted == NULL ||
      services->auth.kind != MULTIPLEX_APP_SERVICES_AUTH_LINKED) {
    return false;
  }
  *deleted = false;
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY) {
    return true;
  }
  *location = auth_location(&services->auth);
  const MultiplexMemoryCardResult deletion =
      multiplex_memory_card_delete_auth(location);
  SYS_Report("REFERENCE GX: linked-account reset=%s\n",
             multiplex_memory_card_result_message(deletion));
  *deleted = deletion == MULTIPLEX_MEMORY_CARD_OK;
  return true;
}

bool multiplex_app_services_auth_linked(const MultiplexAppServices *services) {
  return services != NULL &&
         services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_LINKED;
}

const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services) {
  return multiplex_app_services_auth_linked(services)
             ? &services->auth.state.linked.credentials
             : NULL;
}
