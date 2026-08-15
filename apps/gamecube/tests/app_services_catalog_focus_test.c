#include "app_services_internal.h"

#include <assert.h>
#include <stdio.h>

static MultiplexAppServicesFocusView home_focus(uint64_t now_ms,
                                                bool active_input) {
  return (MultiplexAppServicesFocusView){
      .screen = MULTIPLEX_APP_SERVICES_SCREEN_HOME,
      .now_ms = now_ms,
      .active_input = active_input,
  };
}

const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services) {
  return services != NULL &&
                 services->auth.kind == MULTIPLEX_APP_SERVICES_AUTH_LINKED
             ? &services->auth.state.linked.credentials
             : NULL;
}

int main(void) {
  MultiplexAppServices services = {0};
  services.content.catalog.available = true;
  services.content.startup_data_not_before_ms = 2000u;

  MultiplexAppServicesFocusView focus = home_focus(1900u, true);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data_not_before_ms == 3900u);
  assert(services.content.startup_data.kind ==
         MULTIPLEX_APP_SERVICES_LOAD_IDLE);

  focus = home_focus(3000u, true);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data_not_before_ms == 5000u);

  focus = home_focus(5000u, true);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data_not_before_ms == 7000u);
  assert(services.content.startup_data.kind ==
         MULTIPLEX_APP_SERVICES_LOAD_IDLE);

  focus = home_focus(7000u, false);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data.kind ==
         MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING);

  focus = home_focus(7001u, true);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data.kind ==
         MULTIPLEX_APP_SERVICES_LOAD_IDLE);
  assert(services.content.startup_data_not_before_ms == 9001u);

  services.content.startup_data.kind = MULTIPLEX_APP_SERVICES_LOAD_LOADING;
  focus = home_focus(8000u, true);
  assert(multiplex_app_services_catalog_focus(&services, &focus));
  assert(services.content.startup_data_not_before_ms == 9001u);

  services.auth.kind = MULTIPLEX_APP_SERVICES_AUTH_LINKED;
  services.auth.network_allowed = false;
  services.content.catalog.load.kind =
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  services.content.catalog.cache_save.kind = MULTIPLEX_APP_SERVICES_LOAD_IDLE;
  services.content.startup_data.kind =
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  assert(!multiplex_app_services_catalog_has_queued(&services));

  services.content.catalog.cache_save.kind =
      MULTIPLEX_APP_SERVICES_LOAD_REFRESH_PENDING;
  assert(multiplex_app_services_catalog_has_queued(&services));

  services.content.catalog.cache_save.kind = MULTIPLEX_APP_SERVICES_LOAD_IDLE;
  services.auth.network_allowed = true;
  assert(multiplex_app_services_catalog_has_queued(&services));

  puts("GameCube AppServices catalog focus tests passed.");
  return 0;
}
