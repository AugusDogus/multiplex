#include "tls_client.h"

#include "tls-ca.h"

#include <errno.h>
#include <fcntl.h>
#include <gccore.h>
#include <network.h>
#include <ogc/lwp_watchdog.h>

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/platform_time.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define TLS_IO_TIMEOUT_SECONDS 30u
/*
 * libogc2's unscaled receive window can shrink Portless/Node's advertised
 * peer window below a large TLS record. Keep control-plane records below the
 * smallest window observed while pasta is draining a remote TLS handshake.
 * Short records also keep the ancient libogc2/lwIP receive path responsive
 * while application code processes each decrypted chunk.
 */
#define TLS_GAMECUBE_WRITE_CHUNK 96u

struct MultiplexTlsClient {
  int socket;
  unsigned io_timeout_seconds;
  uint64_t entropy_state;
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context random;
};

static volatile int tls_last_error;
static volatile uint32_t tls_last_verify_flags;
static bool tls_trust_store_ready;
static mbedtls_x509_crt tls_trust_store;

int multiplex_tls_client_last_error(void) { return tls_last_error; }

uint32_t multiplex_tls_client_last_verify_flags(void) {
  return tls_last_verify_flags;
}

mbedtls_ms_time_t mbedtls_ms_time(void) {
  return (mbedtls_ms_time_t)ticks_to_millisecs(gettime());
}

static uint64_t mix64(uint64_t value) {
  value ^= value >> 30u;
  value *= UINT64_C(0xbf58476d1ce4e5b9);
  value ^= value >> 27u;
  value *= UINT64_C(0x94d049bb133111eb);
  return value ^ (value >> 31u);
}

static int gamecube_entropy(void *context, unsigned char *output, size_t size,
                            size_t *written) {
  uint64_t *state = context;
  uint8_t mac[6] = {0};
  net_get_mac_address(mac);
  uint64_t value = *state ^ (uint64_t)gettime() ^ (uint64_t)(uintptr_t)output ^
                   (uint64_t)(uintptr_t)&state;
  for (unsigned index = 0; index < sizeof(mac); ++index) {
    value = mix64(value ^ ((uint64_t)mac[index] << (index * 8u)));
  }
  for (size_t index = 0; index < size; ++index) {
    if ((index & 7u) == 0) {
      value = mix64(value + gettime() + index);
    }
    output[index] = (uint8_t)(value >> ((index & 7u) * 8u));
  }
  *state = mix64(value + size + gettime());
  *written = size;
  return 0;
}

static int wait_socket(int socket, bool write, unsigned timeout_seconds) {
  fd_set readable;
  fd_set writable;
  FD_ZERO(&readable);
  FD_ZERO(&writable);
  if (write) {
    FD_SET(socket, &writable);
  } else {
    FD_SET(socket, &readable);
  }
  struct timeval timeout = {
      .tv_sec = timeout_seconds,
      .tv_usec = 0,
  };
  return net_select(socket + 1, write ? NULL : &readable,
                    write ? &writable : NULL, NULL, &timeout);
}

static int flush_network_socket(int socket) {
#if defined(HW_DOL)
  return net_flush(socket);
#else
  (void)socket;
  return 0;
#endif
}

static int tls_send(void *context, const unsigned char *bytes, size_t size) {
  MultiplexTlsClient *client = context;
  /*
   * libogc2's writable select event can remain cleared after a small record
   * even though the TCP send buffer has ample space. net_write synchronously
   * queues or rejects the copy, so probing select first can only strand the
   * next TLS record.
   */
  const int result = net_write(client->socket, bytes, size);
  const int flush_result = result > 0 ? flush_network_socket(client->socket) : 0;
  if (flush_result < 0) {
    return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
  }
  return result < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : result;
}

static int tls_receive(void *context, unsigned char *bytes, size_t size) {
  MultiplexTlsClient *client = context;
  const int ready =
      wait_socket(client->socket, false, client->io_timeout_seconds);
  if (ready <= 0) {
    return MBEDTLS_ERR_SSL_WANT_READ;
  }
  if (net_fcntl(client->socket, F_SETFL, O_NONBLOCK) < 0) {
    return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
  }
  const int result = net_recv(client->socket, bytes, size, 0);
  if (net_fcntl(client->socket, F_SETFL, 0) < 0) {
    return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
  }
  if (result == -EAGAIN) {
    return MBEDTLS_ERR_SSL_WANT_READ;
  }
  return result < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : result;
}

static void report_tls_error(const char *operation, int error) {
  tls_last_error = error;
  char message[128];
  mbedtls_strerror(error, message, sizeof(message));
  SYS_Report("REFERENCE GX: TLS %s failed error=-%04x message=%s\n", operation,
             (unsigned)-error, message);
}

bool multiplex_tls_client_initialize(void) {
  if (tls_trust_store_ready) {
    return true;
  }
  if (multiplex_tls_ca_pem_size == 0) {
    tls_last_error = MBEDTLS_ERR_X509_BAD_INPUT_DATA;
    return false;
  }

  mbedtls_x509_crt_init(&tls_trust_store);
  const int result = mbedtls_x509_crt_parse(
      &tls_trust_store, (const unsigned char *)multiplex_tls_ca_pem,
      multiplex_tls_ca_pem_size);
  if (result < 0) {
    report_tls_error("CA bundle parse", result);
    mbedtls_x509_crt_free(&tls_trust_store);
    return false;
  }
  if (result > 0) {
    SYS_Report("REFERENCE GX: TLS CA bundle skipped=%d certificate(s)\n",
               result);
  }
  tls_trust_store_ready = true;
  tls_last_error = 0;
  tls_last_verify_flags = 0;
  SYS_Report("REFERENCE GX: TLS public trust store ready bytes=%u\n",
             multiplex_tls_ca_pem_size);
  return true;
}

MultiplexTlsClient *multiplex_tls_client_connect(int socket,
                                                 const char *hostname) {
  tls_last_error = 0;
  tls_last_verify_flags = 0;
  if (socket < 0 || hostname == NULL || hostname[0] == '\0') {
    tls_last_error = MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
    SYS_Report("REFERENCE GX: TLS configuration unavailable\n");
    return NULL;
  }
  if (!multiplex_tls_client_initialize()) {
    SYS_Report("REFERENCE GX: TLS trust store unavailable\n");
    return NULL;
  }
  MultiplexTlsClient *client = calloc(1, sizeof(*client));
  if (client == NULL) {
    tls_last_error = MBEDTLS_ERR_SSL_ALLOC_FAILED;
    return NULL;
  }
  client->socket = socket;
  client->io_timeout_seconds = TLS_IO_TIMEOUT_SECONDS;
  mbedtls_ssl_init(&client->ssl);
  mbedtls_ssl_config_init(&client->config);
  mbedtls_entropy_init(&client->entropy);
  mbedtls_ctr_drbg_init(&client->random);

  client->entropy_state =
      mix64((uint64_t)gettime() ^ (uint64_t)(uintptr_t)client);
  int result = mbedtls_entropy_add_source(&client->entropy, gamecube_entropy,
                                          &client->entropy_state, 32,
                                          MBEDTLS_ENTROPY_SOURCE_STRONG);
  static const unsigned char personalization[] = "Multiplex GameCube TLS";
  if (result == 0) {
    result = mbedtls_ctr_drbg_seed(&client->random, mbedtls_entropy_func,
                                   &client->entropy, personalization,
                                   sizeof(personalization) - 1u);
  }
  if (result == 0) {
    result = mbedtls_ssl_config_defaults(&client->config, MBEDTLS_SSL_IS_CLIENT,
                                         MBEDTLS_SSL_TRANSPORT_STREAM,
                                         MBEDTLS_SSL_PRESET_DEFAULT);
  }
  if (result == 0) {
    mbedtls_ssl_conf_authmode(&client->config, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&client->config, &tls_trust_store, NULL);
    mbedtls_ssl_conf_rng(&client->config, mbedtls_ctr_drbg_random,
                         &client->random);
    result = mbedtls_ssl_setup(&client->ssl, &client->config);
  }
  if (result == 0) {
    result = mbedtls_ssl_set_hostname(&client->ssl, hostname);
  }
  if (result == 0) {
    mbedtls_ssl_set_bio(&client->ssl, client, tls_send, tls_receive, NULL);
    result = mbedtls_ssl_handshake(&client->ssl);
  }
  tls_last_verify_flags = mbedtls_ssl_get_verify_result(&client->ssl);
  if (result == 0 && tls_last_verify_flags != 0) {
    result = MBEDTLS_ERR_X509_CERT_VERIFY_FAILED;
  }
  if (result != 0) {
    report_tls_error("handshake", result);
    multiplex_tls_client_destroy(client);
    return NULL;
  }
  tls_last_error = 0;
  SYS_Report("REFERENCE GX: TLS connected host=%s version=%s cipher=%s\n",
             hostname, mbedtls_ssl_get_version(&client->ssl),
             mbedtls_ssl_get_ciphersuite(&client->ssl));
  return client;
}

bool multiplex_tls_client_write_all(MultiplexTlsClient *client,
                                    const uint8_t *bytes, size_t size) {
  if (client == NULL || (size != 0 && bytes == NULL)) {
    return false;
  }
  size_t written = 0;
  while (written < size) {
    const size_t remaining = size - written;
    const size_t chunk_size = remaining < TLS_GAMECUBE_WRITE_CHUNK
                                  ? remaining
                                  : TLS_GAMECUBE_WRITE_CHUNK;
    const int result =
        mbedtls_ssl_write(&client->ssl, bytes + written, chunk_size);
    if (result <= 0) {
      report_tls_error("write", result);
      return false;
    }
    if (flush_network_socket(client->socket) < 0) {
      SYS_Report("REFERENCE GX: TLS transport flush failed\n");
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

int multiplex_tls_client_read(MultiplexTlsClient *client, uint8_t *destination,
                              size_t size, unsigned timeout_seconds) {
  if (client == NULL || destination == NULL || size == 0) {
    return -1;
  }
  client->io_timeout_seconds = timeout_seconds;
  const int result = mbedtls_ssl_read(&client->ssl, destination, size);
  if (result == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
    return 0;
  }
  if (result == MBEDTLS_ERR_SSL_WANT_READ ||
      result == MBEDTLS_ERR_SSL_WANT_WRITE) {
    return -EAGAIN;
  }
  if (result < 0) {
    report_tls_error("read", result);
  }
  return result;
}

void multiplex_tls_client_destroy(MultiplexTlsClient *client) {
  if (client == NULL) {
    return;
  }
  mbedtls_ssl_free(&client->ssl);
  mbedtls_ssl_config_free(&client->config);
  mbedtls_ctr_drbg_free(&client->random);
  mbedtls_entropy_free(&client->entropy);
  free(client);
}
