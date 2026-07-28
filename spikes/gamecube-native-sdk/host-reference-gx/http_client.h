#ifndef MULTIPLEX_HTTP_CLIENT_H
#define MULTIPLEX_HTTP_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct HttpClient HttpClient;

typedef struct {
  unsigned status;
  size_t body_size;
} HttpJsonResponse;

typedef struct {
  const char *name;
  const char *value;
} HttpRequestHeader;

HttpClient *http_client_open(const char *url);
void http_client_request_stop(HttpClient *client);
void http_client_begin_stream(HttpClient *client);
void http_client_release_connection(HttpClient *client);
void http_client_destroy(HttpClient *client);

bool http_client_read_at(HttpClient *client, size_t offset,
                         uint8_t *destination, size_t size);
size_t http_client_size(const HttpClient *client);
unsigned http_client_range_count(const HttpClient *client);
const char *http_client_host(const HttpClient *client);
uint16_t http_client_port(const HttpClient *client);
bool http_client_request_json(const char *method, const char *url,
                              const char *bearer_token, const char *body,
                              char *destination, size_t capacity,
                              HttpJsonResponse *response);
bool http_client_request_with_headers(const char *method, const char *url,
                                      const HttpRequestHeader *headers,
                                      size_t header_count, const char *body,
                                      char *destination, size_t capacity,
                                      HttpJsonResponse *response);

#endif
