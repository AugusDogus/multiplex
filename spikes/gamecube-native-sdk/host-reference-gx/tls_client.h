#ifndef MULTIPLEX_TLS_CLIENT_H
#define MULTIPLEX_TLS_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MultiplexTlsClient MultiplexTlsClient;

MultiplexTlsClient *multiplex_tls_client_connect(int socket,
                                                 const char *hostname);
bool multiplex_tls_client_write_all(MultiplexTlsClient *client,
                                    const uint8_t *bytes, size_t size);
int multiplex_tls_client_read(MultiplexTlsClient *client, uint8_t *destination,
                              size_t size, unsigned timeout_seconds);
void multiplex_tls_client_destroy(MultiplexTlsClient *client);

#endif
