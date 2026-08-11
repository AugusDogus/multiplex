#ifndef MULTIPLEX_TLS_CLIENT_H
#define MULTIPLEX_TLS_CLIENT_H

#include "http_cancellation.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MultiplexTlsClient MultiplexTlsClient;

/* Prepare the initialization lock before launching TLS-capable workers. */
bool multiplex_tls_client_prepare(void);
bool multiplex_tls_client_initialize(void);
MultiplexTlsClient *multiplex_tls_client_connect(int socket,
                                                 const char *hostname);
MultiplexTlsClient *multiplex_tls_client_connect_cancellable(
    int socket, const char *hostname,
    const MultiplexHttpCancellation *cancellation);
int multiplex_tls_client_last_error(void);
const char *multiplex_tls_client_failure_message(void);
uint32_t multiplex_tls_client_last_verify_flags(void);
bool multiplex_tls_client_write_all(MultiplexTlsClient *client,
                                    const uint8_t *bytes, size_t size);
bool multiplex_tls_client_write_all_cancellable(
    MultiplexTlsClient *client, const uint8_t *bytes, size_t size,
    const MultiplexHttpCancellation *cancellation);
int multiplex_tls_client_read(MultiplexTlsClient *client, uint8_t *destination,
                              size_t size, unsigned timeout_seconds);
int multiplex_tls_client_read_cancellable(
    MultiplexTlsClient *client, uint8_t *destination, size_t size,
    unsigned timeout_seconds, const MultiplexHttpCancellation *cancellation);
void multiplex_tls_client_destroy(MultiplexTlsClient *client);

#endif
