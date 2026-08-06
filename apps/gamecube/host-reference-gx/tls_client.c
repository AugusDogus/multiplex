#include "tls_client.h"

#include "memory_card_entropy.h"
#include "tls-ca.h"

#include <errno.h>
#include <fcntl.h>
#include <gccore.h>
#include <network.h>
#include <ogc/mutex.h>
#include <ogc/lwp_watchdog.h>

#ifndef MBEDTLS_CONFIG_FILE
#define MBEDTLS_CONFIG_FILE "mbedtls-gamecube-config.h"
#endif

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/asn1.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/platform_time.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if defined(HW_DOL)
extern s32 net_flush(s32 socket) __attribute__((weak));
#endif

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
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
};

static volatile int tls_last_error;
static volatile uint32_t tls_last_verify_flags;
static bool tls_trust_source_ready;
static bool tls_random_ready;
static bool tls_random_mutex_ready;
static const char *tls_failure_message;
static mbedtls_ctr_drbg_context tls_random;
static mutex_t tls_random_mutex;

static const char tls_certificate_begin[] = "-----BEGIN CERTIFICATE-----";
static const char tls_certificate_end[] = "-----END CERTIFICATE-----";

int multiplex_tls_client_last_error(void) { return tls_last_error; }

const char *multiplex_tls_client_failure_message(void) {
  return tls_failure_message;
}

uint32_t multiplex_tls_client_last_verify_flags(void) {
  return tls_last_verify_flags;
}

mbedtls_ms_time_t mbedtls_ms_time(void) {
  return (mbedtls_ms_time_t)ticks_to_millisecs(gettime());
}

static void clear_bytes(void *bytes, size_t size) {
  volatile uint8_t *cursor = bytes;
  while (size-- > 0) {
    *cursor++ = 0;
  }
}

static int boot_seed_entropy(void *context, unsigned char *output,
                             size_t size) {
  const uint8_t *boot_seed = context;
  if (boot_seed == NULL || output == NULL ||
      size != MULTIPLEX_ENTROPY_SEED_SIZE) {
    return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
  }
  memcpy(output, boot_seed, size);
  return 0;
}

static int locked_tls_random(void *context, unsigned char *output,
                             size_t size) {
  (void)context;
  if (!tls_random_ready || !tls_random_mutex_ready) {
    return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
  }
  LWP_MutexLock(tls_random_mutex);
  const int result = mbedtls_ctr_drbg_random(&tls_random, output, size);
  LWP_MutexUnlock(tls_random_mutex);
  return result;
}

static bool initialize_tls_random(void) {
  if (tls_random_ready) {
    return true;
  }

  uint8_t additional[MULTIPLEX_ENTROPY_SEED_SIZE] = {0};
  uint8_t mac[6] = {0};
  net_get_mac_address(mac);
  memcpy(additional, mac, sizeof(mac));
  const uint64_t now = gettime();
  memcpy(additional + 8u, &now, sizeof(now));
  const uintptr_t context_addresses[] = {
      (uintptr_t)&tls_random,
      (uintptr_t)&tls_last_error,
  };
  memcpy(additional + 16u, context_addresses, sizeof(context_addresses));

  uint8_t boot_seed[MULTIPLEX_ENTROPY_SEED_SIZE];
  const MultiplexEntropySeedResult seed_result =
      multiplex_memory_card_rotate_entropy(additional, boot_seed);
  clear_bytes(additional, sizeof(additional));
  if (seed_result != MULTIPLEX_ENTROPY_SEED_OK) {
    clear_bytes(boot_seed, sizeof(boot_seed));
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "Import TLS entropy save; HTTPS disabled";
    SYS_Report("REFERENCE GX: TLS entropy unavailable: %s\n",
               multiplex_entropy_seed_result_message(seed_result));
    return false;
  }

  mbedtls_ctr_drbg_init(&tls_random);
  mbedtls_ctr_drbg_set_entropy_len(&tls_random,
                                   MULTIPLEX_ENTROPY_SEED_SIZE);
  static const unsigned char personalization[] =
      "Multiplex GameCube TLS global random v1";
  const int result = mbedtls_ctr_drbg_seed(
      &tls_random, boot_seed_entropy, boot_seed, personalization,
      sizeof(personalization) - 1u);
  clear_bytes(boot_seed, sizeof(boot_seed));
  if (result != 0) {
    mbedtls_ctr_drbg_free(&tls_random);
    tls_last_error = result;
    tls_failure_message = "TLS secure random initialization failed";
    SYS_Report("REFERENCE GX: TLS DRBG initialization failed error=-%04x\n",
               (unsigned)-result);
    return false;
  }
  if (LWP_MutexInit(&tls_random_mutex, false) != 0) {
    mbedtls_ctr_drbg_free(&tls_random);
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS secure random lock unavailable";
    SYS_Report("REFERENCE GX: TLS DRBG mutex initialization failed\n");
    return false;
  }
  tls_random_mutex_ready = true;
  tls_random_ready = true;
  tls_failure_message = NULL;
  SYS_Report("REFERENCE GX: TLS random source ready from rotated seed\n");
  return true;
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
  if (net_flush != NULL) {
    return net_flush(socket);
  }
  return 0;
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

/* Keep candidate selection equivalent to Mbed TLS' X.509 name comparison. */
static int x509_memcasecmp(const void *left, const void *right, size_t size) {
  const unsigned char *left_bytes = left;
  const unsigned char *right_bytes = right;
  for (size_t index = 0; index < size; ++index) {
    const unsigned char difference = left_bytes[index] ^ right_bytes[index];
    if (difference == 0) {
      continue;
    }
    if (difference == 32 &&
        ((left_bytes[index] >= 'a' && left_bytes[index] <= 'z') ||
         (left_bytes[index] >= 'A' && left_bytes[index] <= 'Z'))) {
      continue;
    }
    return -1;
  }
  return 0;
}

static int x509_string_compare(const mbedtls_x509_buf *left,
                               const mbedtls_x509_buf *right) {
  if (left->tag == right->tag && left->len == right->len &&
      memcmp(left->p, right->p, right->len) == 0) {
    return 0;
  }
  const bool left_is_supported_string =
      left->tag == MBEDTLS_ASN1_UTF8_STRING ||
      left->tag == MBEDTLS_ASN1_PRINTABLE_STRING;
  const bool right_is_supported_string =
      right->tag == MBEDTLS_ASN1_UTF8_STRING ||
      right->tag == MBEDTLS_ASN1_PRINTABLE_STRING;
  if (left_is_supported_string && right_is_supported_string &&
      left->len == right->len &&
      x509_memcasecmp(left->p, right->p, right->len) == 0) {
    return 0;
  }
  return -1;
}

static int x509_name_compare(const mbedtls_x509_name *left,
                             const mbedtls_x509_name *right) {
  while (left != NULL || right != NULL) {
    if (left == NULL || right == NULL) {
      return -1;
    }
    if (left->oid.tag != right->oid.tag || left->oid.len != right->oid.len ||
        memcmp(left->oid.p, right->oid.p, right->oid.len) != 0 ||
        x509_string_compare(&left->val, &right->val) != 0 ||
        left->MBEDTLS_PRIVATE(next_merged) !=
            right->MBEDTLS_PRIVATE(next_merged)) {
      return -1;
    }
    left = left->next;
    right = right->next;
  }
  return 0;
}

static void free_ca_candidates(mbedtls_x509_crt *candidates) {
  if (candidates == NULL) {
    return;
  }
  mbedtls_x509_crt_free(candidates);
  free(candidates);
}

static int find_ca_candidates(void *context, const mbedtls_x509_crt *child,
                              mbedtls_x509_crt **candidate_cas) {
  (void)context;
  *candidate_cas = NULL;

  const size_t end_marker_size = sizeof(tls_certificate_end) - 1u;
  size_t largest_pem_size = 0;
  unsigned scanned = 0;
  const char *cursor = multiplex_tls_ca_pem;
  while ((cursor = strstr(cursor, tls_certificate_begin)) != NULL) {
    const char *end = strstr(cursor, tls_certificate_end);
    if (end == NULL) {
      return MBEDTLS_ERR_X509_INVALID_FORMAT;
    }
    const size_t pem_size = (size_t)(end - cursor) + end_marker_size;
    if (pem_size > largest_pem_size) {
      largest_pem_size = pem_size;
    }
    scanned += 1u;
    cursor = end + end_marker_size;
  }
  if (largest_pem_size == 0) {
    return MBEDTLS_ERR_X509_BAD_INPUT_DATA;
  }

  /*
   * Parsing the complete Mozilla bundle retains roughly 350 KiB on this
   * target. Scan one root at a time and return only possible signers so HTTPS
   * remains available while the decoder and media queues own most of MEM1.
   */
  unsigned char *pem = malloc(largest_pem_size + 1u);
  if (pem == NULL) {
    return MBEDTLS_ERR_X509_ALLOC_FAILED;
  }

  unsigned matches = 0;
  mbedtls_x509_crt *tail = NULL;
  cursor = multiplex_tls_ca_pem;
  while ((cursor = strstr(cursor, tls_certificate_begin)) != NULL) {
    const char *end = strstr(cursor, tls_certificate_end);
    if (end == NULL) {
      free(pem);
      free_ca_candidates(*candidate_cas);
      *candidate_cas = NULL;
      return MBEDTLS_ERR_X509_INVALID_FORMAT;
    }
    const size_t pem_size = (size_t)(end - cursor) + end_marker_size;
    memcpy(pem, cursor, pem_size);
    pem[pem_size] = '\0';

    mbedtls_x509_crt *candidate = calloc(1, sizeof(*candidate));
    if (candidate == NULL) {
      free(pem);
      free_ca_candidates(*candidate_cas);
      *candidate_cas = NULL;
      return MBEDTLS_ERR_X509_ALLOC_FAILED;
    }
    mbedtls_x509_crt_init(candidate);
    const int parse_result =
        mbedtls_x509_crt_parse(candidate, pem, pem_size + 1u);
    if (parse_result != 0) {
      mbedtls_x509_crt_free(candidate);
      free(candidate);
      free(pem);
      free_ca_candidates(*candidate_cas);
      *candidate_cas = NULL;
      return parse_result < 0 ? parse_result : MBEDTLS_ERR_X509_INVALID_FORMAT;
    }

    if (x509_name_compare(&candidate->subject, &child->issuer) == 0) {
      if (tail == NULL) {
        *candidate_cas = candidate;
      } else {
        tail->next = candidate;
      }
      tail = candidate;
      matches += 1u;
    } else {
      mbedtls_x509_crt_free(candidate);
      free(candidate);
    }
    cursor = end + end_marker_size;
  }
  free(pem);
  SYS_Report("REFERENCE GX: TLS CA lookup scanned=%u matched=%u\n", scanned,
             matches);
  return 0;
}

bool multiplex_tls_client_initialize(void) {
  if (tls_trust_source_ready && tls_random_ready) {
    return true;
  }
  if (multiplex_tls_ca_pem_size == 0) {
    tls_last_error = MBEDTLS_ERR_X509_BAD_INPUT_DATA;
    return false;
  }

  if (!initialize_tls_random()) {
    return false;
  }
  tls_trust_source_ready = true;
  tls_last_error = 0;
  tls_failure_message = NULL;
  tls_last_verify_flags = 0;
  SYS_Report("REFERENCE GX: TLS public trust source ready bytes=%u\n",
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
    SYS_Report("REFERENCE GX: TLS trust or secure random source unavailable\n");
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
  int result = mbedtls_ssl_config_defaults(&client->config,
                                           MBEDTLS_SSL_IS_CLIENT,
                                           MBEDTLS_SSL_TRANSPORT_STREAM,
                                           MBEDTLS_SSL_PRESET_DEFAULT);
  if (result == 0) {
    mbedtls_ssl_conf_authmode(&client->config, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_cb(&client->config, find_ca_candidates, NULL);
    mbedtls_ssl_conf_rng(&client->config, locked_tls_random, NULL);
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
  free(client);
}
