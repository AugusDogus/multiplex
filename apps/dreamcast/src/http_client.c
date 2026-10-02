#define _POSIX_C_SOURCE 200809L

#include "http_client.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <netdb.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

enum {
  HTTP_HOST_CAPACITY = 256,
  HTTP_PATH_CAPACITY = 1024,
  HTTP_HEADER_CAPACITY = 2048,
  HTTP_READ_CAPACITY = 1024,
  HTTP_RANGE_CAPACITY = 4096,
  HTTP_CONNECT_TIMEOUT_MS = 5000,
  HTTP_IO_TIMEOUT_MS = 5000,
  HTTP_CLOSE_TIMEOUT_MS = 1000,
  HTTP_CLOSE_SETTLE_MS = 500,
  HTTP_RANGE_ATTEMPTS = 3,
};

typedef struct {
  char host[HTTP_HOST_CAPACITY];
  char path[HTTP_PATH_CAPACITY];
  uint16_t port;
} ParsedUrl;

typedef struct {
  DreamcastHttpResponse response;
  bool has_content_range;
  size_t range_start;
  size_t range_end;
  size_t range_total;
  bool connection_close;
} ResponseMetadata;

typedef struct {
  uint8_t *destination;
  size_t capacity;
  size_t size;
} BufferWriter;

static bool parse_url(const char *url, ParsedUrl *parsed) {
  static const char prefix[] = "http://";
  if (url == NULL || parsed == NULL ||
      strncmp(url, prefix, sizeof(prefix) - 1u) != 0) {
    return false;
  }
  const char *authority = url + sizeof(prefix) - 1u;
  const char *path = strchr(authority, '/');
  const char *authority_end =
      path == NULL ? authority + strlen(authority) : path;
  const char *port_separator = NULL;
  for (const char *cursor = authority; cursor < authority_end; ++cursor) {
    if (*cursor == ':') {
      port_separator = cursor;
    }
  }
  const char *host_end =
      port_separator == NULL ? authority_end : port_separator;
  const size_t host_length = (size_t)(host_end - authority);
  if (host_length == 0 || host_length >= sizeof(parsed->host)) {
    return false;
  }
  memcpy(parsed->host, authority, host_length);
  parsed->host[host_length] = '\0';
  parsed->port = 80;
  if (port_separator != NULL) {
    char *end = NULL;
    const unsigned long port = strtoul(port_separator + 1, &end, 10);
    if (end != authority_end || port == 0 || port > UINT16_MAX) {
      return false;
    }
    parsed->port = (uint16_t)port;
  }
  const char *request_path = path == NULL ? "/" : path;
  if (strlen(request_path) >= sizeof(parsed->path)) {
    return false;
  }
  strcpy(parsed->path, request_path);
  return true;
}

static uint64_t monotonic_milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
    return 0;
  }
  return (uint64_t)now.tv_sec * 1000u + (uint64_t)now.tv_nsec / 1000000u;
}

static int remaining_milliseconds(uint64_t deadline) {
  const uint64_t now = monotonic_milliseconds();
  if (now >= deadline) {
    return 0;
  }
  const uint64_t remaining = deadline - now;
  return remaining > INT_MAX ? INT_MAX : (int)remaining;
}

static bool wait_socket(int socket_fd, short events, uint64_t deadline,
                        short *revents) {
  for (;;) {
    struct pollfd descriptor = {
        .fd = socket_fd,
        .events = events,
        .revents = 0,
    };
    const int timeout = remaining_milliseconds(deadline);
    if (timeout == 0) {
      return false;
    }
    const int result = poll(&descriptor, 1, timeout);
    if (result > 0) {
      if ((descriptor.revents & (POLLERR | POLLNVAL)) != 0) {
        return false;
      }
      *revents = descriptor.revents;
      return true;
    }
    if (result == 0) {
      return false;
    }
    if (errno != EINTR) {
      return false;
    }
  }
}

static int connect_http(const ParsedUrl *url) {
  char port[6];
  snprintf(port, sizeof(port), "%u", url->port);
  struct addrinfo hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *addresses = NULL;
  if (getaddrinfo(url->host, port, &hints, &addresses) != 0) {
    return -1;
  }

  int connected_socket = -1;
  for (const struct addrinfo *address = addresses; address != NULL;
       address = address->ai_next) {
    const int socket_fd =
        socket(address->ai_family, address->ai_socktype, address->ai_protocol);
    if (socket_fd < 0) {
      continue;
    }
    const int flags = fcntl(socket_fd, F_GETFL, 0);
    if (flags < 0 || fcntl(socket_fd, F_SETFL, flags | O_NONBLOCK) != 0) {
      close(socket_fd);
      continue;
    }
    if (connect(socket_fd, address->ai_addr, address->ai_addrlen) == 0) {
      connected_socket = socket_fd;
      break;
    }
    if (errno == EINPROGRESS) {
      short revents = 0;
      const uint64_t deadline =
          monotonic_milliseconds() + HTTP_CONNECT_TIMEOUT_MS;
      if (wait_socket(socket_fd, POLLOUT, deadline, &revents) &&
          (revents & POLLOUT) != 0) {
        connected_socket = socket_fd;
        break;
      }
    }
    close(socket_fd);
  }
  freeaddrinfo(addresses);
  return connected_socket;
}

static bool send_all(int socket_fd, const char *bytes, size_t size) {
  size_t sent = 0;
  uint64_t deadline = monotonic_milliseconds() + HTTP_IO_TIMEOUT_MS;
  while (sent < size) {
    short revents = 0;
    if (!wait_socket(socket_fd, POLLOUT, deadline, &revents) ||
        (revents & POLLOUT) == 0) {
      return false;
    }
    const ssize_t result =
        send(socket_fd, bytes + sent, size - sent, MSG_DONTWAIT);
    if (result > 0) {
      sent += (size_t)result;
      deadline = monotonic_milliseconds() + HTTP_IO_TIMEOUT_MS;
    } else if (result < 0 && errno != EAGAIN && errno != EWOULDBLOCK &&
               errno != EINTR) {
      return false;
    }
  }
  return true;
}

static bool ascii_equal(const char *left, const char *right, size_t size) {
  for (size_t index = 0; index < size; ++index) {
    char left_value = left[index];
    char right_value = right[index];
    if (left_value >= 'A' && left_value <= 'Z') {
      left_value = (char)(left_value - 'A' + 'a');
    }
    if (right_value >= 'A' && right_value <= 'Z') {
      right_value = (char)(right_value - 'A' + 'a');
    }
    if (left_value != right_value) {
      return false;
    }
  }
  return true;
}

static bool parse_content_range(const char *value, const char *line_end,
                                ResponseMetadata *metadata) {
  unsigned long start = 0;
  unsigned long end = 0;
  unsigned long total = 0;
  int consumed = 0;
  if (sscanf(value, "bytes %lu-%lu/%lu%n", &start, &end, &total, &consumed) !=
          3 ||
      value + consumed != line_end || start > end || end >= total ||
      start > (unsigned long)SIZE_MAX || end > (unsigned long)SIZE_MAX ||
      total > (unsigned long)SIZE_MAX || metadata->has_content_range) {
    return false;
  }
  metadata->has_content_range = true;
  metadata->range_start = (size_t)start;
  metadata->range_end = (size_t)end;
  metadata->range_total = (size_t)total;
  return true;
}

static bool parse_headers(char *headers, size_t size,
                          ResponseMetadata *metadata) {
  memset(metadata, 0, sizeof(*metadata));
  if (size < 12u || memcmp(headers, "HTTP/1.", 7) != 0 ||
      sscanf(headers, "HTTP/%*u.%*u %u", &metadata->response.status) != 1) {
    return false;
  }
  bool found_length = false;
  const char *cursor = strstr(headers, "\r\n");
  if (cursor == NULL) {
    return false;
  }
  cursor += 2;
  const char *end = headers + size;
  while (cursor < end && cursor[0] != '\r') {
    const char *line_end = strstr(cursor, "\r\n");
    if (line_end == NULL || line_end > end) {
      return false;
    }
    const size_t line_size = (size_t)(line_end - cursor);
    static const char length_name[] = "Content-Length:";
    static const char range_name[] = "Content-Range:";
    static const char connection_name[] = "Connection:";
    if (line_size >= sizeof(length_name) - 1u &&
        ascii_equal(cursor, length_name, sizeof(length_name) - 1u)) {
      const char *value = cursor + sizeof(length_name) - 1u;
      while (value < line_end && (*value == ' ' || *value == '\t')) {
        ++value;
      }
      char *value_end = NULL;
      const unsigned long parsed = strtoul(value, &value_end, 10);
      if (value == value_end || value_end != line_end ||
          parsed > (unsigned long)SIZE_MAX || found_length) {
        return false;
      }
      metadata->response.content_length = (size_t)parsed;
      found_length = true;
    } else if (line_size >= sizeof(range_name) - 1u &&
               ascii_equal(cursor, range_name, sizeof(range_name) - 1u)) {
      const char *value = cursor + sizeof(range_name) - 1u;
      while (value < line_end && (*value == ' ' || *value == '\t')) {
        ++value;
      }
      if (!parse_content_range(value, line_end, metadata)) {
        return false;
      }
    } else if (line_size >= sizeof(connection_name) - 1u &&
               ascii_equal(cursor, connection_name,
                           sizeof(connection_name) - 1u)) {
      const char *value = cursor + sizeof(connection_name) - 1u;
      while (value < line_end && (*value == ' ' || *value == '\t')) {
        ++value;
      }
      metadata->connection_close =
          (size_t)(line_end - value) == 5u && ascii_equal(value, "close", 5u);
    }
    cursor = line_end + 2;
  }
  return found_length;
}

static bool receive_some(int socket_fd, uint8_t *destination, size_t capacity,
                         size_t *received, uint64_t *deadline) {
  for (;;) {
    short revents = 0;
    if (!wait_socket(socket_fd, POLLIN, *deadline, &revents) ||
        (revents & (POLLIN | POLLHUP)) == 0) {
      return false;
    }
    const ssize_t result =
        recv(socket_fd, destination, capacity, MSG_DONTWAIT);
    if (result > 0) {
      *received = (size_t)result;
      *deadline = monotonic_milliseconds() + HTTP_IO_TIMEOUT_MS;
      return true;
    }
    if (result == 0) {
      return false;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
      return false;
    }
  }
}

static bool read_response(int socket_fd, DreamcastHttpWrite write,
                          void *context, ResponseMetadata *metadata) {
  char headers[HTTP_HEADER_CAPACITY];
  size_t received_size = 0;
  size_t header_size = 0;
  uint64_t deadline = monotonic_milliseconds() + HTTP_IO_TIMEOUT_MS;
  while (header_size == 0 && received_size + 1u < sizeof(headers)) {
    size_t received = 0;
    if (!receive_some(socket_fd, (uint8_t *)headers + received_size,
                      sizeof(headers) - received_size - 1u, &received,
                      &deadline)) {
      return false;
    }
    received_size += received;
    for (size_t index = 4u; index <= received_size; ++index) {
      if (memcmp(headers + index - 4u, "\r\n\r\n", 4) == 0) {
        header_size = index;
        break;
      }
    }
  }
  if (header_size == 0) {
    return false;
  }
  headers[received_size] = '\0';
  if (!parse_headers(headers, header_size, metadata)) {
    return false;
  }

  size_t delivered = received_size - header_size;
  if (delivered > metadata->response.content_length ||
      (delivered > 0 &&
       !write(context, (const uint8_t *)headers + header_size, delivered))) {
    return false;
  }
  uint8_t bytes[HTTP_READ_CAPACITY];
  while (delivered < metadata->response.content_length) {
    size_t requested = metadata->response.content_length - delivered;
    if (requested > sizeof(bytes)) {
      requested = sizeof(bytes);
    }
    size_t received = 0;
    if (!receive_some(socket_fd, bytes, requested, &received, &deadline) ||
        !write(context, bytes, received)) {
      return false;
    }
    delivered += received;
  }
  return true;
}

static bool send_request(int socket_fd, const ParsedUrl *parsed,
                         size_t range_offset, size_t range_size,
                         bool close_after_response) {
  char range[80] = "";
  if (range_size > 0) {
    const int range_written =
        snprintf(range, sizeof(range), "Range: bytes=%lu-%lu\r\n",
                 (unsigned long)range_offset,
                 (unsigned long)(range_offset + range_size - 1u));
    if (range_written <= 0 || (size_t)range_written >= sizeof(range)) {
      return false;
    }
  }
  char request[HTTP_PATH_CAPACITY + HTTP_HOST_CAPACITY + 176u];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: %s:%u\r\n%sConnection: %s\r\n"
      "User-Agent: Multiplex-Dreamcast/1\r\nAccept: */*\r\n\r\n",
      parsed->path, parsed->host, parsed->port, range,
      close_after_response ? "close" : "keep-alive");
  return request_size > 0 && (size_t)request_size < sizeof(request) &&
         send_all(socket_fd, request, (size_t)request_size);
}

static bool wait_for_peer_close(int socket_fd) {
  const uint64_t deadline =
      monotonic_milliseconds() + HTTP_CLOSE_TIMEOUT_MS;
  for (;;) {
    short revents = 0;
    if (!wait_socket(socket_fd, POLLIN, deadline, &revents) ||
        (revents & (POLLIN | POLLHUP)) == 0) {
      return false;
    }
    uint8_t extra;
    const ssize_t received = recv(socket_fd, &extra, 1, MSG_DONTWAIT);
    if (received == 0) {
      return true;
    }
    if (received > 0) {
      return false;
    }
    if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
      return false;
    }
  }
}

static void sleep_milliseconds(long milliseconds) {
  const struct timespec delay = {
      .tv_sec = 0,
      .tv_nsec = milliseconds * 1000000L,
  };
  (void)nanosleep(&delay, NULL);
}

static bool http_get(const char *url, size_t range_offset, size_t range_size,
                     DreamcastHttpWrite write, void *context,
                     ResponseMetadata *metadata) {
  ParsedUrl parsed;
  if (write == NULL || metadata == NULL ||
      (range_size > 0 && range_offset > SIZE_MAX - range_size) ||
      !parse_url(url, &parsed)) {
    return false;
  }
  const int socket_fd = connect_http(&parsed);
  if (socket_fd < 0) {
    return false;
  }
  const bool sent =
      send_request(socket_fd, &parsed, range_offset, range_size, true);
  const bool read = sent && read_response(socket_fd, write, context, metadata);
  const bool closed = read && wait_for_peer_close(socket_fd);
  close(socket_fd);
  sleep_milliseconds(HTTP_CLOSE_SETTLE_MS);
  return closed;
}

bool dreamcast_http_get(const char *url, DreamcastHttpWrite write,
                        void *context, DreamcastHttpResponse *response) {
  if (response == NULL) {
    return false;
  }
  ResponseMetadata metadata;
  const bool loaded = http_get(url, 0, 0, write, context, &metadata);
  if (loaded) {
    *response = metadata.response;
  }
  return loaded;
}

bool dreamcast_http_get_range(const char *url, size_t offset, size_t size,
                              DreamcastHttpWrite write, void *context,
                              DreamcastHttpResponse *response) {
  if (response == NULL) {
    return false;
  }
  ResponseMetadata metadata;
  const bool loaded =
      size > 0 && http_get(url, offset, size, write, context, &metadata);
  if (loaded) {
    *response = metadata.response;
  }
  return loaded;
}

static bool write_buffer(void *context, const uint8_t *bytes, size_t size) {
  BufferWriter *writer = context;
  if (size > writer->capacity - writer->size) {
    return false;
  }
  memcpy(writer->destination + writer->size, bytes, size);
  writer->size += size;
  return true;
}

static void sleep_before_retry(unsigned attempt) {
  sleep_milliseconds(attempt == 0 ? 100 : 250);
}

bool dreamcast_http_get_ranges(const char *url, size_t total_size,
                               size_t range_size, DreamcastHttpWrite write,
                               void *context) {
  if (total_size == 0 || range_size == 0 ||
      range_size > HTTP_RANGE_CAPACITY || write == NULL) {
    return false;
  }
  uint8_t *range = malloc(range_size);
  if (range == NULL) {
    return false;
  }
  size_t offset = 0;
  while (offset < total_size) {
    size_t expected_size = total_size - offset;
    if (expected_size > range_size) {
      expected_size = range_size;
    }
    bool loaded = false;
    for (unsigned attempt = 0; attempt < HTTP_RANGE_ATTEMPTS && !loaded;
         ++attempt) {
      BufferWriter writer = {
          .destination = range,
          .capacity = expected_size,
          .size = 0,
      };
      ResponseMetadata metadata;
      loaded = http_get(url, offset, expected_size, write_buffer, &writer,
                        &metadata) &&
               metadata.response.status == 206 &&
               metadata.response.content_length == expected_size &&
               metadata.has_content_range &&
               metadata.range_start == offset &&
               metadata.range_end == offset + expected_size - 1u &&
               metadata.range_total == total_size &&
               metadata.connection_close && writer.size == expected_size;
      if (!loaded && attempt + 1u < HTTP_RANGE_ATTEMPTS) {
        sleep_before_retry(attempt);
      }
    }
    if (!loaded || !write(context, range, expected_size)) {
      free(range);
      return false;
    }
    offset += expected_size;
  }
  free(range);
  return offset == total_size;
}

bool dreamcast_http_get_buffer(const char *url, uint8_t *destination,
                               size_t capacity, size_t *size,
                               DreamcastHttpResponse *response) {
  if (destination == NULL || size == NULL) {
    return false;
  }
  BufferWriter writer = {
      .destination = destination,
      .capacity = capacity,
      .size = 0,
  };
  const bool loaded = dreamcast_http_get(url, write_buffer, &writer, response);
  *size = loaded ? writer.size : 0;
  return loaded;
}
