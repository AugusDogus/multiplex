#include "syncplay_probe.h"

#include "http_client.h"
#include "tls_client.h"

#include <gccore.h>
#include <network.h>
#include <ogc/lwp_watchdog.h>

#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#define SYNCPLAY_HTTP_CAPACITY 2048u
#define SYNCPLAY_FRAME_CAPACITY 2048u
#define SYNCPLAY_RECEIVE_CAPACITY 4096u
#define SYNCPLAY_IO_TIMEOUT_SECONDS 8u

typedef struct {
  int socket;
  MultiplexTlsClient *tls;
  uint8_t prefetched[SYNCPLAY_HTTP_CAPACITY];
  size_t prefetched_offset;
  size_t prefetched_size;
} SyncplaySocket;

struct MultiplexSyncplaySession {
  SyncplaySocket transport;
  uint8_t received[SYNCPLAY_RECEIVE_CAPACITY];
  size_t received_size;
  unsigned participant_count;
  unsigned heartbeat_count;
  uint32_t local_position_ms;
  uint32_t remote_position_ms;
  uint32_t room_position_ms;
  char encoded_user[256];
  char device_identifier[96];
  bool has_local_playback;
  bool local_paused;
  bool pending_local_play_pause;
  bool pending_local_seek;
  bool remote_paused;
  bool remote_seek;
  bool remote_playback_pending;
  bool room_position_known;
  bool room_paused;
  bool observer;
  bool connected;
};

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
    if ((length & 0xc0u) != 0 || length > 63u || offset + length > size) {
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
        for (uint16_t index = 0; index < answers && offset != 0 && !resolved;
             ++index) {
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
  socket->prefetched_offset = 0;
  socket->prefetched_size = 0;
}

static bool connect_socket(const char *host, uint16_t port,
                           SyncplaySocket *output) {
  if (host == NULL || host[0] == '\0' || port == 0 || output == NULL) {
    return false;
  }
  output->socket = -1;
  output->tls = NULL;
  output->prefetched_offset = 0;
  output->prefetched_size = 0;
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

static bool tls_read_exact(SyncplaySocket *socket, uint8_t *destination,
                           size_t size) {
  size_t used = 0;
  if (socket->prefetched_offset < socket->prefetched_size) {
    const size_t available =
        socket->prefetched_size - socket->prefetched_offset;
    const size_t copied = available < size ? available : size;
    memcpy(destination, socket->prefetched + socket->prefetched_offset, copied);
    socket->prefetched_offset += copied;
    used += copied;
  }
  while (used < size) {
    const int received =
        multiplex_tls_client_read(socket->tls, destination + used, size - used,
                                  SYNCPLAY_IO_TIMEOUT_SECONDS);
    if (received <= 0) {
      SYS_Report("REFERENCE GX: Syncplay frame read failed used=%u wanted=%u "
                 "result=%d\n",
                 (unsigned)used, (unsigned)size, received);
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
        strncasecmp(line, name, name_size) == 0 && line[name_size] == ':') {
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
      !multiplex_tls_client_write_all(socket->tls, (const uint8_t *)request,
                                      (size_t)request_size)) {
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
  char *header_end = strstr(response, "\r\n\r\n");
  const bool upgraded = header_end != NULL &&
                        strncmp(response, "HTTP/1.1 101 ", 13u) == 0 &&
                        header_has_value(response, "Upgrade", "websocket") &&
                        header_has_accept(response, expected_accept);
  if (!upgraded) {
    return false;
  }
  const size_t header_size = (size_t)(header_end - response) + 4u;
  const size_t extra_size = used - header_size;
  if (extra_size > sizeof(socket->prefetched)) {
    return false;
  }
  if (extra_size != 0) {
    memcpy(socket->prefetched, response + header_size, extra_size);
  }
  socket->prefetched_offset = 0;
  socket->prefetched_size = extra_size;
  return true;
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
  const bool sent = multiplex_tls_client_write_all(socket->tls, frame,
                                                   header_size + payload_size);
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
    if (!tls_read_exact(socket, header, 2u)) {
      return false;
    }
    const uint8_t opcode = header[0] & 0x0fu;
    if ((header[0] & 0x80u) == 0 || (header[1] & 0x80u) != 0) {
      SYS_Report("REFERENCE GX: Syncplay frame header rejected first=%02x "
                 "second=%02x\n",
                 header[0], header[1]);
      return false;
    }
    size_t payload_size = header[1] & 0x7fu;
    if (payload_size == 126u) {
      if (!tls_read_exact(socket, header + 2u, 2u)) {
        return false;
      }
      payload_size = ((size_t)header[2] << 8u) | header[3];
    } else if (payload_size == 127u) {
      return false;
    }
    if (opcode == 0x8u) {
      SYS_Report("REFERENCE GX: Syncplay close frame payload=%u\n",
                 (unsigned)payload_size);
      return false;
    }
    if (opcode == 0x9u || opcode == 0xau) {
      uint8_t control_payload[125];
      if (payload_size > sizeof(control_payload) ||
          (payload_size != 0 &&
           !tls_read_exact(socket, control_payload, payload_size))) {
        return false;
      }
      if (opcode == 0x9u &&
          !send_frame(socket, 0xau, control_payload, payload_size)) {
        return false;
      }
      continue;
    }
    if (opcode != 0x1u || payload_size == 0 || payload_size >= capacity ||
        !tls_read_exact(socket, (uint8_t *)text, payload_size)) {
      SYS_Report("REFERENCE GX: Syncplay data frame rejected opcode=%u "
                 "payload=%u capacity=%u\n",
                 opcode, (unsigned)payload_size, (unsigned)capacity);
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

static bool safe_json_string(const char *value) {
  if (value == NULL || value[0] == '\0') {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor != '\0'; ++cursor) {
    if (*cursor < 0x20u || *cursor == '"' || *cursor == '\\') {
      return false;
    }
  }
  return true;
}

static bool announce_session(MultiplexSyncplaySession *session,
                             const MultiplexTrpcRoom *room) {
  char file[512];
  const int file_size = snprintf(
      file, sizeof(file),
      "{\"Set\":{\"file\":{\"name\":\"{\\\"ads\\\":{\\\"playing\\\":false},"
      "\\\"uri\\\":\\\"%s\\\"}\"}}}",
      room->source_uri);
  return safe_json_string(room->source_uri) &&
         send_text_frame(&session->transport, "{\"List\":{}}") &&
         file_size > 0 && (size_t)file_size < sizeof(file) &&
         send_text_frame(&session->transport, file) &&
         send_text_frame(
             &session->transport,
             session->observer
                 ? "{\"Set\":{\"ready\":{\"isReady\":false}}}"
                 : "{\"Set\":{\"ready\":{\"isReady\":true}}}");
}

static bool read_json_number(const char *json, const char *key,
                             double *output) {
  const char *cursor = strstr(json, key);
  if (cursor == NULL) {
    return false;
  }
  cursor += strlen(key);
  char *end = NULL;
  const double value = strtod(cursor, &end);
  if (end == cursor) {
    return false;
  }
  *output = value;
  return true;
}

static bool read_json_bool(const char *json, const char *key, bool *output) {
  const char *cursor = strstr(json, key);
  if (cursor == NULL) {
    return false;
  }
  cursor += strlen(key);
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r' ||
         *cursor == '\n') {
    ++cursor;
  }
  if (strncmp(cursor, "true", 4u) == 0) {
    *output = true;
    return true;
  }
  if (strncmp(cursor, "false", 5u) == 0) {
    *output = false;
    return true;
  }
  return false;
}

static unsigned count_participants(const char *json) {
  uint32_t user_ids[32];
  unsigned count = 0;
  const char *cursor = json;
  while ((cursor = strstr(cursor, "userID")) != NULL) {
    cursor += sizeof("userID") - 1u;
    const char *digits = cursor;
    for (unsigned scanned = 0; scanned < 32u && *digits != '\0'; ++scanned) {
      if (*digits >= '0' && *digits <= '9') {
        break;
      }
      ++digits;
    }
    if (*digits < '0' || *digits > '9') {
      continue;
    }
    char *end = NULL;
    const unsigned long parsed = strtoul(digits, &end, 10);
    if (end == digits || parsed > UINT32_MAX) {
      continue;
    }
    bool duplicate = false;
    for (unsigned index = 0; index < count; ++index) {
      if (user_ids[index] == (uint32_t)parsed) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate && count < sizeof(user_ids) / sizeof(user_ids[0])) {
      user_ids[count++] = (uint32_t)parsed;
    }
    cursor = end;
  }
  return count;
}

static bool echo_state(MultiplexSyncplaySession *session, const char *json) {
  double position = 0;
  double client_rtt = 0;
  double server_rtt = 0;
  double latency = 0;
  double ignoring_server = 0;
  bool paused = true;
  bool do_seek = false;
  if (!read_json_number(json, "\"position\":", &position) ||
      !read_json_bool(json, "\"paused\":", &paused)) {
    return false;
  }
  read_json_bool(json, "\"doSeek\":", &do_seek);
  read_json_number(json, "\"clientRtt\":", &client_rtt);
  read_json_number(json, "\"serverRtt\":", &server_rtt);
  read_json_number(json, "\"latencyCalculation\":", &latency);
  read_json_number(json, "\"server\":", &ignoring_server);

  char response[768];
  char set_by[sizeof(session->encoded_user) + 3u];
  const char *set_by_field = strstr(json, "\"setBy\":");
  const bool set_by_self =
      set_by_field != NULL &&
      strstr(set_by_field, session->device_identifier) != NULL;
  const bool should_echo = ignoring_server > 0;
  const bool local_change =
      session->pending_local_play_pause || session->pending_local_seek;
  const bool apply_remote = !set_by_self && !local_change;
  const uint32_t remote_position_ms =
      position <= 0 ? 0
      : position >= (double)UINT32_MAX / 1000.0
          ? UINT32_MAX
          : (uint32_t)(position * 1000.0);
  session->room_position_ms = remote_position_ms;
  session->room_position_known = true;
  session->room_paused = paused;
  if (!session->observer && apply_remote &&
      (session->local_paused != paused || do_seek)) {
    session->remote_paused = paused;
    session->remote_position_ms = remote_position_ms;
    session->remote_seek = do_seek;
    session->remote_playback_pending = true;
  }
  const bool claim_local = !session->observer &&
                           session->has_local_playback && !should_echo &&
                           local_change;
  const bool reply_paused = claim_local ? session->local_paused : paused;
  const double reply_position =
      claim_local ? (double)session->local_position_ms / 1000.0 : position;
  if (claim_local) {
    snprintf(set_by, sizeof(set_by), "\"%s\"", session->encoded_user);
  } else {
    strcpy(set_by, "null");
  }
  const double now_seconds = (double)ticks_to_millisecs(gettime()) / 1000.0;
  const int response_size =
      snprintf(response, sizeof(response),
               "{\"State\":{\"ping\":{\"clientLatencyCalculation\":%.3f,"
               "\"clientRtt\":%.6f,\"serverRtt\":%.6f,"
               "\"latencyCalculation\":%.6f},\"playstate\":{\"doSeek\":%s,"
               "\"paused\":%s,\"position\":%.6f,\"setBy\":%s},"
               "\"ignoringOnTheFly\":{\"client\":%u,\"server\":%.0f}}}",
               now_seconds, client_rtt, server_rtt, latency,
               claim_local && session->pending_local_seek ? "true" : "false",
               reply_paused ? "true" : "false", reply_position, set_by,
               claim_local ? 1u : 0u, ignoring_server);
  const bool sent = response_size > 0 &&
                    (size_t)response_size < sizeof(response) &&
                    send_text_frame(&session->transport, response);
  if (sent) {
    if (claim_local) {
      session->pending_local_play_pause = false;
      session->pending_local_seek = false;
    }
    session->heartbeat_count += 1u;
    if (session->heartbeat_count % 10u == 0) {
      SYS_Report("REFERENCE GX: Syncplay heartbeat=%u paused=%u "
                 "position=%ums participants=%u claim=%u\n",
                 session->heartbeat_count, paused ? 1u : 0u,
                 remote_position_ms,
                 session->participant_count, claim_local ? 1u : 0u);
    }
  }
  return sent;
}

static bool handle_text_frame(MultiplexSyncplaySession *session,
                              const char *text) {
  if (strstr(text, "\"Error\"") != NULL) {
    SYS_Report("REFERENCE GX: Syncplay protocol error\n");
    return false;
  }
  if (strstr(text, "\"List\"") != NULL) {
    const unsigned participants = count_participants(text);
    if (participants != 0 && participants != session->participant_count) {
      session->participant_count = participants;
      SYS_Report("REFERENCE GX: Syncplay participants=%u\n", participants);
    }
  }
  bool joined = false;
  bool left = false;
  read_json_bool(text, "\"joined\":", &joined);
  read_json_bool(text, "\"left\":", &left);
  if (joined || left) {
    if (!send_text_frame(&session->transport, "{\"List\":{}}")) {
      return false;
    }
    SYS_Report("REFERENCE GX: Syncplay roster refresh joined=%u left=%u\n",
               joined ? 1u : 0u, left ? 1u : 0u);
  }
  if (strstr(text, "\"State\"") != NULL && !echo_state(session, text)) {
    SYS_Report("REFERENCE GX: Syncplay State reply failed\n");
    return false;
  }
  return true;
}

static bool poll_frames(MultiplexSyncplaySession *session) {
  SyncplaySocket *socket = &session->transport;
  if (socket->prefetched_offset < socket->prefetched_size) {
    const size_t available =
        socket->prefetched_size - socket->prefetched_offset;
    if (available > sizeof(session->received) - session->received_size) {
      return false;
    }
    memcpy(session->received + session->received_size,
           socket->prefetched + socket->prefetched_offset, available);
    session->received_size += available;
    socket->prefetched_offset = socket->prefetched_size;
  }

  if (session->received_size < sizeof(session->received)) {
    const int received = multiplex_tls_client_read(
        socket->tls, session->received + session->received_size,
        sizeof(session->received) - session->received_size, 0);
    if (received == 0) {
      return false;
    }
    if (received > 0) {
      session->received_size += (size_t)received;
    } else if (received != -EAGAIN) {
      return false;
    }
  }

  size_t consumed = 0;
  while (session->received_size - consumed >= 2u) {
    const uint8_t *frame = session->received + consumed;
    const uint8_t opcode = frame[0] & 0x0fu;
    if ((frame[0] & 0x80u) == 0 || (frame[1] & 0x80u) != 0) {
      return false;
    }
    size_t header_size = 2u;
    size_t payload_size = frame[1] & 0x7fu;
    if (payload_size == 126u) {
      if (session->received_size - consumed < 4u) {
        break;
      }
      payload_size = ((size_t)frame[2] << 8u) | frame[3];
      header_size = 4u;
    } else if (payload_size == 127u) {
      return false;
    }
    if (header_size + payload_size > session->received_size - consumed) {
      break;
    }
    const uint8_t *payload = frame + header_size;
    if (opcode == 0x8u) {
      return false;
    }
    if (opcode == 0x9u && !send_frame(socket, 0xau, payload, payload_size)) {
      return false;
    }
    if (opcode == 0x1u) {
      if (payload_size == 0 || payload_size >= SYNCPLAY_FRAME_CAPACITY) {
        return false;
      }
      char text[SYNCPLAY_FRAME_CAPACITY];
      memcpy(text, payload, payload_size);
      text[payload_size] = '\0';
      if (!handle_text_frame(session, text)) {
        return false;
      }
    } else if (opcode != 0x9u && opcode != 0xau) {
      return false;
    }
    consumed += header_size + payload_size;
  }
  if (consumed != 0) {
    memmove(session->received, session->received + consumed,
            session->received_size - consumed);
    session->received_size -= consumed;
  }
  return session->received_size < sizeof(session->received);
}

MultiplexSyncplaySession *
multiplex_syncplay_session_connect(const MultiplexTrpcRoom *room,
                                   const char *device_identifier,
                                   uint32_t user_id, bool observer) {
  if (room == NULL || !safe_identifier(room->id) ||
      !safe_identifier(device_identifier) ||
      user_id == 0 ||
      strlen(device_identifier) >=
          sizeof(((MultiplexSyncplaySession *)0)->device_identifier)) {
    return NULL;
  }
  SyncplaySocket socket = {.socket = -1};
  bool connected = false;
  for (unsigned attempt = 0; attempt < 2u && !connected; ++attempt) {
    connected =
        connect_socket(room->syncplay_host, room->syncplay_port, &socket);
    if (!connected && attempt == 0) {
      SYS_Report("REFERENCE GX: Syncplay transport retry\n");
    }
  }
  if (!connected) {
    SYS_Report("REFERENCE GX: Syncplay connection failed host=%s port=%u\n",
               room->syncplay_host, room->syncplay_port);
    return NULL;
  }
  SYS_Report("REFERENCE GX: Syncplay TLS connected host=%s port=%u\n",
             room->syncplay_host, room->syncplay_port);
  if (!upgrade_websocket(&socket, room->syncplay_host, room->syncplay_port)) {
    SYS_Report("REFERENCE GX: Syncplay WebSocket upgrade failed\n");
    close_socket(&socket);
    return NULL;
  }

  char hello[512];
  const int hello_size =
      snprintf(hello, sizeof(hello),
               "{\"Hello\":{\"room\":{\"name\":\"%s\"},\"username\":"
               "\"{\\\"deviceIdentifier\\\":\\\"%s\\\","
               "\\\"deviceName\\\":\\\"Multiplex GameCube\\\","
               "\\\"userID\\\":\\\"%u\\\"}\",\"version\":\"1.6.4\"}}",
               room->id, device_identifier, user_id);
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
  const bool joined = received_protocol_frame &&
                      strstr(response, "\"Error\"") == NULL &&
                      (strstr(response, "\"Hello\"") != NULL ||
                       strstr(response, "\"List\"") != NULL ||
                       (strstr(response, "\"Set\"") != NULL &&
                        strstr(response, device_identifier) != NULL));
  if (!joined) {
    SYS_Report("REFERENCE GX: Syncplay first response=%s\n", response);
  }
  SYS_Report("REFERENCE GX: Syncplay Hello acknowledged=%u\n",
             joined ? 1u : 0u);
  if (!joined) {
    close_socket(&socket);
    return NULL;
  }

  MultiplexSyncplaySession *session = calloc(1, sizeof(*session));
  if (session == NULL) {
    close_socket(&socket);
    return NULL;
  }
  session->transport = socket;
  session->connected = true;
  session->participant_count = 1u;
  session->observer = observer;
  strcpy(session->device_identifier, device_identifier);
  const int identity_size = snprintf(
      session->encoded_user, sizeof(session->encoded_user),
      "{\\\"deviceIdentifier\\\":\\\"%s\\\","
      "\\\"deviceName\\\":\\\"Multiplex GameCube\\\","
      "\\\"userID\\\":\\\"%u\\\"}",
      device_identifier, user_id);
  if (identity_size <= 0 ||
      (size_t)identity_size >= sizeof(session->encoded_user) ||
      !announce_session(session, room)) {
    multiplex_syncplay_session_destroy(session);
    return NULL;
  }
  SYS_Report("REFERENCE GX: Syncplay session retained\n");
  return session;
}

bool multiplex_syncplay_session_poll(MultiplexSyncplaySession *session) {
  if (session == NULL || !session->connected) {
    return false;
  }
  session->connected = poll_frames(session);
  return session->connected;
}

void multiplex_syncplay_session_set_playback(
    MultiplexSyncplaySession *session, bool paused, uint32_t position_ms) {
  if (session == NULL) {
    return;
  }
  bool claim_local = false;
  if (session->has_local_playback && session->local_paused != paused) {
    session->pending_local_play_pause = true;
    claim_local = true;
  } else if (!session->has_local_playback && !paused) {
    /*
     * Joining a room auto-starts the player while the room is still on its
     * paused lobby baseline. Claim that initial play just like the web client.
     */
    session->pending_local_play_pause = true;
    claim_local = true;
  }
  if (claim_local) {
    /*
     * The server can send its paused lobby baseline during the synchronous
     * handshake, before the caller attaches local playback. Do not apply that
     * stale event after a newer local play/pause claim has been armed.
     */
    session->remote_playback_pending = false;
  }
  session->has_local_playback = true;
  session->local_paused = paused;
  session->local_position_ms = position_ms;
}

void multiplex_syncplay_session_adopt_playback(
    MultiplexSyncplaySession *session, bool paused, uint32_t position_ms) {
  if (session == NULL) {
    return;
  }
  session->has_local_playback = true;
  session->local_paused = paused;
  session->local_position_ms = position_ms;
  session->pending_local_play_pause = false;
  session->pending_local_seek = false;
}

void multiplex_syncplay_session_mark_local_seek(
    MultiplexSyncplaySession *session) {
  if (session != NULL) {
    session->pending_local_seek = true;
  }
}

bool multiplex_syncplay_session_take_remote_playback(
    MultiplexSyncplaySession *session, bool *paused, uint32_t *position_ms,
    bool *seek) {
  if (session == NULL || paused == NULL || position_ms == NULL || seek == NULL ||
      !session->remote_playback_pending) {
    return false;
  }
  *paused = session->remote_paused;
  *position_ms = session->remote_position_ms;
  *seek = session->remote_seek;
  session->remote_playback_pending = false;
  return true;
}

unsigned multiplex_syncplay_session_participant_count(
    const MultiplexSyncplaySession *session) {
  return session == NULL ? 0u : session->participant_count;
}

bool multiplex_syncplay_session_room_position(
    const MultiplexSyncplaySession *session, uint32_t *position_ms,
    bool *paused) {
  if (session == NULL || position_ms == NULL || paused == NULL ||
      !session->room_position_known) {
    return false;
  }
  *position_ms = session->room_position_ms;
  *paused = session->room_paused;
  return true;
}

void multiplex_syncplay_session_destroy(MultiplexSyncplaySession *session) {
  if (session == NULL) {
    return;
  }
  if (session->connected) {
    const uint8_t normal_close[2] = {0x03u, 0xe8u};
    send_frame(&session->transport, 0x8u, normal_close, sizeof(normal_close));
  }
  close_socket(&session->transport);
  free(session);
}
