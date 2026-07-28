#ifndef MULTIPLEX_HTTP_CLIENT_H
#define MULTIPLEX_HTTP_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct HttpClient HttpClient;

HttpClient *http_client_open(const char *url);
void http_client_begin_stream(HttpClient *client);
void http_client_release_connection(HttpClient *client);
void http_client_destroy(HttpClient *client);

bool http_client_read_at(HttpClient *client, size_t offset,
                         uint8_t *destination, size_t size);
size_t http_client_size(const HttpClient *client);
unsigned http_client_range_count(const HttpClient *client);
const char *http_client_host(const HttpClient *client);
uint16_t http_client_port(const HttpClient *client);

#endif
