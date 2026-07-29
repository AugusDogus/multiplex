#include "syncplay_probe.h"

#include "http_client.h"
#include "tls_client.h"

#include <gccore.h>
#include <network.h>
#include <ogc/lwp_watchdog.h>

#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#define SYNCPLAY_HTTP_CAPACITY 2048u
#define SYNCPLAY_FRAME_CAPACITY 2048u
#define SYNCPLAY_IO_TIMEOUT_SECONDS 8u

typedef struct {
  int socket;
  MultiplexTlsClient *tls;
} SyncplaySocket;

static uint16_t read_u16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static size_t skip_dns_name(const uint8_t *response, size_t size,
                            size_t offset) {
  while (offset < size) {
    const uint8_t length = response[offset++];
    if (length == 0) {
      return offset;
    }
    if ((length & 0xc0u) == 0xc0u) {
      return offset < size ? offset + 1u : 0u;
    }
    if ((length & 0xc0u) != 0 || length > 63u ||
        offset + length > size) {
      return 0;
    }
    offset += length;
  }
  return 0;
}

static bool resolve_ipv4(const char *host, struct in_addr *address) {
  if (inet_aton(host, address) != 0) {
    return true;
  }
  const char *gateway = http_client_network_gateway();
  if (gateway == NULL || gateway[0] == '\0') {
    return false;
  }
  struct sockaddr_in dns;
  memset(&dns, 0, sizeof(dns));
  dns.sin_family = AF_INET;
  dns.sin_len = sizeof(dns);
  dns.sin_port = htons(53u);
  if (inet_aton(gateway, &dns.sin_addr) == 0) {
    return false;
  }

  uint8_t query[512];
  memset(query, 0, sizeof(query));
  const uint16_t transaction =
      (uint16_t)((uint32_t)gettime() ^ (uint32_t)(uintptr_t)query);
  query[0] = (uint8_t)(transaction >> 8u);
  query[1] = (uint8_t)transaction;
  query[2] = 0x01u;
  query[5] = 0x01u;
  size_t used = 12u;
  const char *label = host;
  while (*label != '\0') {
    const char *dot = strchr(label, '.');
    const size_t length = dot == NULL ? strlen(label) : (size_t)(dot - label);
    if (length == 0 || length > 63u || used + length + 1u >= sizeof(query)) {
      return false;
    }
    query[used++] = (uint8_t)length;
    memcpy(query + used, label, length);
    used += length;
    if (dot == NULL) {
      break;
    }
    label = dot + 1u;
  }
  if (used + 5u > sizeof(query)) {
    return false;
  }
  query[used++] = 0;
  query[used++] = 0;
  query[used++] = 1;
  query[used++] = 0;
  query[used++] = 1;

  const int socket = net_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (socket < 0) {
    return false;
  }
  bool resolved = false;
  if (net_sendto(socket, query, used, 0, (struct sockaddr *)&dns,
                 sizeof(dns)) == (int)used) {
    fd_set readable;
    FD_ZERO(&readable);
    FD_SET(socket, &readable);
    struct timeval timeout = {.tv_sec = 5, .tv_usec = 0};
    if (net_select(socket + 1, &readable, NULL, NULL, &timeout) > 0) {
      struct sockaddr_in sender;
      socklen_t sender_size = sizeof(sender);
      const int received =
          net_recvfrom(socket, query, sizeof(query), 0,
                       (struct sockaddr *)&sender, &sender_size);
      if (received >= 12 && read_u16(query) == transaction &&
          (query[2] & 0x80u) != 0 && (query[3] & 0x0fu) == 0) {
        const size_t size = (size_t)received;
        const uint16_t questions = read_u16(query + 4u);
        const uint16_t answers = read_u16(query + 6u);
        size_t offset = 12u;
        for (uint16_t index = 0; index < questions && offset != 0; ++index) {
          offset = skip_dns_name(query, size, offset);
          offset = offset != 0 && offset + 4u <= size ? offset + 4u : 0u;
        }
        for (uint16_t index = 0;
             index < answers && offset != 0 && !resolved; ++index) {
          offset = skip_dns_name(query, size, offset);
          if (offset == 0 || offset + 10u > size) {
            break;
          }
          const uint16_t type = read_u16(query + offset);
          const uint16_t record_class = read_u16(query + offset + 2u);
          const uint16_t data_size = read_u16(query + offset + 8u);
          offset += 10u;
          if (offset + data_size > size) {
            break;
          }
          if (type == 1u && record_class == 1u &&
              data_size == sizeof(address->s_addr)) {
            memcpy(&address->s_addr, query + offset, sizeof(address->s_addr));
            resolved = true;
          }
          offset += data_size;
        }
      }
    }
  }
  net_close(socket);
  if (resolved) {
    char resolved_address[16];
    inet_ntoa_r(*address, resolved_address, sizeof(resolved_address));
    SYS_Report("REFERENCE GX: Syncplay DNS host=%s address=%s\n", host,
               resolved_address);
  }
  return resolved;
}

static void close_socket(SyncplaySocket *socket) {
  if (socket == NULL) {
    return;
  }
  multiplex_tls_client_destroy(socket->tls);
  socket->tls = NULL;
  if (socket->socket >= 0) {
    net_close(socket->socket);
    socket->socket = -1;
  }
}

static bool connect_socket(const char *host, uint16_t port,
                           SyncplaySocket *output) {
  if (host == NULL || host[0] == '\0' || port == 0 || output == NULL) {
    return false;
  }
  output->socket = -1;
  output->tls = NULL;
  struct in_addr resolved;
  if (!resolve_ipv4(host, &resolved)) {
    SYS_Report("REFERENCE GX: Syncplay DNS failed host=%s\n", host);
    return false;
  }

  output->socket = net_socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (output->socket < 0) {
    return false;
  }
  const int no_delay = 1;
  if (net_setsockopt(output->socket, IPPROTO_TCP, TCP_NODELAY, &no_delay,
                     sizeof(no_delay)) < 0) {
    close_socket(output);
    return false;
  }
  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_len = sizeof(address);
  address.sin_port = htons(port);
  address.sin_addr = resolved;
  if (net_connect(output->socket, (struct sockaddr *)&address,
                  sizeof(address)) < 0) {
    close_socket(output);
    return false;
  }
  output->tls = multiplex_tls_client_connect(output->socket, host);
  if (output->tls == NULL) {
    close_socket(output);
    return false;
  }
  return true;
}

static bool tls_read_exact(MultiplexTlsClient *tls, uint8_t *destination,
                           size_t size) {
  size_t used = 0;
  while (used < size) {
    const int received = multiplex_tls_client_read(
        tls, destination + used, size - used, SYNCPLAY_IO_TIMEOUT_SECONDS);
    if (received <= 0) {
      return false;
    }
    used += (size_t)received;
  }
  return true;
}

static bool make_websocket_key(char *key, size_t capacity) {
  uint8_t random[16];
  uint64_t state = (uint64_t)gettime() ^ (uint64_t)(uintptr_t)key;
  for (size_t index = 0; index < sizeof(random); ++index) {
    state ^= state << 13u;
    state ^= state >> 7u;
    state ^= state << 17u;
    random[index] = (uint8_t)(state >> ((index & 7u) * 8u));
  }
  size_t encoded = 0;
  if (mbedtls_base64_encode((unsigned char *)key, capacity - 1u, &encoded,
                            random, sizeof(random)) != 0 ||
      encoded >= capacity) {
    return false;
  }
  key[encoded] = '\0';
  return true;
}

static bool expected_websocket_accept(const char *key, char *accept,
                                      size_t capacity) {
  static const char guid[] = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  char source[64];
  const int source_size = snprintf(source, sizeof(source), "%s%s", key, guid);
  if (source_size <= 0 || (size_t)source_size >= sizeof(source)) {
    return false;
  }
  uint8_t digest[20];
  if (mbedtls_sha1((const unsigned char *)source, (size_t)source_size,
                   digest) != 0) {
    return false;
  }
  size_t encoded = 0;
  if (mbedtls_base64_encode((unsigned char *)accept, capacity - 1u, &encoded,
                            digest, sizeof(digest)) != 0 ||
      encoded >= capacity) {
    return false;
  }
  accept[encoded] = '\0';
  return true;
}

static bool header_has_accept(const char *headers, const char *expected) {
  static const char prefix[] = "Sec-WebSocket-Accept:";
  const char *line = strstr(headers, prefix);
  if (line == NULL) {
    return false;
  }
  line += sizeof(prefix) - 1u;
  while (*line == ' ' || *line == '\t') {
    ++line;
  }
  const size_t expected_size = strlen(expected);
  return strncmp(line, expected, expected_size) == 0 &&
         (line[expected_size] == '\r' || line[expected_size] == '\n');
}

static bool header_has_value(const char *headers, const char *name,
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
        strncasecmp(line, name, name_size) == 0 &&
        line[name_size] == ':') {
      const char *value = line + name_size + 1u;
      while (value < line_end && (*value == ' ' || *value == '\t')) {
        ++value;
      }
      return (size_t)(line_end - value) == expected_size &&
             strncasecmp(value, expected, expected_size) == 0;
    }
    line = line_end;
  }
  return false;
}

static bool upgrade_websocket(SyncplaySocket *socket, const char *host,
                              uint16_t port) {
  char key[32];
  char expected_accept[32];
  if (!make_websocket_key(key, sizeof(key)) ||
      !expected_websocket_accept(key, expected_accept,
                                 sizeof(expected_accept))) {
    return false;
  }
  char request[512];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET /ws HTTP/1.1\r\nHost: %s:%u\r\nUpgrade: websocket\r\n"
      "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
      "Sec-WebSocket-Version: 13\r\nUser-Agent: Multiplex-GameCube/0\r\n\r\n",
      host, port, key);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request) ||
      !multiplex_tls_client_write_all(
          socket->tls, (const uint8_t *)request, (size_t)request_size)) {
    return false;
  }

  char response[SYNCPLAY_HTTP_CAPACITY];
  size_t used = 0;
  while (used + 1u < sizeof(response)) {
    const int received = multiplex_tls_client_read(
        socket->tls, (uint8_t *)response + used, sizeof(response) - used - 1u,
        SYNCPLAY_IO_TIMEOUT_SECONDS);
    if (received <= 0) {
      return false;
    }
    used += (size_t)received;
    response[used] = '\0';
    if (strstr(response, "\r\n\r\n") != NULL) {
      break;
    }
  }
  return strncmp(response, "HTTP/1.1 101 ", 13u) == 0 &&
         header_has_value(response, "Upgrade", "websocket") &&
         header_has_accept(response, expected_accept);
}

static bool send_frame(SyncplaySocket *socket, uint8_t opcode,
                       const uint8_t *payload, size_t payload_size) {
  if ((payload_size != 0 && payload == NULL) || payload_size > UINT16_MAX) {
    return false;
  }
  const size_t header_size = payload_size <= 125u ? 6u : 8u;
  uint8_t *frame = malloc(header_size + payload_size);
  if (frame == NULL) {
    return false;
  }
  frame[0] = 0x80u | opcode;
  size_t mask_offset = 2u;
  if (payload_size <= 125u) {
    frame[1] = 0x80u | (uint8_t)payload_size;
  } else {
    frame[1] = 0x80u | 126u;
    frame[2] = (uint8_t)(payload_size >> 8u);
    frame[3] = (uint8_t)payload_size;
    mask_offset = 4u;
  }
  const uint32_t mask = (uint32_t)gettime() ^ (uint32_t)(uintptr_t)frame;
  for (size_t index = 0; index < 4u; ++index) {
    frame[mask_offset + index] = (uint8_t)(mask >> (index * 8u));
  }
  for (size_t index = 0; index < payload_size; ++index) {
    frame[header_size + index] =
        payload[index] ^ frame[mask_offset + (index & 3u)];
  }
  const bool sent = multiplex_tls_client_write_all(
      socket->tls, frame, header_size + payload_size);
  free(frame);
  return sent;
}

static bool send_text_frame(SyncplaySocket *socket, const char *text) {
  const size_t payload_size = strlen(text);
  return payload_size != 0 &&
         send_frame(socket, 0x1u, (const uint8_t *)text, payload_size);
}

static bool receive_text_frame(SyncplaySocket *socket, char *text,
                               size_t capacity) {
  for (unsigned frame_index = 0; frame_index < 4u; ++frame_index) {
    uint8_t header[4];
    if (!tls_read_exact(socket->tls, header, 2u)) {
      return false;
    }
    const uint8_t opcode = header[0] & 0x0fu;
    if ((header[0] & 0x80u) == 0 || (header[1] & 0x80u) != 0) {
      return false;
    }
    size_t payload_size = header[1] & 0x7fu;
    if (payload_size == 126u) {
      if (!tls_read_exact(socket->tls, header + 2u, 2u)) {
        return false;
      }
      payload_size = ((size_t)header[2] << 8u) | header[3];
    } else if (payload_size == 127u) {
      return false;
    }
    if (opcode == 0x8u) {
      return false;
    }
    if (opcode == 0x9u || opcode == 0xau) {
      uint8_t control_payload[125];
      if (payload_size > sizeof(control_payload) ||
          (payload_size != 0 &&
           !tls_read_exact(socket->tls, control_payload, payload_size))) {
        return false;
      }
      if (opcode == 0x9u &&
          !send_frame(socket, 0xau, control_payload, payload_size)) {
        return false;
      }
      continue;
    }
    if (opcode != 0x1u || payload_size == 0 || payload_size >= capacity ||
        !tls_read_exact(socket->tls, (uint8_t *)text, payload_size)) {
      return false;
    }
    text[payload_size] = '\0';
    return true;
  }
  return false;
}

static bool safe_identifier(const char *value) {
  if (value == NULL || value[0] == '\0') {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor != '\0'; ++cursor) {
    if (!((*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= 'a' && *cursor <= 'z') ||
          (*cursor >= '0' && *cursor <= '9') || *cursor == '-' ||
          *cursor == '_')) {
      return false;
    }
  }
  return true;
}

bool multiplex_syncplay_probe_room(const MultiplexTrpcRoom *room,
                                   const char *device_identifier) {
  if (room == NULL || !safe_identifier(room->id) ||
      !safe_identifier(device_identifier)) {
    return false;
  }
  SyncplaySocket socket = {.socket = -1, .tls = NULL};
  if (!connect_socket(room->syncplay_host, room->syncplay_port, &socket)) {
    SYS_Report("REFERENCE GX: Syncplay connection failed host=%s port=%u\n",
               room->syncplay_host, room->syncplay_port);
    return false;
  }
  SYS_Report("REFERENCE GX: Syncplay TLS connected host=%s port=%u\n",
             room->syncplay_host, room->syncplay_port);
  if (!upgrade_websocket(&socket, room->syncplay_host, room->syncplay_port)) {
    SYS_Report("REFERENCE GX: Syncplay WebSocket upgrade failed\n");
    close_socket(&socket);
    return false;
  }

  char hello[512];
  const int hello_size = snprintf(
      hello, sizeof(hello),
      "{\"Hello\":{\"room\":{\"name\":\"%s\"},\"username\":"
      "\"{\\\"deviceIdentifier\\\":\\\"%s\\\","
      "\\\"deviceName\\\":\\\"Multiplex GameCube\\\","
      "\\\"userID\\\":\\\"0\\\"}\",\"version\":\"1.6.4\"}}",
      room->id, device_identifier);
  char response[SYNCPLAY_FRAME_CAPACITY] = {0};
  const bool received_protocol_frame =
      hello_size > 0 && (size_t)hello_size < sizeof(hello) &&
      send_text_frame(&socket, hello) &&
      receive_text_frame(&socket, response, sizeof(response));
  /*
   * Plex's Syncplay deployment does not reliably echo Hello. A Set.ready for
   * our encoded username is its normal first reply and is authoritative proof
   * that the server accepted the room and registered this client.
   */
  const bool joined =
      received_protocol_frame && strstr(response, "\"Error\"") == NULL &&
      (strstr(response, "\"Hello\"") != NULL ||
       strstr(response, "\"List\"") != NULL ||
       (strstr(response, "\"Set\"") != NULL &&
        strstr(response, device_identifier) != NULL));
  if (!joined) {
    SYS_Report("REFERENCE GX: Syncplay first response=%s\n", response);
  }
  SYS_Report("REFERENCE GX: Syncplay Hello acknowledged=%u\n",
             joined ? 1u : 0u);
  close_socket(&socket);
  return joined;
}
