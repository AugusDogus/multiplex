#ifndef MULTIPLEX_TLS_CLIENT_VERIFICATION_H
#define MULTIPLEX_TLS_CLIENT_VERIFICATION_H

#include <mbedtls/ssl.h>

#include <stddef.h>
#include <stdint.h>

typedef int (*MultiplexTlsRandom)(void *context, unsigned char *output,
                                  size_t size);

int multiplex_tls_client_configure(mbedtls_ssl_context *ssl,
                                   mbedtls_ssl_config *config,
                                   const char *hostname,
                                   mbedtls_x509_crt_ca_cb_t ca_callback,
                                   void *ca_context, MultiplexTlsRandom random,
                                   void *random_context);

int multiplex_tls_client_handshake_and_verify(mbedtls_ssl_context *ssl,
                                              uint32_t *verify_flags);

int multiplex_tls_client_accept_handshake(int handshake_result,
                                          uint32_t verify_flags);

#endif
