#include "device_auth.h"

#include "http_client.h"

#include <gccore.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#define AUTH_URL_CAPACITY 512
#define AUTH_RESPONSE_CAPACITY 2048
#define DEVICE_GRANT_TYPE "urn:ietf:params:oauth:grant-type:device_code"

static bool build_auth_url(const char *base_url, const char *path, char *url,
                           size_t capacity) {
  if (base_url == NULL || base_url[0] == '\0') {
    return false;
  }
  const size_t base_size = strlen(base_url);
  const int written =
      snprintf(url, capacity, "%s%s%s", base_url,
               base_url[base_size - 1u] == '/' ? "" : "/", path);
  return written > 0 && (size_t)written < capacity;
}

static const char *find_json_value(const char *json, const char *key) {
  char pattern[64];
  const int written = snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  if (written <= 0 || (size_t)written >= sizeof(pattern)) {
    return NULL;
  }
  const char *cursor = strstr(json, pattern);
  if (cursor == NULL) {
    return NULL;
  }
  cursor += (size_t)written;
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' ||
         *cursor == '\n') {
    ++cursor;
  }
  if (*cursor++ != ':') {
    return NULL;
  }
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' ||
         *cursor == '\n') {
    ++cursor;
  }
  return cursor;
}

static bool json_string(const char *json, const char *key, char *destination,
                        size_t capacity) {
  const char *cursor = find_json_value(json, key);
  if (cursor == NULL || *cursor++ != '"' || capacity == 0) {
    return false;
  }
  size_t output = 0;
  while (*cursor != '\0' && *cursor != '"') {
    unsigned char value = (unsigned char)*cursor++;
    if (value == '\\') {
      value = (unsigned char)*cursor++;
      if (value == '"' || value == '\\' || value == '/') {
        /* JSON's single-character escapes map directly. */
      } else if (value == 'b') {
        value = '\b';
      } else if (value == 'f') {
        value = '\f';
      } else if (value == 'n') {
        value = '\n';
      } else if (value == 'r') {
        value = '\r';
      } else if (value == 't') {
        value = '\t';
      } else {
        return false;
      }
    }
    if (value < 0x20 || output + 1u >= capacity) {
      return false;
    }
    destination[output++] = (char)value;
  }
  if (*cursor != '"') {
    return false;
  }
  destination[output] = '\0';
  return true;
}

static bool json_unsigned(const char *json, const char *key,
                          uint32_t *destination) {
  const char *cursor = find_json_value(json, key);
  if (cursor == NULL || *cursor < '0' || *cursor > '9') {
    return false;
  }
  uint32_t value = 0;
  do {
    const uint32_t digit = (uint32_t)(*cursor++ - '0');
    if (value > (UINT32_MAX - digit) / 10u) {
      return false;
    }
    value = value * 10u + digit;
  } while (*cursor >= '0' && *cursor <= '9');
  *destination = value;
  return true;
}

static uint64_t identifier_hash(const char *value) {
  uint64_t hash = UINT64_C(1469598103934665603);
  while (*value != '\0') {
    hash ^= (uint8_t)*value++;
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static bool fetch_plex_token(const char *base_url,
                             MultiplexAuthCredentials *credentials) {
  char url[AUTH_URL_CAPACITY];
  if (!build_auth_url(base_url, "api/auth/get-session", url, sizeof(url))) {
    return false;
  }
  char response_body[AUTH_RESPONSE_CAPACITY];
  HttpJsonResponse response;
  return http_client_request_json("GET", url, credentials->session_token, NULL,
                                  response_body, sizeof(response_body),
                                  &response) &&
         response.status == 200 &&
         json_string(response_body, "plexAuthToken", credentials->plex_token,
                     sizeof(credentials->plex_token));
}

bool multiplex_device_auth_refresh_credentials(
    const char *base_url, MultiplexAuthCredentials *credentials) {
  if (credentials == NULL || credentials->session_token[0] == '\0') {
    return false;
  }
  if (credentials->plex_client_id[0] == '\0') {
    const uint64_t client_hash = identifier_hash(credentials->session_token);
    snprintf(credentials->plex_client_id, sizeof(credentials->plex_client_id),
             "multiplex-gamecube-%08x%08x", (unsigned)(client_hash >> 32u),
             (unsigned)client_hash);
  }
  return fetch_plex_token(base_url, credentials);
}

bool multiplex_device_auth_begin(const char *base_url,
                                 MultiplexDeviceAuth *authorization) {
  if (authorization == NULL) {
    return false;
  }
  char url[AUTH_URL_CAPACITY];
  if (!build_auth_url(base_url, "api/auth/device/code", url, sizeof(url))) {
    return false;
  }

  static const char request[] =
      "{\"client_id\":\"multiplex-gamecube\",\"scope\":\"console\"}";
  char response_body[AUTH_RESPONSE_CAPACITY];
  HttpJsonResponse response;
  if (!http_client_request_json("POST", url, NULL, request, response_body,
                                sizeof(response_body), &response) ||
      response.status != 200) {
    return false;
  }

  uint32_t interval = 0;
  memset(authorization, 0, sizeof(*authorization));
  if (!json_string(response_body, "device_code", authorization->device_code,
                   sizeof(authorization->device_code)) ||
      !json_string(response_body, "user_code", authorization->user_code,
                   sizeof(authorization->user_code)) ||
      !json_string(response_body, "verification_uri", authorization->link_url,
                   sizeof(authorization->link_url)) ||
      !json_unsigned(response_body, "interval", &interval) ||
      strlen(authorization->user_code) != 4 || interval == 0 ||
      interval > UINT16_MAX) {
    memset(authorization, 0, sizeof(*authorization));
    return false;
  }
  authorization->interval_seconds = (uint16_t)interval;
  authorization->status = MULTIPLEX_DEVICE_AUTH_WAITING;
  return true;
}

bool multiplex_device_auth_poll(const char *base_url,
                                MultiplexDeviceAuth *authorization,
                                MultiplexAuthCredentials *credentials) {
  if (authorization == NULL || credentials == NULL ||
      authorization->status != MULTIPLEX_DEVICE_AUTH_WAITING) {
    return false;
  }
  char url[AUTH_URL_CAPACITY];
  if (!build_auth_url(base_url, "api/auth/device/token", url, sizeof(url))) {
    return false;
  }
  char request[256];
  const int request_size = snprintf(
      request, sizeof(request),
      "{\"grant_type\":\"" DEVICE_GRANT_TYPE
      "\",\"device_code\":\"%s\",\"client_id\":\"multiplex-gamecube\"}",
      authorization->device_code);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request)) {
    return false;
  }

  char response_body[AUTH_RESPONSE_CAPACITY];
  HttpJsonResponse response;
  if (!http_client_request_json("POST", url, NULL, request, response_body,
                                sizeof(response_body), &response)) {
    return false;
  }
  if (response.status == 400) {
    char error[32];
    if (!json_string(response_body, "error", error, sizeof(error))) {
      return false;
    }
    if (strcmp(error, "authorization_pending") == 0) {
      return true;
    }
    if (strcmp(error, "slow_down") == 0) {
      if (authorization->interval_seconds <= UINT16_MAX - 5u) {
        authorization->interval_seconds += 5u;
      }
      return true;
    }
    authorization->status = MULTIPLEX_DEVICE_AUTH_UNAVAILABLE;
    return true;
  }
  if (response.status != 200) {
    return false;
  }

  uint32_t expires_in = 0;
  memset(credentials, 0, sizeof(*credentials));
  if (!json_string(response_body, "access_token", credentials->session_token,
                   sizeof(credentials->session_token)) ||
      !json_unsigned(response_body, "expires_in", &expires_in) ||
      strlen(base_url) >= sizeof(credentials->origin)) {
    memset(credentials, 0, sizeof(*credentials));
    return false;
  }
  strcpy(credentials->origin, base_url);
  const time_t now = time(NULL);
  credentials->session_expires_at_unix =
      now > 0 ? (uint64_t)now + expires_in : 0;
  if (!multiplex_device_auth_refresh_credentials(base_url, credentials)) {
    SYS_Report("REFERENCE GX: Plex credential bootstrap unavailable\n");
  }
  authorization->status = MULTIPLEX_DEVICE_AUTH_LINKED;
  return true;
}
