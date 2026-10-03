#ifndef MULTIPLEX_XBOX_GATEWAY_AUTH_H
#define MULTIPLEX_XBOX_GATEWAY_AUTH_H

#include "auth_record.h"
#include "http.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_XBOX_DEVICE_CODE_CAPACITY 64u
#define MULTIPLEX_XBOX_USER_CODE_CAPACITY 5u
#define MULTIPLEX_XBOX_LINK_URL_CAPACITY 256u

typedef enum {
  MULTIPLEX_XBOX_AUTH_WAITING = 1,
  MULTIPLEX_XBOX_AUTH_LINKED = 2,
  MULTIPLEX_XBOX_AUTH_UNAVAILABLE = 3,
} MultiplexXboxAuthStatus;

typedef struct {
  MultiplexXboxAuthStatus status;
  char device_code[MULTIPLEX_XBOX_DEVICE_CODE_CAPACITY];
  char user_code[MULTIPLEX_XBOX_USER_CODE_CAPACITY];
  char link_url[MULTIPLEX_XBOX_LINK_URL_CAPACITY];
  uint16_t interval_seconds;
} MultiplexXboxDeviceAuth;

bool multiplex_xbox_auth_begin(const char *base_url,
                               MultiplexXboxHttpRequest request,
                               void *request_context,
                               MultiplexXboxDeviceAuth *authorization);
bool multiplex_xbox_auth_poll(const char *base_url,
                              MultiplexXboxHttpRequest request,
                              void *request_context,
                              MultiplexXboxDeviceAuth *authorization,
                              MultiplexAuthCredentials *credentials);

#endif
