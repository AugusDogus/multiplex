/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Small seekable HTTP byte-range reader for the first GameCube network
 * boundary. A 32 KiB range cache amortizes BBA round trips for artwork and
 * metadata inspection. Playback then
 * switches to a forward-only HTTP response read in the same bounded chunks.
 */

#include "http_client.h"
#include "tls_client.h"

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
#define HTTP_REQUEST_LIMIT 4096
#define HTTP_HOST_LIMIT 128
#define HTTP_PATH_LIMIT 1024
#define HTTP_ADDITIONAL_HEADERS_LIMIT 1536
#define HTTP_MAX_MEDIA_SIZE UINT32_MAX
#define HTTP_CACHE_SIZE (32u * 1024u)
#define HTTP_BODY_STREAM_CHUNK_SIZE (4u * 1024u)
#define HTTP_SMALL_MEDIA_CACHE_SIZE (256u * 1024u)
#define HTTP_IO_TIMEOUT_SECONDS 30
#define HTTP_STREAM_TIMEOUT_SECONDS 2
#define HTTP_RANGE_ATTEMPTS 4
#define HTTP_JSON_REQUEST_LIMIT 4096
#define HTTP_JSON_FRAMING_ALLOWANCE 2048

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
  char additional_headers[HTTP_ADDITIONAL_HEADERS_LIMIT];
  uint16_t port;
  int socket;
  bool secure;
  MultiplexTlsClient *tls;
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
  volatile bool stopping;
};

static bool network_initialized;
static char network_gateway[16];

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
  static const char http_prefix[] = "http://";
  static const char https_prefix[] = "https://";
  size_t prefix_size = 0;
  if (url != NULL &&
      strncmp(url, http_prefix, sizeof(http_prefix) - 1u) == 0) {
    prefix_size = sizeof(http_prefix) - 1u;
    client->secure = false;
    client->port = 80;
  } else if (url != NULL &&
             strncmp(url, https_prefix, sizeof(https_prefix) - 1u) == 0) {
    prefix_size = sizeof(https_prefix) - 1u;
    client->secure = true;
    client->port = 443;
  } else {
    return false;
  }

  const char *authority = url + prefix_size;
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
  for (size_t index = 0; index < host_size; ++index) {
    const char character = client->host[index];
    if (!((character >= 'A' && character <= 'Z') ||
          (character >= 'a' && character <= 'z') ||
          (character >= '0' && character <= '9') || character == '.' ||
          character == '-')) {
      return false;
    }
  }
  if (path == NULL) {
    strcpy(client->path, "/");
  } else {
    memcpy(client->path, path, path_size + 1u);
  }
  if (port_separator != NULL &&
      !parse_port(port_separator + 1, authority_end, &client->port)) {
    return false;
  }
  return true;
}

static bool format_additional_headers(HttpClient *client,
                                      const HttpRequestHeader *headers,
                                      size_t header_count) {
  if (header_count != 0 && headers == NULL) {
    return false;
  }
  size_t used = 0;
  for (size_t index = 0; index < header_count; ++index) {
    const char *name = headers[index].name;
    const char *value = headers[index].value;
    if (name == NULL || value == NULL || name[0] == '\0' ||
        strchr(name, ':') != NULL || strpbrk(name, "\r\n") != NULL ||
        strpbrk(value, "\r\n") != NULL) {
      return false;
    }
    const int size = snprintf(client->additional_headers + used,
                              sizeof(client->additional_headers) - used,
                              "%s: %s\r\n", name, value);
    if (size <= 0 ||
        (size_t)size >= sizeof(client->additional_headers) - used) {
      return false;
    }
    used += (size_t)size;
  }
  return true;
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
  strcpy(network_gateway, gateway);
  return true;
}

static void disconnect_client(HttpClient *client) {
  multiplex_tls_client_destroy(client->tls);
  client->tls = NULL;
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
  const int no_delay = 1;
  if (net_setsockopt(client->socket, IPPROTO_TCP, TCP_NODELAY, &no_delay,
                     sizeof(no_delay)) < 0) {
    disconnect_client(client);
    return false;
  }

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_len = sizeof(address);
  address.sin_port = htons(client->port);
  if (inet_aton(client->host, &address.sin_addr) == 0) {
    const size_t host_size = strlen(client->host);
    static const char localhost_suffix[] = ".localhost";
    const size_t suffix_size = sizeof(localhost_suffix) - 1u;
    if (host_size <= suffix_size ||
        strcmp(client->host + host_size - suffix_size, localhost_suffix) !=
            0 ||
        inet_aton(network_gateway, &address.sin_addr) == 0) {
      SYS_Report("REFERENCE GX: HTTP hostname unresolved host=%s\n",
                 client->host);
      disconnect_client(client);
      return false;
    }
    SYS_Report("REFERENCE GX: HTTP emulator host=%s gateway=%s\n",
               client->host, network_gateway);
  }
  if (net_connect(client->socket, (struct sockaddr *)&address,
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
  if (client->secure) {
    client->tls = multiplex_tls_client_connect(client->socket, client->host);
    if (client->tls == NULL) {
      disconnect_client(client);
      return false;
    }
  }
  return true;
}

static bool write_all(HttpClient *client, const uint8_t *bytes, size_t size) {
  if (client->tls != NULL) {
    return multiplex_tls_client_write_all(client->tls, bytes, size);
  }
  size_t written = 0;
  while (written < size) {
    fd_set writable;
    FD_ZERO(&writable);
    FD_SET(client->socket, &writable);
    struct timeval timeout = {
        .tv_sec = HTTP_IO_TIMEOUT_SECONDS,
        .tv_usec = 0,
    };
    if (net_select(client->socket + 1, NULL, &writable, NULL, &timeout) <= 0) {
      return false;
    }
    const int result =
        net_write(client->socket, bytes + written, size - written);
    if (result <= 0) {
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

static int read_available_with_timeout(HttpClient *client, void *destination,
                                       size_t size, unsigned timeout_seconds) {
  if (client->tls != NULL) {
    return multiplex_tls_client_read(client->tls, destination, size,
                                     timeout_seconds);
  }
  fd_set readable;
  FD_ZERO(&readable);
  FD_SET(client->socket, &readable);
  struct timeval timeout = {
      .tv_sec = timeout_seconds,
      .tv_usec = 0,
  };
  if (net_select(client->socket + 1, &readable, NULL, NULL, &timeout) <= 0) {
    return -1;
  }
  return net_recv(client->socket, destination, size, 0);
}

static int read_available(HttpClient *client, void *destination, size_t size) {
  return read_available_with_timeout(client, destination, size,
                                     HTTP_IO_TIMEOUT_SECONDS);
}

static bool read_headers(HttpClient *client, char *headers, size_t capacity,
                         size_t *header_size, size_t *response_size) {
  size_t used = 0;
  while (used + 1u < capacity) {
    const size_t previous = used;
    const int result =
        read_available(client, headers + used, capacity - used - 1u);
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
      if (sscanf(line + 14, " bytes %lu-%lu/%lu", &parsed_start, &parsed_end,
                 &parsed_total) != 3) {
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

static bool parse_json_headers(char *headers, HttpJsonResponse *response,
                               size_t *content_length, bool *chunked) {
  memset(response, 0, sizeof(*response));
  *content_length = 0;
  *chunked = false;
  if (sscanf(headers, "HTTP/%*u.%*u %u", &response->status) != 1 ||
      response->status < 100 || response->status > 599) {
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
        ++value;
      }
      char *end = NULL;
      const unsigned long parsed = strtoul(value, &end, 10);
      if (end == value || end > line_end) {
        return false;
      }
      *content_length = (size_t)parsed;
    } else if (strncasecmp(line, "Transfer-Encoding:", 18) == 0) {
      const char *encoding = strstr(line + 18, "chunked");
      if (encoding != NULL && encoding < line_end) {
        *chunked = true;
      }
    }
    line = line_end;
  }
  return *chunked || *content_length != 0;
}

static bool decode_chunked_body(const uint8_t *encoded, size_t encoded_size,
                                char *destination, size_t capacity,
                                size_t *decoded_size) {
  size_t input = 0;
  size_t output = 0;
  while (input < encoded_size) {
    size_t chunk_size = 0;
    bool saw_digit = false;
    while (input < encoded_size && encoded[input] != '\r') {
      const uint8_t value = encoded[input++];
      unsigned digit = 0;
      if (value >= '0' && value <= '9') {
        digit = value - '0';
      } else if (value >= 'a' && value <= 'f') {
        digit = value - 'a' + 10u;
      } else if (value >= 'A' && value <= 'F') {
        digit = value - 'A' + 10u;
      } else if (value == ';') {
        while (input < encoded_size && encoded[input] != '\r') {
          ++input;
        }
        break;
      } else {
        return false;
      }
      saw_digit = true;
      if (chunk_size > (SIZE_MAX - digit) / 16u) {
        return false;
      }
      chunk_size = chunk_size * 16u + digit;
    }
    if (!saw_digit || input + 2u > encoded_size || encoded[input] != '\r' ||
        encoded[input + 1u] != '\n') {
      return false;
    }
    input += 2u;
    if (chunk_size == 0) {
      if (output >= capacity) {
        return false;
      }
      destination[output] = '\0';
      *decoded_size = output;
      return true;
    }
    if (chunk_size > encoded_size - input || chunk_size >= capacity - output) {
      return false;
    }
    memcpy(destination + output, encoded + input, chunk_size);
    input += chunk_size;
    output += chunk_size;
    if (input + 2u > encoded_size || encoded[input] != '\r' ||
        encoded[input + 1u] != '\n') {
      return false;
    }
    input += 2u;
  }
  return false;
}

static bool read_body(HttpClient *client, uint8_t *destination, size_t size) {
  size_t received = 0;
  while (received < size) {
    const int result =
        read_available(client, destination + received, size - received);
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
      "%sRange: bytes=%u-%u\r\nConnection: keep-alive\r\n\r\n",
      client->path, client->host, client->additional_headers, (unsigned)start,
      (unsigned)end);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request) ||
      !write_all(client, (const uint8_t *)request, (size_t)request_size)) {
    SYS_Report("REFERENCE GX: HTTP range request failed offset=%u\n",
               (unsigned)start);
    return false;
  }

  char headers[HTTP_HEADER_LIMIT];
  size_t header_size = 0;
  size_t response_size = 0;
  if (!read_headers(client, headers, sizeof(headers), &header_size,
                    &response_size)) {
    SYS_Report("REFERENCE GX: HTTP response header unavailable offset=%u\n",
               (unsigned)start);
    return false;
  }
  const char first_body_byte = headers[header_size];
  headers[header_size] = '\0';
  HttpResponse response;
  const bool valid_headers = parse_headers(headers, &response);
  headers[header_size] = first_body_byte;
  const size_t prefetched = response_size - header_size;
  const size_t expected_end = valid_headers && end >= response.range_total
                                  ? response.range_total - 1u
                                  : end;
  if (!valid_headers || response.range_start != start ||
      response.range_end != expected_end ||
      prefetched > response.content_length ||
      (client->total_size != 0 && response.range_total != client->total_size)) {
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
      SYS_Report("REFERENCE GX: HTTP range retry offset=%u attempt=%u/%u\n",
                 (unsigned)start, attempt + 1u, HTTP_RANGE_ATTEMPTS);
      usleep(100000);
    }
  }
  return false;
}

static bool start_stream_response(HttpClient *client, size_t start) {
  if (client->stopping) {
    return false;
  }
  disconnect_client(client);
  if (!connect_client(client, false)) {
    return false;
  }

  char request[HTTP_REQUEST_LIMIT];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Multiplex-GameCube/0\r\n"
      "%sRange: bytes=%u-%u\r\nConnection: close\r\n\r\n",
      client->path, client->host, client->additional_headers, (unsigned)start,
      (unsigned)(client->total_size - 1u));
  if (request_size <= 0 || (size_t)request_size >= sizeof(request) ||
      !write_all(client, (const uint8_t *)request, (size_t)request_size)) {
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
  const bool valid = parse_stream_headers(headers, start, client->total_size);
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

static bool stream_read(HttpClient *client, uint8_t *destination, size_t size) {
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
    if (client->stopping) {
      return false;
    }
    const size_t remaining = size - copied;
    const size_t request_size =
        remaining < HTTP_CACHE_SIZE ? remaining : HTTP_CACHE_SIZE;
    const int result = read_available_with_timeout(
        client, destination + copied, request_size,
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
    if (client->stopping) {
      return false;
    }
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
      const size_t chunk =
          remaining < sizeof(discard) ? remaining : sizeof(discard);
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
    if (!client->stopping && attempt != HTTP_RANGE_ATTEMPTS) {
      SYS_Report("REFERENCE GX: HTTP stream retry offset=%u attempt=%u/%u\n",
                 (unsigned)offset, attempt + 1u, HTTP_RANGE_ATTEMPTS);
      usleep(100000);
    }
  }
  return false;
}

HttpClient *http_client_open_with_headers(const char *url,
                                          const HttpRequestHeader *headers,
                                          size_t header_count) {
  HttpClient *client = calloc(1, sizeof(*client));
  if (client == NULL) {
    return NULL;
  }
  client->socket = -1;
  if (!parse_url(url, client) ||
      !format_additional_headers(client, headers, header_count)) {
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
    SYS_Report("REFERENCE GX: HTTP open failed host=%s port=%u\n", client->host,
               client->port);
    http_client_destroy(client);
    return NULL;
  }
  return client;
}

HttpClient *http_client_open(const char *url) {
  return http_client_open_with_headers(url, NULL, 0);
}

void http_client_release_connection(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  disconnect_client(client);
  client->cache_size = 0;
}

void http_client_request_stop(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  client->stopping = true;
  disconnect_client(client);
}

void http_client_begin_stream(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  client->stopping = false;
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
  if (client == NULL || destination == NULL || offset > client->total_size ||
      size > client->total_size - offset) {
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

bool http_client_request_json(const char *method, const char *url,
                              const char *bearer_token, const char *body,
                              char *destination, size_t capacity,
                              HttpJsonResponse *response) {
  const HttpRequestHeader header = {
      .name = "Authorization",
      .value = bearer_token,
  };
  return http_client_request_with_headers(
      method, url,
      bearer_token == NULL || bearer_token[0] == '\0' ? NULL : &header,
      bearer_token == NULL || bearer_token[0] == '\0' ? 0u : 1u, body,
      destination, capacity, response);
}

static bool header_is_safe(const HttpRequestHeader *header) {
  if (header == NULL || header->name == NULL || header->value == NULL ||
      header->name[0] == '\0') {
    return false;
  }
  for (const char *cursor = header->name; *cursor != '\0'; ++cursor) {
    if (!((*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= 'a' && *cursor <= 'z') || *cursor == '-')) {
      return false;
    }
  }
  return strchr(header->value, '\r') == NULL &&
         strchr(header->value, '\n') == NULL;
}

typedef struct {
  HttpClient *client;
  const uint8_t *prefetched;
  size_t prefetched_size;
  size_t prefetched_offset;
} HttpBodyReader;

static int body_reader_read_some(HttpBodyReader *reader, uint8_t *destination,
                                 size_t size) {
  if (reader->prefetched_offset < reader->prefetched_size) {
    const size_t available =
        reader->prefetched_size - reader->prefetched_offset;
    const size_t copied = available < size ? available : size;
    memcpy(destination, reader->prefetched + reader->prefetched_offset,
           copied);
    reader->prefetched_offset += copied;
    return (int)copied;
  }
  return read_available(reader->client, destination, size);
}

static bool body_reader_read_exact(HttpBodyReader *reader,
                                   uint8_t *destination, size_t size) {
  size_t read = 0;
  while (read < size) {
    const int received =
        body_reader_read_some(reader, destination + read, size - read);
    if (received <= 0 || (size_t)received > size - read) {
      return false;
    }
    read += (size_t)received;
  }
  return true;
}

static bool body_reader_line(HttpBodyReader *reader, char *line,
                             size_t capacity) {
  size_t used = 0;
  while (used + 1u < capacity) {
    uint8_t byte = 0;
    if (!body_reader_read_exact(reader, &byte, 1)) {
      return false;
    }
    if (byte == '\n') {
      if (used != 0 && line[used - 1u] == '\r') {
        --used;
      }
      line[used] = '\0';
      return true;
    }
    line[used++] = (char)byte;
  }
  return false;
}

static bool parse_stream_request_headers(char *headers,
                                         HttpJsonResponse *response,
                                         size_t *content_length,
                                         bool *has_content_length,
                                         bool *chunked) {
  memset(response, 0, sizeof(*response));
  *content_length = 0;
  *has_content_length = false;
  *chunked = false;
  if (sscanf(headers, "HTTP/%*u.%*u %u", &response->status) != 1 ||
      response->status < 100 || response->status > 599) {
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
        ++value;
      }
      char *end = NULL;
      const unsigned long parsed = strtoul(value, &end, 10);
      if (end == value || end > line_end || parsed > SIZE_MAX) {
        return false;
      }
      *content_length = (size_t)parsed;
      *has_content_length = true;
    } else if (strncasecmp(line, "Transfer-Encoding:", 18) == 0) {
      const char *encoding = strstr(line + 18, "chunked");
      if (encoding != NULL && encoding < line_end) {
        *chunked = true;
      }
    }
    line = line_end;
  }
  return !*chunked || !*has_content_length;
}

static bool write_body(HttpBodyWrite write, void *context,
                       const uint8_t *bytes, size_t size) {
  return size == 0 || write == NULL || write(context, bytes, size);
}

static bool stream_content_length(HttpBodyReader *reader, size_t size,
                                  HttpBodyWrite write, void *context) {
  uint8_t buffer[HTTP_BODY_STREAM_CHUNK_SIZE];
  size_t read = 0;
  while (read < size) {
    const size_t remaining = size - read;
    const size_t chunk = remaining < sizeof(buffer) ? remaining
                                                    : sizeof(buffer);
    if (!body_reader_read_exact(reader, buffer, chunk) ||
        !write_body(write, context, buffer, chunk)) {
      return false;
    }
    read += chunk;
    LWP_YieldThread();
  }
  return true;
}

static bool parse_chunk_size(const char *line, size_t *size) {
  size_t parsed = 0;
  bool saw_digit = false;
  for (const char *cursor = line; *cursor != '\0' && *cursor != ';';
       ++cursor) {
    unsigned digit = 0;
    if (*cursor >= '0' && *cursor <= '9') {
      digit = (unsigned)(*cursor - '0');
    } else if (*cursor >= 'a' && *cursor <= 'f') {
      digit = (unsigned)(*cursor - 'a') + 10u;
    } else if (*cursor >= 'A' && *cursor <= 'F') {
      digit = (unsigned)(*cursor - 'A') + 10u;
    } else {
      return false;
    }
    saw_digit = true;
    if (parsed > (SIZE_MAX - digit) / 16u) {
      return false;
    }
    parsed = parsed * 16u + digit;
  }
  *size = parsed;
  return saw_digit;
}

static bool stream_chunked(HttpBodyReader *reader, HttpBodyWrite write,
                           void *context, size_t *body_size) {
  uint8_t buffer[HTTP_BODY_STREAM_CHUNK_SIZE];
  char line[128];
  *body_size = 0;
  for (;;) {
    size_t chunk_size = 0;
    if (!body_reader_line(reader, line, sizeof(line)) ||
        !parse_chunk_size(line, &chunk_size)) {
      return false;
    }
    if (chunk_size == 0) {
      do {
        if (!body_reader_line(reader, line, sizeof(line))) {
          return false;
        }
      } while (line[0] != '\0');
      return true;
    }
    if (chunk_size > SIZE_MAX - *body_size) {
      return false;
    }
    size_t remaining = chunk_size;
    while (remaining != 0) {
      const size_t part =
          remaining < sizeof(buffer) ? remaining : sizeof(buffer);
      if (!body_reader_read_exact(reader, buffer, part) ||
          !write_body(write, context, buffer, part)) {
        return false;
      }
      remaining -= part;
      LWP_YieldThread();
    }
    uint8_t terminator[2];
    if (!body_reader_read_exact(reader, terminator, sizeof(terminator)) ||
        terminator[0] != '\r' || terminator[1] != '\n') {
      return false;
    }
    *body_size += chunk_size;
  }
}

static bool stream_until_close(HttpBodyReader *reader, HttpBodyWrite write,
                               void *context, size_t *body_size) {
  uint8_t buffer[HTTP_BODY_STREAM_CHUNK_SIZE];
  *body_size = 0;
  for (;;) {
    const int received =
        body_reader_read_some(reader, buffer, sizeof(buffer));
    if (received == 0) {
      return true;
    }
    if (received < 0 ||
        !write_body(write, context, buffer, (size_t)received) ||
        *body_size > SIZE_MAX - (size_t)received) {
      return false;
    }
    *body_size += (size_t)received;
    LWP_YieldThread();
  }
}

bool http_client_stream_get_with_headers(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    HttpBodyWrite write, void *write_context, HttpJsonResponse *response) {
  if (url == NULL || response == NULL ||
      (header_count != 0 && headers == NULL)) {
    return false;
  }
  HttpClient *client = calloc(1, sizeof(*client));
  if (client == NULL) {
    return false;
  }
  client->socket = -1;
  if (!parse_url(url, client)) {
    free(client);
    return false;
  }
  if (!network_initialized) {
    if (!initialize_network()) {
      free(client);
      return false;
    }
    network_initialized = true;
  }
  if (!connect_client(client, false)) {
    free(client);
    return false;
  }

  char request[HTTP_JSON_REQUEST_LIMIT];
  int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s:%u\r\n"
      "User-Agent: Multiplex-GameCube/0\r\nAccept: */*\r\n",
      client->path, client->host, client->port);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request)) {
    http_client_destroy(client);
    return false;
  }
  size_t request_used = (size_t)request_size;
  for (size_t index = 0; index < header_count; ++index) {
    if (!header_is_safe(&headers[index])) {
      http_client_destroy(client);
      return false;
    }
    const int written = snprintf(
        request + request_used, sizeof(request) - request_used, "%s: %s\r\n",
        headers[index].name, headers[index].value);
    if (written <= 0 || (size_t)written >= sizeof(request) - request_used) {
      http_client_destroy(client);
      return false;
    }
    request_used += (size_t)written;
  }
  static const char tail[] = "Connection: close\r\n\r\n";
  if (sizeof(tail) > sizeof(request) - request_used) {
    http_client_destroy(client);
    return false;
  }
  memcpy(request + request_used, tail, sizeof(tail) - 1u);
  request_used += sizeof(tail) - 1u;
  if (!write_all(client, (const uint8_t *)request, request_used)) {
    http_client_destroy(client);
    return false;
  }
  char response_headers[HTTP_HEADER_LIMIT];
  size_t header_size = 0;
  size_t response_size = 0;
  if (!read_headers(client, response_headers, sizeof(response_headers),
                    &header_size, &response_size)) {
    http_client_destroy(client);
    return false;
  }
  const char first_body_byte = response_headers[header_size];
  response_headers[header_size] = '\0';
  size_t content_length = 0;
  bool has_content_length = false;
  bool chunked = false;
  const bool valid_headers = parse_stream_request_headers(
      response_headers, response, &content_length, &has_content_length,
      &chunked);
  response_headers[header_size] = first_body_byte;
  if (!valid_headers) {
    http_client_destroy(client);
    return false;
  }

  HttpBodyReader reader = {
      .client = client,
      .prefetched = (const uint8_t *)response_headers + header_size,
      .prefetched_size = response_size - header_size,
      .prefetched_offset = 0,
  };
  bool streamed = false;
  if (chunked) {
    streamed = stream_chunked(&reader, write, write_context,
                              &response->body_size);
  } else if (has_content_length) {
    streamed = stream_content_length(&reader, content_length, write,
                                     write_context);
    if (streamed) {
      response->body_size = content_length;
    }
  } else {
    streamed = stream_until_close(&reader, write, write_context,
                                  &response->body_size);
  }
  SYS_Report(
      "REFERENCE GX: HTTP stream status=%u bytes=%u framing=%s valid=%u\n",
      response->status, (unsigned)response->body_size,
      chunked ? "chunked" : has_content_length ? "length" : "close",
      streamed ? 1u : 0u);
  http_client_destroy(client);
  return streamed;
}

bool http_client_request_with_headers(const char *method, const char *url,
                                      const HttpRequestHeader *headers,
                                      size_t header_count, const char *body,
                                      char *destination, size_t capacity,
                                      HttpJsonResponse *response) {
  if (method == NULL || url == NULL || destination == NULL || capacity < 2 ||
      response == NULL || (header_count != 0 && headers == NULL)) {
    return false;
  }

  HttpClient *client = calloc(1, sizeof(*client));
  if (client == NULL) {
    return false;
  }
  client->socket = -1;
  if (!parse_url(url, client)) {
    free(client);
    return false;
  }
  if (!network_initialized) {
    if (!initialize_network()) {
      free(client);
      return false;
    }
    network_initialized = true;
  }
  if (!connect_client(client, false)) {
    free(client);
    return false;
  }

  const char *request_body = body == NULL ? "" : body;
  const size_t body_size = strlen(request_body);
  char request[HTTP_JSON_REQUEST_LIMIT];
  int request_size = snprintf(
      request, sizeof(request),
      "%s %s HTTP/1.1\r\nHost: %s:%u\r\n"
      "User-Agent: Multiplex-GameCube/0\r\nAccept: application/json\r\n"
      "Content-Type: application/json\r\nContent-Length: %u\r\n",
      method, client->path, client->host, client->port, (unsigned)body_size);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request)) {
    http_client_destroy(client);
    return false;
  }
  size_t request_used = (size_t)request_size;
  for (size_t index = 0; index < header_count; ++index) {
    if (!header_is_safe(&headers[index])) {
      http_client_destroy(client);
      return false;
    }
    const char *prefix =
        strcasecmp(headers[index].name, "Authorization") == 0 ? "Bearer " : "";
    const int written = snprintf(
        request + request_used, sizeof(request) - request_used, "%s: %s%s\r\n",
        headers[index].name, prefix, headers[index].value);
    if (written <= 0 || (size_t)written >= sizeof(request) - request_used) {
      http_client_destroy(client);
      return false;
    }
    request_used += (size_t)written;
  }
  const int tail_size =
      snprintf(request + request_used, sizeof(request) - request_used,
               "Connection: close\r\n\r\n%s", request_body);
  if (tail_size <= 0 || (size_t)tail_size >= sizeof(request) - request_used) {
    http_client_destroy(client);
    return false;
  }
  request_used += (size_t)tail_size;
  if (!write_all(client, (const uint8_t *)request, request_used)) {
    http_client_destroy(client);
    return false;
  }
  char response_headers[HTTP_HEADER_LIMIT];
  size_t header_size = 0;
  size_t response_size = 0;
  if (!read_headers(client, response_headers, sizeof(response_headers),
                    &header_size,
                    &response_size)) {
    http_client_destroy(client);
    return false;
  }
  const char first_body_byte = response_headers[header_size];
  response_headers[header_size] = '\0';
  size_t content_length = 0;
  bool chunked = false;
  const bool valid_headers = parse_json_headers(
      response_headers, response, &content_length, &chunked);
  response_headers[header_size] = first_body_byte;
  if (!valid_headers) {
    SYS_Report("REFERENCE GX: HTTP JSON headers invalid\n");
    http_client_destroy(client);
    return false;
  }

  const size_t prefetched = response_size - header_size;
  if (!chunked) {
    if (content_length >= capacity || prefetched > content_length) {
      http_client_destroy(client);
      return false;
    }
    memcpy(destination, response_headers + header_size, prefetched);
    const bool read = read_body(client, (uint8_t *)destination + prefetched,
                                content_length - prefetched);
    if (read) {
      destination[content_length] = '\0';
      response->body_size = content_length;
    }
    SYS_Report(
        "REFERENCE GX: HTTP JSON status=%u framing=length bytes=%u read=%u\n",
        response->status, (unsigned)content_length, read ? 1u : 0u);
    http_client_destroy(client);
    return read;
  }

  const size_t encoded_capacity = capacity + HTTP_JSON_FRAMING_ALLOWANCE;
  uint8_t *encoded = malloc(encoded_capacity);
  if (encoded == NULL || prefetched > encoded_capacity) {
    free(encoded);
    http_client_destroy(client);
    return false;
  }
  memcpy(encoded, response_headers + header_size, prefetched);
  size_t encoded_size = prefetched;
  while (encoded_size < encoded_capacity) {
    const int received = read_available(
        client, encoded + encoded_size, encoded_capacity - encoded_size);
    if (received <= 0) {
      break;
    }
    encoded_size += (size_t)received;
  }
  const bool decoded = decode_chunked_body(encoded, encoded_size, destination,
                                           capacity, &response->body_size);
  SYS_Report("REFERENCE GX: HTTP JSON status=%u framing=chunked encoded=%u "
             "decoded=%u valid=%u\n",
             response->status, (unsigned)encoded_size,
             (unsigned)response->body_size, decoded ? 1u : 0u);
  free(encoded);
  http_client_destroy(client);
  SYS_Report("REFERENCE GX: HTTP JSON connection closed\n");
  return decoded;
}
