#ifndef MULTIPLEX_DEVICE_AUTH_H
#define MULTIPLEX_DEVICE_AUTH_H

#include "auth_record.h"

#include <stdbool.h>
#include <stdint.h>

#define MULTIPLEX_DEVICE_CODE_CAPACITY 64
#define MULTIPLEX_DEVICE_USER_CODE_CAPACITY 5
#define MULTIPLEX_DEVICE_LINK_URL_CAPACITY 256

typedef enum {
  MULTIPLEX_DEVICE_AUTH_WAITING = 1,
  MULTIPLEX_DEVICE_AUTH_LINKED = 2,
  MULTIPLEX_DEVICE_AUTH_UNAVAILABLE = 3,
} MultiplexDeviceAuthStatus;

typedef struct {
  MultiplexDeviceAuthStatus status;
  char device_code[MULTIPLEX_DEVICE_CODE_CAPACITY];
  char user_code[MULTIPLEX_DEVICE_USER_CODE_CAPACITY];
  char link_url[MULTIPLEX_DEVICE_LINK_URL_CAPACITY];
  uint16_t interval_seconds;
} MultiplexDeviceAuth;

bool multiplex_device_auth_begin(const char *base_url,
                                 MultiplexDeviceAuth *authorization);
bool multiplex_device_auth_poll(const char *base_url,
                                MultiplexDeviceAuth *authorization,
                                MultiplexAuthCredentials *credentials);

#endif
