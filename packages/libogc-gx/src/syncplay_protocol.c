#include "syncplay_protocol.h"

#include <stdio.h>
#include <string.h>
#include <strings.h>

static bool header_value(const char *headers, const char *name,
                         const char *expected) {
  const size_t name_size = strlen(name);
  const size_t expected_size = strlen(expected);
  const char *line = strstr(headers, "\r\n");
  while (line != NULL && line[2] != '\r' && line[2] != '\0') {
    line += 2;
    const char *line_end = strstr(line, "\r\n");
    if (line_end == NULL) {
      return false;
    }
    if ((size_t)(line_end - line) > name_size &&
        strncasecmp(line, name, name_size) == 0 && line[name_size] == ':') {
      const char *value = line + name_size + 1u;
      while (value < line_end && (*value == ' ' || *value == '\t')) {
        ++value;
      }
      return (size_t)(line_end - value) == expected_size &&
             strncmp(value, expected, expected_size) == 0;
    }
    line = line_end;
  }
  return false;
}

static bool header_token(const char *headers, const char *name,
                         const char *expected) {
  const size_t name_size = strlen(name);
  const size_t expected_size = strlen(expected);
  const char *line = strstr(headers, "\r\n");
  while (line != NULL && line[2] != '\r' && line[2] != '\0') {
    line += 2;
    const char *line_end = strstr(line, "\r\n");
    if (line_end == NULL) {
      return false;
    }
    if ((size_t)(line_end - line) > name_size &&
        strncasecmp(line, name, name_size) == 0 && line[name_size] == ':') {
      const char *token = line + name_size + 1u;
      while (token < line_end) {
        while (token < line_end &&
               (*token == ' ' || *token == '\t' || *token == ',')) {
          ++token;
        }
        const char *token_end = token;
        while (token_end < line_end && *token_end != ',') {
          ++token_end;
        }
        const char *trimmed_end = token_end;
        while (trimmed_end > token &&
               (trimmed_end[-1] == ' ' || trimmed_end[-1] == '\t')) {
          --trimmed_end;
        }
        if ((size_t)(trimmed_end - token) == expected_size &&
            strncasecmp(token, expected, expected_size) == 0) {
          return true;
        }
        token = token_end;
      }
      return false;
    }
    line = line_end;
  }
  return false;
}

bool multiplex_syncplay_validate_upgrade(const char *response,
                                         const char *expected_accept) {
  return response != NULL && expected_accept != NULL &&
         strncmp(response, "HTTP/1.1 101 ", 13u) == 0 &&
         strstr(response, "\r\n\r\n") != NULL &&
         header_token(response, "Upgrade", "websocket") &&
         header_token(response, "Connection", "Upgrade") &&
         header_value(response, "Sec-WebSocket-Accept", expected_accept);
}

bool multiplex_syncplay_decode_frame_header(
    const uint8_t *bytes, size_t size, MultiplexSyncplayFrameHeader *output) {
  if (bytes == NULL || output == NULL || size < 2u ||
      (bytes[0] & 0xf0u) != 0x80u || (bytes[1] & 0x80u) != 0) {
    return false;
  }
  size_t payload_size = bytes[1] & 0x7fu;
  size_t header_size = 2u;
  if (payload_size == 126u) {
    if (size < 4u) {
      return false;
    }
    payload_size = ((size_t)bytes[2] << 8u) | bytes[3];
    if (payload_size < 126u) {
      return false;
    }
    header_size = 4u;
  } else if (payload_size == 127u) {
    return false;
  }
  output->opcode = bytes[0] & 0x0fu;
  output->header_size = header_size;
  output->payload_size = payload_size;
  output->final = (bytes[0] & 0x80u) != 0;
  output->masked = (bytes[1] & 0x80u) != 0;
  return true;
}

static bool has_device_identifier(const char *response,
                                  const char *device_identifier) {
  static const char plain_prefix[] = "\"deviceIdentifier\":\"";
  static const char escaped_prefix[] = "\\\"deviceIdentifier\\\":\\\"";
  char plain[128];
  char escaped[128];
  const int plain_size =
      snprintf(plain, sizeof(plain), "%s%s\"", plain_prefix, device_identifier);
  const int escaped_size = snprintf(escaped, sizeof(escaped), "%s%s\\\"",
                                    escaped_prefix, device_identifier);
  return plain_size > 0 && (size_t)plain_size < sizeof(plain) &&
         escaped_size > 0 && (size_t)escaped_size < sizeof(escaped) &&
         (strstr(response, plain) != NULL || strstr(response, escaped) != NULL);
}

bool multiplex_syncplay_validate_hello(const char *response,
                                       const char *device_identifier) {
  return response != NULL && device_identifier != NULL &&
         strstr(response, "\"Error\"") == NULL &&
         (strstr(response, "\"Hello\"") != NULL ||
          strstr(response, "\"List\"") != NULL ||
          (strstr(response, "\"Set\"") != NULL &&
           has_device_identifier(response, device_identifier)));
}
