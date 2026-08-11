#ifndef MULTIPLEX_HTTP_CLIENT_H
#define MULTIPLEX_HTTP_CLIENT_H

#include "http_cancellation.h"

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

typedef bool (*HttpBodyWrite)(void *context, const uint8_t *bytes, size_t size);

typedef enum {
  HTTP_DIAGNOSTIC_NOT_STARTED = 0,
  HTTP_DIAGNOSTIC_DHCP = 1,
  HTTP_DIAGNOSTIC_READY = 2,
  HTTP_DIAGNOSTIC_SOCKET = 3,
  HTTP_DIAGNOSTIC_DNS = 4,
  HTTP_DIAGNOSTIC_CONNECT = 5,
  HTTP_DIAGNOSTIC_TLS = 6,
  HTTP_DIAGNOSTIC_REQUEST = 7,
  HTTP_DIAGNOSTIC_RESPONSE = 8,
} HttpClientDiagnosticStage;

bool http_client_initialize_network(void);
HttpClientDiagnosticStage http_client_diagnostic_stage(void);
const char *http_client_diagnostic_stage_name(void);
int32_t http_client_diagnostic_error(void);
int32_t http_client_network_status(void);
uint32_t http_client_network_attempts(void);
uint32_t http_client_dns_attempts(void);
uint32_t http_client_tls_verify_flags(void);
HttpClient *http_client_open(const char *url);
HttpClient *
http_client_open_cancellable(const char *url,
                             const MultiplexHttpCancellation *cancellation);
HttpClient *http_client_open_with_headers(const char *url,
                                          const HttpRequestHeader *headers,
                                          size_t header_count);
HttpClient *http_client_open_with_headers_cancellable(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    const MultiplexHttpCancellation *cancellation);
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
const char *http_client_network_gateway(void);
bool http_client_request_json(const char *method, const char *url,
                              const char *bearer_token, const char *body,
                              char *destination, size_t capacity,
                              HttpJsonResponse *response);
bool http_client_request_json_cancellable(
    const char *method, const char *url, const char *bearer_token,
    const char *body, char *destination, size_t capacity,
    const MultiplexHttpCancellation *cancellation, HttpJsonResponse *response);
bool http_client_request_with_headers(const char *method, const char *url,
                                      const HttpRequestHeader *headers,
                                      size_t header_count, const char *body,
                                      char *destination, size_t capacity,
                                      HttpJsonResponse *response);
bool http_client_request_with_headers_cancellable(
    const char *method, const char *url, const HttpRequestHeader *headers,
    size_t header_count, const char *body, char *destination, size_t capacity,
    const MultiplexHttpCancellation *cancellation, HttpJsonResponse *response);
bool http_client_stream_get_with_headers(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    HttpBodyWrite write, void *write_context, size_t full_response_skip,
    HttpJsonResponse *response);
bool http_client_stream_get_with_headers_cancellable(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    HttpBodyWrite write, void *write_context, size_t full_response_skip,
    const MultiplexHttpCancellation *cancellation, HttpJsonResponse *response);
bool http_client_stream_get_with_headers_concurrent(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    HttpBodyWrite write, void *write_context, size_t full_response_skip,
    HttpJsonResponse *response);
bool http_client_stream_get_with_headers_concurrent_cancellable(
    const char *url, const HttpRequestHeader *headers, size_t header_count,
    HttpBodyWrite write, void *write_context, size_t full_response_skip,
    const MultiplexHttpCancellation *cancellation, HttpJsonResponse *response);

#endif
