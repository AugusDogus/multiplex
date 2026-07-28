/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Small seekable HTTP byte-range reader for the first GameCube network
 * boundary. One persistent libogc2/BBA TCP connection backs a 1 KiB cache, so
 * callers can parse a large container without allocating the whole response.
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
#define HTTP_CACHE_SIZE 1024u

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
};

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

static bool connect_client(HttpClient *client) {
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
    return false;
  }

  /* Match Dolphin's own GameCube HTTP regression test connection grace. */
  sleep(3);
  SYS_Report("REFERENCE GX: HTTP connected host=%s port=%u\n", client->host,
             client->port);
  return true;
}

static bool write_all(int socket, const uint8_t *bytes, size_t size) {
  size_t written = 0;
  while (written < size) {
    const int result = net_write(socket, bytes + written, size - written);
    if (result <= 0) {
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

static bool read_headers(HttpClient *client, char *headers, size_t capacity,
                         size_t *header_size, size_t *response_size) {
  size_t used = 0;
  while (used + 1u < capacity) {
    const size_t previous = used;
    const int result = net_recv(client->socket, headers + used,
                                capacity - used - 1u, 0);
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

static bool read_body(HttpClient *client, uint8_t *destination, size_t size) {
  size_t received = 0;
  while (received < size) {
    const int result = net_recv(client->socket, destination + received,
                                size - received, 0);
    if (result <= 0 || (size_t)result > size - received) {
      return false;
    }
    received += (size_t)result;
  }
  return true;
}

static bool fetch_cache(HttpClient *client, size_t start) {
  if (client->total_size != 0 && start >= client->total_size) {
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
  if (!valid_headers || response.range_start != start ||
      response.range_end != end || prefetched > response.content_length ||
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
  if (!initialize_network() || !connect_client(client) ||
      !fetch_cache(client, 0)) {
    SYS_Report("REFERENCE GX: HTTP open failed host=%s port=%u\n",
               client->host, client->port);
    http_client_destroy(client);
    return NULL;
  }
  return client;
}

void http_client_destroy(HttpClient *client) {
  if (client == NULL) {
    return;
  }
  if (client->socket >= 0) {
    net_close(client->socket);
  }
  free(client);
}

bool http_client_read_at(HttpClient *client, size_t offset,
                         uint8_t *destination, size_t size) {
  if (client == NULL || destination == NULL ||
      offset > client->total_size || size > client->total_size - offset) {
    return false;
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
