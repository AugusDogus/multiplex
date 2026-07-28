/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Small blocking HTTP byte-range client for the first GameCube network
 * boundary. The socket flow follows Dolphin's GameCube HTTP regression test,
 * and bounded ranges exercise repeated responses on one persistent BBA TCP
 * connection.
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
#define HTTP_MAX_DOWNLOAD (16u * 1024u * 1024u)
#define HTTP_RECEIVE_CHUNK 1024u
#define HTTP_RANGE_SIZE 1024u

typedef struct {
  char host[HTTP_HOST_LIMIT];
  char path[HTTP_PATH_LIMIT];
  uint16_t port;
} HttpUrl;

typedef struct {
  unsigned status;
  size_t content_length;
  size_t range_start;
  size_t range_total;
  bool ranged;
} HttpResponse;

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

static bool parse_url(const char *url, HttpUrl *parsed) {
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
  if (host_size == 0 || host_size >= sizeof(parsed->host) ||
      path_size >= sizeof(parsed->path)) {
    return false;
  }

  memcpy(parsed->host, authority, host_size);
  parsed->host[host_size] = '\0';
  if (path == NULL) {
    strcpy(parsed->path, "/");
  } else {
    memcpy(parsed->path, path, path_size + 1u);
  }
  parsed->port = 80;
  if (port_separator != NULL &&
      !parse_port(port_separator + 1, authority_end, &parsed->port)) {
    return false;
  }

  struct in_addr address;
  return inet_aton(parsed->host, &address) != 0;
}

static bool initialize_network(char *local_ip, size_t local_ip_size) {
  char netmask[16] = {0};
  char gateway[16] = {0};
  memset(local_ip, 0, local_ip_size);
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

static int connect_url(const HttpUrl *url) {
  const int socket = net_socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (socket < 0) {
    return socket;
  }

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_len = sizeof(address);
  address.sin_port = htons(url->port);
  if (inet_aton(url->host, &address.sin_addr) == 0 ||
      net_connect(socket, (struct sockaddr *)&address, sizeof(address)) < 0) {
    net_close(socket);
    return -1;
  }
  return socket;
}

static bool write_all(int socket, const uint8_t *bytes, size_t size) {
  size_t written = 0;
  while (written < size) {
    const int result =
        net_write(socket, bytes + written, size - written);
    if (result <= 0) {
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

static bool read_headers(int socket, char *headers, size_t capacity,
                         size_t *header_size, size_t *response_size) {
  size_t used = 0;
  while (used + 1u < capacity) {
    const size_t previous = used;
    const int result =
        net_recv(socket, headers + used, capacity - used - 1u, 0);
    if (result <= 0) {
      SYS_Report("REFERENCE GX: HTTP header read failed result=%d used=%u\n",
                 result, (unsigned)used);
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
      (response->status != 200 && response->status != 206)) {
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
          parsed > HTTP_MAX_DOWNLOAD) {
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
          range_total > HTTP_MAX_DOWNLOAD || range_end >= range_total) {
        return false;
      }
      response->range_start = (size_t)range_start;
      response->range_total = (size_t)range_total;
      response->ranged = true;
    }
    line = line_end;
  }
  if (response->content_length == 0) {
    return false;
  }
  if (response->status == 206) {
    return response->ranged;
  }
  response->range_start = 0;
  response->range_total = response->content_length;
  return !response->ranged;
}

static bool read_body(int socket, uint8_t *destination, size_t size) {
  uint8_t chunk[HTTP_RECEIVE_CHUNK];
  size_t received = 0;
  while (received < size) {
    const size_t remaining = size - received;
    const int result = net_recv(socket, chunk, sizeof(chunk), 0);
    if (result <= 0) {
      SYS_Report("REFERENCE GX: HTTP body read failed result=%d received=%u\n",
                 result, (unsigned)received);
      return false;
    }
    if ((size_t)result > remaining) {
      SYS_Report("REFERENCE GX: HTTP body exceeded Content-Length by %u bytes\n",
                 (unsigned)((size_t)result - remaining));
      return false;
    }
    memcpy(destination + received, chunk, (size_t)result);
    received += (size_t)result;
  }
  return true;
}

static bool send_range_request(int socket, const HttpUrl *url, size_t start) {
  const size_t end = start + HTTP_RANGE_SIZE - 1u;
  char request[HTTP_REQUEST_LIMIT];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s\r\nUser-Agent: Multiplex-GameCube/0\r\n"
      "Range: bytes=%u-%u\r\nConnection: keep-alive\r\n\r\n",
      url->path, url->host, (unsigned)start, (unsigned)end);
  return request_size > 0 && (size_t)request_size < sizeof(request) &&
         write_all(socket, (const uint8_t *)request, (size_t)request_size);
}

bool http_client_download(const char *url, HttpDownload *download) {
  if (download == NULL) {
    return false;
  }
  memset(download, 0, sizeof(*download));

  HttpUrl parsed;
  memset(&parsed, 0, sizeof(parsed));
  if (!parse_url(url, &parsed)) {
    SYS_Report("REFERENCE GX: HTTP URL parse failed\n");
    return false;
  }

  char local_ip[16];
  if (!initialize_network(local_ip, sizeof(local_ip))) {
    return false;
  }

  char headers[HTTP_HEADER_LIMIT];
  const int socket = connect_url(&parsed);
  if (socket < 0) {
    SYS_Report("REFERENCE GX: HTTP connect failed host=%s port=%u\n",
               parsed.host, parsed.port);
    return false;
  }

  /*
   * Dolphin's BBA HLE can report net_connect success before its host-side
   * proxy finishes the TCP handshake. Its own GameCube HTTP regression test
   * uses the same delay to avoid racing that connection state.
   */
  sleep(3);
  SYS_Report("REFERENCE GX: HTTP connected host=%s port=%u\n", parsed.host,
             parsed.port);

  size_t received = 0;
  size_t total = 0;
  unsigned ranges = 0;
  while (total == 0 || received < total) {
    if (!send_range_request(socket, &parsed, received)) {
      SYS_Report("REFERENCE GX: HTTP range request failed offset=%u\n",
                 (unsigned)received);
      goto fail;
    }

    size_t header_size = 0;
    size_t response_size = 0;
    if (!read_headers(socket, headers, sizeof(headers), &header_size,
                      &response_size)) {
      SYS_Report("REFERENCE GX: HTTP response header failed\n");
      goto fail;
    }
    const char first_body_byte = headers[header_size];
    headers[header_size] = '\0';
    HttpResponse response;
    const bool headers_valid = parse_headers(headers, &response);
    headers[header_size] = first_body_byte;
    const size_t prefetched = response_size - header_size;
    if (!headers_valid || response.range_start != received ||
        prefetched > response.content_length ||
        (response.status == 206 &&
         response.content_length > HTTP_RANGE_SIZE)) {
      SYS_Report("REFERENCE GX: HTTP range response invalid offset=%u\n",
                 (unsigned)received);
      goto fail;
    }

    if (total == 0) {
      total = response.range_total;
      download->data = malloc(total);
      if (download->data == NULL) {
        goto fail;
      }
    } else if (response.range_total != total) {
      goto fail;
    }
    if (response.content_length > total - received) {
      goto fail;
    }
    if (prefetched != 0) {
      memcpy(download->data + received, headers + header_size, prefetched);
    }
    if (!read_body(socket, download->data + received + prefetched,
                   response.content_length - prefetched)) {
      SYS_Report("REFERENCE GX: HTTP range body failed offset=%u bytes=%u\n",
                 (unsigned)received, (unsigned)response.content_length);
      goto fail;
    }
    received += response.content_length;
    ranges += 1;
    if (response.status == 200 && received != total) {
      goto fail;
    }
  }

  net_close(socket);
  download->size = total;
  SYS_Report(
      "REFERENCE GX: media-source=http host=%s port=%u bytes=%u ranges=%u\n",
      parsed.host, parsed.port, (unsigned)download->size, ranges);
  return true;

fail:
  net_close(socket);
  http_client_download_destroy(download);
  return false;
}

void http_client_download_destroy(HttpDownload *download) {
  if (download == NULL) {
    return;
  }
  free(download->data);
  download->data = NULL;
  download->size = 0;
}
