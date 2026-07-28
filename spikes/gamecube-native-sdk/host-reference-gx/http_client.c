/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Small seekable HTTP byte-range reader for the first GameCube network
 * boundary. A 32 KiB range cache amortizes BBA round trips for artwork and
 * metadata inspection. Playback then
 * switches to a forward-only HTTP response read in the same bounded chunks.
 */

#include "http_client.h"

#include <gccore.h>
#include <network.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>

#define HTTP_HEADER_LIMIT 4096
#define HTTP_REQUEST_LIMIT 768
#define HTTP_HOST_LIMIT 64
#define HTTP_PATH_LIMIT 512
#define HTTP_MAX_MEDIA_SIZE UINT32_MAX
#define HTTP_CACHE_SIZE (32u * 1024u)
#define HTTP_SMALL_MEDIA_CACHE_SIZE (256u * 1024u)
#define HTTP_IO_TIMEOUT_SECONDS 8
#define HTTP_STREAM_TIMEOUT_SECONDS 2
#define HTTP_RANGE_ATTEMPTS 4

typedef struct {
  unsigned status;
  size_t content_length;
  size_t range_start;
  size_t range_end;
  size_t range_total;
  bool ranged;
} HttpResponse;

struct HttpClient {
  char host[HTTP_HOST_LIMIT];
  char path[HTTP_PATH_LIMIT];
  uint16_t port;
  int socket;
  uint8_t cache[HTTP_CACHE_SIZE];
  size_t cache_start;
  size_t cache_size;
  size_t total_size;
  unsigned ranges;
  bool streaming;
  size_t stream_position;
  uint8_t stream_prefetch[HTTP_HEADER_LIMIT];
  size_t stream_prefetch_offset;
  size_t stream_prefetch_size;
  uint8_t *small_media;
};

static bool network_initialized;

static bool parse_port(const char *begin, const char *end, uint16_t *port) {
  if (begin == end) {
    return false;
  }
  unsigned value = 0;
  for (const char *cursor = begin; cursor < end; ++cursor) {
    if (*cursor < '0' || *cursor > '9') {
      return false;
    }
    value = value * 10u + (unsigned)(*cursor - '0');
    if (value > UINT16_MAX) {
      return false;
    }
  }
  if (value == 0) {
    return false;
  }
  *port = (uint16_t)value;
  return true;
}

static bool parse_url(const char *url, HttpClient *client) {
  static const char prefix[] = "http://";
  if (url == NULL || strncmp(url, prefix, sizeof(prefix) - 1u) != 0) {
    return false;
  }

  const char *authority = url + sizeof(prefix) - 1u;
  const char *path = strchr(authority, '/');
  const char *authority_end = path == NULL ? url + strlen(url) : path;
  const char *port_separator = NULL;
  for (const char *cursor = authority; cursor < authority_end; ++cursor) {
    if (*cursor == ':') {
      port_separator = cursor;
    }
  }
  const char *host_end =
      port_separator == NULL ? authority_end : port_separator;
  const size_t host_size = (size_t)(host_end - authority);
  const size_t path_size = path == NULL ? 1u : strlen(path);
  if (host_size == 0 || host_size >= sizeof(client->host) ||
      path_size >= sizeof(client->path)) {
    return false;
  }

  memcpy(client->host, authority, host_size);
  client->host[host_size] = '\0';
  if (path == NULL) {
    strcpy(client->path, "/");
  } else {
    memcpy(client->path, path, path_size + 1u);
  }
  client->port = 80;
  if (port_separator != NULL &&
      !parse_port(port_separator + 1, authority_end, &client->port)) {
    return false;
  }

  struct in_addr address;
  return inet_aton(client->host, &address) != 0;
}

static bool initialize_network(void) {
  char local_ip[16] = {0};
  char netmask[16] = {0};
  char gateway[16] = {0};
  const int status = if_config(local_ip, netmask, gateway, true);
  if (status < 0) {
    SYS_Report("REFERENCE GX: HTTP network initialization failed status=%d\n",
               status);
    return false;
  }
  SYS_Report("REFERENCE GX: network=bba ip=%s netmask=%s gateway=%s\n",
             local_ip, netmask, gateway);
  return true;
}

static void disconnect_client(HttpClient *client) {
  if (client->socket >= 0) {
    net_close(client->socket);
    client->socket = -1;
  }
}

static bool connect_client(HttpClient *client, bool initial_connection) {
  client->socket = net_socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (client->socket < 0) {
    return false;
  }

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_len = sizeof(address);
  address.sin_port = htons(client->port);
  if (inet_aton(client->host, &address.sin_addr) == 0 ||
      net_connect(client->socket, (struct sockaddr *)&address,
                  sizeof(address)) < 0) {
    disconnect_client(client);
    return false;
  }
  if (initial_connection) {
    /* Match Dolphin's own GameCube HTTP regression test connection grace. */
    sleep(3);
    SYS_Report("REFERENCE GX: HTTP connected host=%s port=%u\n", client->host,
               client->port);
  }
  return true;
}

static bool write_all(int socket, const uint8_t *bytes, size_t size) {
  size_t written = 0;
  while (written < size) {
    fd_set writable;
    FD_ZERO(&writable);
    FD_SET(socket, &writable);
    struct timeval timeout = {
        .tv_sec = HTTP_IO_TIMEOUT_SECONDS,
        .tv_usec = 0,
    };
    if (net_select(socket + 1, NULL, &writable, NULL, &timeout) <= 0) {
      return false;
    }
    const int result = net_write(socket, bytes + written, size - written);
    if (result <= 0) {
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

static int read_available_with_timeout(int socket, void *destination,
                                       size_t size, unsigned timeout_seconds) {
  fd_set readable;
  FD_ZERO(&readable);
  FD_SET(socket, &readable);
  struct timeval timeout = {
      .tv_sec = timeout_seconds,
      .tv_usec = 0,
  };
  if (net_select(socket + 1, &readable, NULL, NULL, &timeout) <= 0) {
    return -1;
  }
  return net_recv(socket, destination, size, 0);
}

static int read_available(int socket, void *destination, size_t size) {
  return read_available_with_timeout(socket, destination, size,
                                     HTTP_IO_TIMEOUT_SECONDS);
}

static bool read_headers(HttpClient *client, char *headers, size_t capacity,
                         size_t *header_size, size_t *response_size) {
  size_t used = 0;
  while (used + 1u < capacity) {
    const size_t previous = used;
    const int result = read_available(client->socket, headers + used,
                                      capacity - used - 1u);
    if (result <= 0) {
      return false;
    }
    used += (size_t)result;
    const size_t scan_start = previous > 3u ? previous - 3u : 0u;
    for (size_t index = scan_start; index + 4u <= used; ++index) {
      if (memcmp(headers + index, "\r\n\r\n", 4) == 0) {
        headers[used] = '\0';
        *header_size = index + 4u;
        *response_size = used;
        return true;
      }
    }
  }
  return false;
}

static bool parse_headers(char *headers, HttpResponse *response) {
  memset(response, 0, sizeof(*response));
  if (sscanf(headers, "HTTP/%*u.%*u %u", &response->status) != 1 ||
      response->status != 206) {
    return false;
  }

  char *line = strstr(headers, "\r\n");
  while (line != NULL && line[2] != '\r' && line[2] != '\0') {
    line += 2;
    char *line_end = strstr(line, "\r\n");
    if (line_end == NULL) {
      return false;
    }
    if (strncasecmp(line, "Content-Length:", 15) == 0) {
      char *value = line + 15;
      while (*value == ' ' || *value == '\t') {
        value += 1;
      }
      char *end = NULL;
      const unsigned long parsed = strtoul(value, &end, 10);
      if (end == value || end > line_end || parsed == 0 ||
          parsed > HTTP_CACHE_SIZE) {
        return false;
      }
      response->content_length = (size_t)parsed;
    } else if (strncasecmp(line, "Content-Range:", 14) == 0) {
      unsigned long range_start = 0;
      unsigned long range_end = 0;
      unsigned long range_total = 0;
      if (sscanf(line + 14, " bytes %lu-%lu/%lu", &range_start, &range_end,
                 &range_total) != 3 ||
          range_end < range_start || range_total == 0 ||
          range_total > HTTP_MAX_MEDIA_SIZE || range_end >= range_total) {
        return false;
      }
      response->range_start = (size_t)range_start;
      response->range_end = (size_t)range_end;
      response->range_total = (size_t)range_total;
      response->ranged = true;
    }
    line = line_end;
  }

  return response->content_length != 0 && response->ranged &&
         response->range_end - response->range_start + 1u ==
             response->content_length;
}

static bool parse_stream_headers(char *headers, size_t expected_start,
                                 size_t expected_size) {
  unsigned status = 0;
  if (sscanf(headers, "HTTP/%*u.%*u %u", &status) != 1 || status != 206) {
    return false;
  }

  size_t content_length = 0;
  size_t range_start = 0;
  size_t range_end = 0;
  size_t range_total = 0;
  char *line = strstr(headers, "\r\n");
  while (line != NULL && line[2] != '\r' && line[2] != '\0') {
    line += 2;
    char *line_end = strstr(line, "\r\n");
    if (line_end == NULL) {
      return false;
    }
    if (strncasecmp(line, "Content-Length:", 15) == 0) {
      char *value = line + 15;
      while (*value == ' ' || *value == '\t') {
        value += 1;
      }
      char *end = NULL;
      const unsigned long parsed = strtoul(value, &end, 10);
      if (end == value || end > line_end || parsed > HTTP_MAX_MEDIA_SIZE) {
        return false;
      }
      content_length = (size_t)parsed;
    } else if (strncasecmp(line, "Content-Range:", 14) == 0) {
      unsigned long parsed_start = 0;
      unsigned long parsed_end = 0;
      unsigned long parsed_total = 0;
      if (sscanf(line + 14, " bytes %lu-%lu/%lu", &parsed_start,
                 &parsed_end, &parsed_total) != 3) {
        return false;
      }
      range_start = (size_t)parsed_start;
      range_end = (size_t)parsed_end;
      range_total = (size_t)parsed_total;
    }
    line = line_end;
  }
  return expected_start < expected_size && range_start == expected_start &&
         range_end == expected_size - 1u && range_total == expected_size &&
         content_length == expected_size - expected_start;
}

static bool read_body(HttpClient *client, uint8_t *destination, size_t size) {
  size_t received = 0;
  while (received < size) {
    const int result = read_available(client->socket, destination + received,
                                      size - received);
    if (result <= 0 || (size_t)result > size - received) {
      return false;
    }
    received += (size_t)result;
    if (received < size) {
      LWP_YieldThread();
    }
  }
  return true;
}

static bool fetch_cache_once(HttpClient *client, size_t start) {
  if (client->total_size != 0 && start >= client->total_size) {
    return false;
  }
  if (client->socket < 0 && !connect_client(client, false)) {
    return false;
  }
  size_t end = start + HTTP_CACHE_SIZE - 1u;
  if (end < start) {
    return false;
  }
  if (client->total_size != 0 && end >= client->total_size) {
    end = client->total_size - 1u;
  }

  char request[HTTP_REQUEST_LIMIT];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Multiplex-GameCube/0\r\n"
      "Range: bytes=%u-%u\r\nConnection: keep-alive\r\n\r\n",
      client->path, client->host, (unsigned)start, (unsigned)end);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request) ||
      !write_all(client->socket, (const uint8_t *)request,
                 (size_t)request_size)) {
    SYS_Report("REFERENCE GX: HTTP range request failed offset=%u\n",
               (unsigned)start);
    return false;
  }

  char headers[HTTP_HEADER_LIMIT];
  size_t header_size = 0;
  size_t response_size = 0;
  if (!read_headers(client, headers, sizeof(headers), &header_size,
                    &response_size)) {
    SYS_Report("REFERENCE GX: HTTP response header failed offset=%u\n",
               (unsigned)start);
    return false;
  }
  const char first_body_byte = headers[header_size];
  headers[header_size] = '\0';
  HttpResponse response;
  const bool valid_headers = parse_headers(headers, &response);
  headers[header_size] = first_body_byte;
  const size_t prefetched = response_size - header_size;
  const size_t expected_end =
      valid_headers && end >= response.range_total ? response.range_total - 1u
                                                   : end;
  if (!valid_headers || response.range_start != start ||
      response.range_end != expected_end ||
      prefetched > response.content_length ||
      (client->total_size != 0 &&
       response.range_total != client->total_size)) {
    SYS_Report("REFERENCE GX: HTTP range response invalid offset=%u\n",
               (unsigned)start);
    return false;
  }

  if (prefetched != 0) {
    memcpy(client->cache, headers + header_size, prefetched);
  }
  if (!read_body(client, client->cache + prefetched,
                 response.content_length - prefetched)) {
    SYS_Report("REFERENCE GX: HTTP range body failed offset=%u bytes=%u\n",
               (unsigned)start, (unsigned)response.content_length);
    return false;
  }

  client->cache_start = start;
  client->cache_size = response.content_length;
  client->total_size = response.range_total;
  client->ranges += 1;
  return true;
}

static bool fetch_cache(HttpClient *client, size_t start) {
  for (unsigned attempt = 1; attempt <= HTTP_RANGE_ATTEMPTS; ++attempt) {
    if (fetch_cache_once(client, start)) {
      return true;
    }
    disconnect_client(client);
    if (attempt != HTTP_RANGE_ATTEMPTS) {
      SYS_Report(
          "REFERENCE GX: HTTP range retry offset=%u attempt=%u/%u\n",
          (unsigned)start, attempt + 1u, HTTP_RANGE_ATTEMPTS);
      usleep(100000);
    }
  }
  return false;
}

static bool start_stream_response(HttpClient *client, size_t start) {
  disconnect_client(client);
  if (!connect_client(client, false)) {
    return false;
  }

  char request[HTTP_REQUEST_LIMIT];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Multiplex-GameCube/0\r\n"
      "Range: bytes=%u-%u\r\nConnection: close\r\n\r\n",
      client->path, client->host, (unsigned)start,
      (unsigned)(client->total_size - 1u));
  if (request_size <= 0 || (size_t)request_size >= sizeof(request) ||
      !write_all(client->socket, (const uint8_t *)request,
                 (size_t)request_size)) {
    return false;
  }

  char headers[HTTP_HEADER_LIMIT];
  size_t header_size = 0;
  size_t response_size = 0;
  if (!read_headers(client, headers, sizeof(headers), &header_size,
                    &response_size)) {
    return false;
  }
  const char first_body_byte = headers[header_size];
  headers[header_size] = '\0';
  const bool valid =
      parse_stream_headers(headers, start, client->total_size);
  headers[header_size] = first_body_byte;
  const size_t prefetched = response_size - header_size;
  if (!valid || prefetched > sizeof(client->stream_prefetch) ||
      prefetched > client->total_size) {
    return false;
  }
  memcpy(client->stream_prefetch, headers + header_size, prefetched);
  client->stream_prefetch_offset = 0;
  client->stream_prefetch_size = prefetched;
  client->stream_position = start;
  return true;
}

static bool stream_read(HttpClient *client, uint8_t *destination,
                        size_t size) {
  size_t copied = 0;
  while (copied < size &&
         client->stream_prefetch_offset < client->stream_prefetch_size) {
    const size_t available =
        client->stream_prefetch_size - client->stream_prefetch_offset;
    const size_t remaining = size - copied;
    const size_t chunk = available < remaining ? available : remaining;
    memcpy(destination + copied,
           client->stream_prefetch + client->stream_prefetch_offset, chunk);
    client->stream_prefetch_offset += chunk;
    client->stream_position += chunk;
    copied += chunk;
  }
  while (copied < size) {
    const size_t remaining = size - copied;
    const size_t request_size =
        remaining < HTTP_CACHE_SIZE ? remaining : HTTP_CACHE_SIZE;
    const int result = read_available_with_timeout(
        client->socket, destination + copied, request_size,
        HTTP_STREAM_TIMEOUT_SECONDS);
    if (result <= 0 || (size_t)result > request_size) {
      return false;
    }
    client->stream_position += (size_t)result;
    copied += (size_t)result;
    if (copied < size) {
      LWP_YieldThread();
    }
  }
  return true;
}

static bool stream_read_at(HttpClient *client, size_t offset,
                           uint8_t *destination, size_t size) {
  for (unsigned attempt = 1; attempt <= HTTP_RANGE_ATTEMPTS; ++attempt) {
    if (client->socket < 0 || offset < client->stream_position) {
      if (!start_stream_response(client, offset)) {
        disconnect_client(client);
        continue;
      }
    }
    uint8_t discard[HTTP_CACHE_SIZE];
    bool discarded = true;
    while (client->stream_position < offset) {
      const size_t remaining = offset - client->stream_position;
      const size_t chunk = remaining < sizeof(discard) ? remaining
                                                        : sizeof(discard);
      if (!stream_read(client, discard, chunk)) {
        discarded = false;
        break;
      }
    }
    if (discarded && offset == client->stream_position &&
        stream_read(client, destination, size)) {
      return true;
    }
    disconnect_client(client);
    if (attempt != HTTP_RANGE_ATTEMPTS) {
      SYS_Report(
          "REFERENCE GX: HTTP stream retry offset=%u attempt=%u/%u\n",
          (unsigned)offset, attempt + 1u, HTTP_RANGE_ATTEMPTS);
      usleep(100000);
    }
  }
  return false;
}

HttpClient *http_client_open(const char *url) {
  HttpClient *client = calloc(1, sizeof(*client));
  if (client == NULL) {
    return NULL;
  }
  client->socket = -1;
  if (!parse_url(url, client)) {
    SYS_Report("REFERENCE GX: HTTP URL parse failed\n");
    http_client_destroy(client);
    return NULL;
  }
  const bool first_connection = !network_initialized;
  if (first_connection) {
    if (!initialize_network()) {
      http_client_destroy(client);
      return NULL;
    }
    network_initialized = true;
  }
  if (!connect_client(client, first_connection) || !fetch_cache(client, 0)) {
    SYS_Report("REFERENCE GX: HTTP open failed host=%s port=%u\n",
               client->host, client->port);
    http_client_destroy(client);
    return NULL;
  }
  return client;
}

void http_client_release_connection(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  disconnect_client(client);
  client->cache_size = 0;
}

void http_client_begin_stream(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  if (client->total_size <= HTTP_SMALL_MEDIA_CACHE_SIZE) {
    uint8_t *small_media = malloc(client->total_size);
    size_t offset = 0;
    while (small_media != NULL && offset < client->total_size) {
      const size_t remaining = client->total_size - offset;
      const size_t chunk =
          remaining < HTTP_CACHE_SIZE ? remaining : HTTP_CACHE_SIZE;
      if (!http_client_read_at(client, offset, small_media + offset, chunk)) {
        free(small_media);
        small_media = NULL;
        break;
      }
      offset += chunk;
    }
    if (small_media != NULL) {
      client->small_media = small_media;
      SYS_Report("REFERENCE GX: HTTP small-media cache bytes=%u\n",
                 (unsigned)client->total_size);
    }
  }
  http_client_release_connection(client);
  client->streaming = true;
  client->stream_position = 0;
  client->stream_prefetch_offset = 0;
  client->stream_prefetch_size = 0;
}

void http_client_destroy(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  http_client_release_connection(client);
  free(client->small_media);
  free(client);
}

bool http_client_read_at(HttpClient *client, size_t offset,
                         uint8_t *destination, size_t size) {
  if (client == NULL || destination == NULL ||
      offset > client->total_size || size > client->total_size - offset) {
    return false;
  }
  if (client->small_media != NULL) {
    memcpy(destination, client->small_media + offset, size);
    return true;
  }
  if (client->streaming) {
    return stream_read_at(client, offset, destination, size);
  }

  size_t copied = 0;
  while (copied < size) {
    const size_t position = offset + copied;
    if (position < client->cache_start ||
        position >= client->cache_start + client->cache_size) {
      const size_t aligned = position - position % HTTP_CACHE_SIZE;
      if (!fetch_cache(client, aligned)) {
        return false;
      }
    }
    const size_t cache_offset = position - client->cache_start;
    const size_t available = client->cache_size - cache_offset;
    const size_t remaining = size - copied;
    const size_t chunk = available < remaining ? available : remaining;
    memcpy(destination + copied, client->cache + cache_offset, chunk);
    copied += chunk;
  }
  return true;
}

size_t http_client_size(const HttpClient *client) {
  return client == NULL ? 0 : client->total_size;
}

unsigned http_client_range_count(const HttpClient *client) {
  return client == NULL ? 0 : client->ranges;
}

const char *http_client_host(const HttpClient *client) {
  return client == NULL ? "" : client->host;
}

uint16_t http_client_port(const HttpClient *client) {
  return client == NULL ? 0 : client->port;
}
