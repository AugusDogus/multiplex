#include "http.h"

#include "http_response.h"

#include <lwip/netdb.h>
#include <lwip/sockets.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HTTP_HOST_CAPACITY 256u
#define HTTP_PORT_CAPACITY 6u
#define HTTP_AUTHORITY_CAPACITY (HTTP_HOST_CAPACITY + HTTP_PORT_CAPACITY)
#define HTTP_REQUEST_CAPACITY 2048u
#define HTTP_RESPONSE_CAPACITY 8192u

typedef struct {
  char authority[HTTP_AUTHORITY_CAPACITY];
  char host[HTTP_HOST_CAPACITY];
  char port[HTTP_PORT_CAPACITY];
  const char *path;
} HttpUrl;

static bool parse_url(const char *url, HttpUrl *parsed) {
  static const char scheme[] = "http://";
  if (url == NULL || parsed == NULL ||
      strncmp(url, scheme, sizeof(scheme) - 1u) != 0) {
    return false;
  }
  const char *authority = url + sizeof(scheme) - 1u;
  const char *path = strchr(authority, '/');
  const char *authority_end = path == NULL ? url + strlen(url) : path;
  const size_t authority_length = (size_t)(authority_end - authority);
  if (authority_length == 0 || authority_length >= sizeof(parsed->authority)) {
    return false;
  }
  memcpy(parsed->authority, authority, authority_length);
  parsed->authority[authority_length] = '\0';
  const char *port =
      memchr(authority, ':', (size_t)(authority_end - authority));
  const char *host_end = port == NULL ? authority_end : port;
  const size_t host_length = (size_t)(host_end - authority);
  if (host_length == 0 || host_length >= sizeof(parsed->host)) {
    return false;
  }
  memcpy(parsed->host, authority, host_length);
  parsed->host[host_length] = '\0';
  if (port == NULL) {
    strcpy(parsed->port, "80");
  } else {
    const size_t port_length = (size_t)(authority_end - port - 1u);
    if (port_length == 0 || port_length >= sizeof(parsed->port)) {
      return false;
    }
    for (size_t index = 0; index < port_length; ++index) {
      if (port[index + 1u] < '0' || port[index + 1u] > '9') {
        return false;
      }
    }
    memcpy(parsed->port, port + 1u, port_length);
    parsed->port[port_length] = '\0';
  }
  parsed->path = path == NULL ? "/" : path;
  return true;
}

static int connect_url(const HttpUrl *url) {
  struct addrinfo hints;
  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *addresses = NULL;
  if (getaddrinfo(url->host, url->port, &hints, &addresses) != 0) {
    return -1;
  }
  int socket_fd = -1;
  for (const struct addrinfo *address = addresses; address != NULL;
       address = address->ai_next) {
    socket_fd =
        socket(address->ai_family, address->ai_socktype, address->ai_protocol);
    if (socket_fd < 0) {
      continue;
    }
    struct timeval timeout = {.tv_sec = 8, .tv_usec = 0};
    setsockopt(socket_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(socket_fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    if (connect(socket_fd, address->ai_addr, address->ai_addrlen) == 0) {
      break;
    }
    close(socket_fd);
    socket_fd = -1;
  }
  freeaddrinfo(addresses);
  return socket_fd;
}

static bool send_all(int socket_fd, const char *bytes, size_t size) {
  size_t sent = 0;
  while (sent < size) {
    const int result = send(socket_fd, bytes + sent, size - sent, 0);
    if (result <= 0) {
      return false;
    }
    sent += (size_t)result;
  }
  return true;
}

static bool receive_all(int socket_fd, uint8_t *bytes, size_t capacity,
                        size_t *size) {
  *size = 0;
  while (*size < capacity) {
    const int received = recv(socket_fd, bytes + *size, capacity - *size, 0);
    if (received == 0) {
      return true;
    }
    if (received < 0) {
      return false;
    }
    *size += (size_t)received;
  }
  uint8_t trailing;
  return recv(socket_fd, &trailing, 1, 0) == 0;
}

static size_t find_header_size(const uint8_t *response, size_t size) {
  for (size_t index = 0; index + 3u < size; ++index) {
    if (memcmp(response + index, "\r\n\r\n", 4u) == 0) {
      return index + 4u;
    }
  }
  return 0;
}

static int hex_digit(uint8_t character) {
  if (character >= '0' && character <= '9') {
    return character - '0';
  }
  if (character >= 'a' && character <= 'f') {
    return character - 'a' + 10;
  }
  if (character >= 'A' && character <= 'F') {
    return character - 'A' + 10;
  }
  return -1;
}

static bool decode_chunked(const uint8_t *body, size_t body_size,
                           char *destination, size_t capacity,
                           size_t *output_size) {
  size_t input = 0;
  size_t output = 0;
  while (input < body_size) {
    size_t chunk_size = 0;
    size_t digits = 0;
    while (input < body_size && body[input] != '\r') {
      const int digit = hex_digit(body[input++]);
      if (digit < 0 || chunk_size > (SIZE_MAX - (size_t)digit) / 16u) {
        return false;
      }
      chunk_size = chunk_size * 16u + (size_t)digit;
      ++digits;
    }
    if (digits == 0 || input + 1u >= body_size || body[input] != '\r' ||
        body[input + 1u] != '\n') {
      return false;
    }
    input += 2u;
    if (chunk_size == 0) {
      *output_size = output;
      return true;
    }
    if (chunk_size > body_size - input || chunk_size >= capacity - output) {
      return false;
    }
    memcpy(destination + output, body + input, chunk_size);
    input += chunk_size;
    output += chunk_size;
    if (input + 1u >= body_size || body[input] != '\r' ||
        body[input + 1u] != '\n') {
      return false;
    }
    input += 2u;
  }
  return false;
}

static bool extract_body(const uint8_t *response, size_t response_size,
                         char *destination, size_t capacity, unsigned *status) {
  const size_t header_size = find_header_size(response, response_size);
  HttpResponseHead head;
  if (header_size == 0 || !http_response_parse_headers((const char *)response,
                                                       header_size, &head)) {
    return false;
  }
  const uint8_t *body = response + header_size;
  const size_t available = response_size - header_size;
  size_t body_size = 0;
  if (head.framing == HTTP_RESPONSE_FRAMING_CHUNKED) {
    if (!decode_chunked(body, available, destination, capacity, &body_size)) {
      return false;
    }
  } else {
    body_size = head.framing == HTTP_RESPONSE_FRAMING_CONTENT_LENGTH
                    ? head.content_length
                    : available;
    if (body_size > available || body_size >= capacity) {
      return false;
    }
    memcpy(destination, body, body_size);
  }
  destination[body_size] = '\0';
  *status = head.status;
  return true;
}

bool multiplex_xbox_http_request_json(void *context, const char *method,
                                      const char *url, const char *bearer_token,
                                      const char *body, char *response_body,
                                      size_t response_capacity,
                                      unsigned *status) {
  (void)context;
  if (method == NULL || response_body == NULL || response_capacity == 0 ||
      status == NULL) {
    return false;
  }
  HttpUrl parsed;
  if (!parse_url(url, &parsed)) {
    return false;
  }
  const size_t body_size = body == NULL ? 0 : strlen(body);
  char request[HTTP_REQUEST_CAPACITY];
  const int request_size =
      snprintf(request, sizeof(request),
               "%s %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nAccept: "
               "application/json\r\n%s%s%s%sContent-Length: %lu\r\n\r\n%s",
               method, parsed.path, parsed.authority,
               bearer_token == NULL ? "" : "Authorization: Bearer ",
               bearer_token == NULL ? "" : bearer_token,
               bearer_token == NULL ? "" : "\r\n",
               body == NULL ? "" : "Content-Type: application/json\r\n",
               (unsigned long)body_size, body == NULL ? "" : body);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request)) {
    return false;
  }

  const int socket_fd = connect_url(&parsed);
  if (socket_fd < 0) {
    return false;
  }
  uint8_t *response = malloc(HTTP_RESPONSE_CAPACITY);
  if (response == NULL) {
    close(socket_fd);
    return false;
  }
  size_t received = 0;
  const bool succeeded =
      send_all(socket_fd, request, (size_t)request_size) &&
      receive_all(socket_fd, response, HTTP_RESPONSE_CAPACITY, &received) &&
      extract_body(response, received, response_body, response_capacity,
                   status);
  free(response);
  close(socket_fd);
  return succeeded;
}
