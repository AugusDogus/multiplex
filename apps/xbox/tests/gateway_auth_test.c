#include "gateway_auth.h"

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
  const char *response = NULL;
  if (gateway->step == 0) {
    assert(strcmp(method, "POST") == 0);
    assert(strcmp(url, "http://multiplex.example:3000/api/auth/device/code") ==
           0);
    assert(strstr(body, "multiplex-xbox") != NULL);
    *status = 200;
    response = "{\"device_code\":\"device-1\",\"user_code\":\"ABCD\","
               "\"verification_uri\":\"https://multiplex.example/link\","
               "\"interval\":5}";
  } else if (gateway->step == 1) {
    assert(strcmp(method, "POST") == 0);
    assert(strstr(body, "device-1") != NULL);
    *status = 400;
    response = "{\"error\":\"authorization_pending\"}";
  } else if (gateway->step == 2) {
    assert(strcmp(method, "POST") == 0);
    *status = 200;
    response = "{\"access_token\":\"session-1\",\"expires_in\":3600}";
  } else {
    assert(strcmp(method, "GET") == 0);
    assert(strcmp(bearer_token, "session-1") == 0);
    *status = 200;
    response = "{\"plexAuthToken\":\"plex-1\"}";
  }
  gateway->step += 1;
  const int written =
      snprintf(response_body, response_capacity, "%s", response);
  return written > 0 && (size_t)written < response_capacity;
}

int main(void) {
  FakeGateway gateway = {0};
  MultiplexXboxDeviceAuth authorization;
  assert(multiplex_xbox_auth_begin("http://multiplex.example:3000",
                                   fake_request, &gateway, &authorization));
  assert(authorization.status == MULTIPLEX_XBOX_AUTH_WAITING);
  assert(strcmp(authorization.user_code, "ABCD") == 0);
  assert(authorization.interval_seconds == 5);

  MultiplexAuthCredentials credentials;
  assert(multiplex_xbox_auth_poll("http://multiplex.example:3000", fake_request,
                                  &gateway, &authorization, &credentials));
  assert(authorization.status == MULTIPLEX_XBOX_AUTH_WAITING);
  assert(multiplex_xbox_auth_poll("http://multiplex.example:3000", fake_request,
                                  &gateway, &authorization, &credentials));
  assert(authorization.status == MULTIPLEX_XBOX_AUTH_LINKED);
  assert(strcmp(credentials.session_token, "session-1") == 0);
  assert(strcmp(credentials.plex_token, "plex-1") == 0);
  assert(strncmp(credentials.plex_client_id, "multiplex-xbox-", 15) == 0);
  assert(gateway.step == 4);
  return 0;
}
