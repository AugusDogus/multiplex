#include "gateway_catalog.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  unsigned step;
} FakeGateway;

static bool fake_request(void *context, const char *method, const char *url,
                         const char *bearer_token, const char *body,
                         char *response_body, size_t response_capacity,
                         unsigned *status) {
  FakeGateway *gateway = context;
  assert(strcmp(method, "GET") == 0);
  assert(strcmp(bearer_token, "session-1") == 0);
  assert(body == NULL);
  const char *response = NULL;
  if (gateway->step == 0) {
    assert(strcmp(url, "http://multiplex.example/api/console/plex/servers") ==
           0);
    response = "{\"status\":\"ready\",\"servers\":[{\"id\":\"server-1\","
               "\"name\":\"Living Room\",\"owned\":true}]}";
  } else {
    assert(strcmp(url, "http://multiplex.example/api/console/plex/home?"
                       "serverId=server-1") == 0);
    response = "{\"status\":\"ready\",\"server\":{\"id\":\"server-1\","
               "\"name\":\"Living Room\"},\"rows\":[{\"title\":\"Continue "
               "Watching\",\"items\":[{\"ratingKey\":42,\"title\":\"Movie\","
               "\"subtitle\":\"2026\",\"durationMs\":7200000,"
               "\"viewOffsetMs\":1800000,\"artworkPath\":null}]}]}";
  }
  ++gateway->step;
  *status = 200;
  const int written =
      snprintf(response_body, response_capacity, "%s", response);
  return written > 0 && (size_t)written < response_capacity;
}

int main(void) {
  FakeGateway gateway = {0};
  MultiplexXboxCatalog catalog;
  assert(multiplex_xbox_catalog_load("http://multiplex.example", "session-1",
                                     fake_request, &gateway, &catalog));
  assert(strcmp(catalog.server_name, "Living Room") == 0);
  assert(catalog.row_count == 1);
  assert(strcmp(catalog.rows[0].title, "Continue Watching") == 0);
  assert(catalog.rows[0].item_count == 1);
  assert(catalog.rows[0].items[0].rating_key == 42);
  assert(catalog.rows[0].items[0].view_offset_ms == 1800000);
  assert(gateway.step == 2);
  return 0;
}
