#ifndef MBEDTLS_CONFIG_FILE
#define MBEDTLS_CONFIG_FILE "mbedtls-gamecube-config.h"
#endif

#include "tls_client_verification.h"

#include <mbedtls/x509_crt.h>

int multiplex_tls_client_configure(mbedtls_ssl_context *ssl,
                                   mbedtls_ssl_config *config,
                                   const char *hostname,
                                   mbedtls_x509_crt_ca_cb_t ca_callback,
                                   void *ca_context, MultiplexTlsRandom random,
                                   void *random_context) {
  if (ssl == NULL || config == NULL || hostname == NULL ||
      hostname[0] == '\0' || ca_callback == NULL || random == NULL) {
    return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
  }

  int result = mbedtls_ssl_config_defaults(config, MBEDTLS_SSL_IS_CLIENT,
                                           MBEDTLS_SSL_TRANSPORT_STREAM,
                                           MBEDTLS_SSL_PRESET_DEFAULT);
  if (result != 0) {
    return result;
  }

  mbedtls_ssl_conf_authmode(config, MBEDTLS_SSL_VERIFY_REQUIRED);
  mbedtls_ssl_conf_ca_cb(config, ca_callback, ca_context);
  mbedtls_ssl_conf_rng(config, random, random_context);
  result = mbedtls_ssl_setup(ssl, config);
  if (result != 0) {
    return result;
  }
  return mbedtls_ssl_set_hostname(ssl, hostname);
}

int multiplex_tls_client_handshake_and_verify(mbedtls_ssl_context *ssl,
                                              uint32_t *verify_flags) {
  if (ssl == NULL || verify_flags == NULL) {
    return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
  }

  const int result = mbedtls_ssl_handshake(ssl);
  *verify_flags = mbedtls_ssl_get_verify_result(ssl);
  return multiplex_tls_client_accept_handshake(result, *verify_flags);
}

int multiplex_tls_client_accept_handshake(int handshake_result,
                                          uint32_t verify_flags) {
  if (handshake_result == 0 && verify_flags != 0u) {
    return MBEDTLS_ERR_X509_CERT_VERIFY_FAILED;
  }
  return handshake_result;
}
