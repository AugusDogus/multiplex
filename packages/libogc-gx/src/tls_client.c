#include "tls_client.h"

#include "tls-ca.h"
#include "tls_read_poll.h"

#include <errno.h>
#include <fcntl.h>
#include <gccore.h>
#include <limits.h>
#include <network.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/mutex.h>
#include <ogc/timesupp.h>

#ifndef MBEDTLS_CONFIG_FILE
#define MBEDTLS_CONFIG_FILE "mbedtls-gamecube-config.h"
#endif

#include "tls_client_verification.h"
#include "x509_name_compare.h"

#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/platform_time.h>
#include <mbedtls/sha256.h>
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
#define TLS_ENTROPY_SEED_SIZE 32u
#define TLS_ENTROPY_TIMEBASE_SAMPLES 16u
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
  MultiplexHttpCancellation cancellation;
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
};

static volatile int tls_last_error;
static volatile uint32_t tls_last_verify_flags;
static bool tls_trust_source_ready;
static bool tls_random_ready;
static bool tls_random_mutex_ready;
static bool tls_initialization_mutex_ready;
static const char *tls_failure_message;
static mbedtls_ctr_drbg_context tls_random;
static mutex_t tls_random_mutex;
static mutex_t tls_initialization_mutex;
typedef struct {
  uint8_t seed[TLS_ENTROPY_SEED_SIZE];
  unsigned calls;
  bool available;
} BootSeedEntropy;
static BootSeedEntropy tls_boot_seed_entropy;

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
  BootSeedEntropy *entropy = context;
  if (entropy == NULL) {
    return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
  }
  entropy->calls += 1u;
  if (output == NULL || size != TLS_ENTROPY_SEED_SIZE || !entropy->available ||
      entropy->calls != 1u) {
    return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
  }
  memcpy(output, entropy->seed, size);
  clear_bytes(entropy->seed, sizeof(entropy->seed));
  entropy->available = false;
  return 0;
}

typedef struct {
  uint8_t mac[6];
  int8_t core_temperature;
  uint8_t reserved;
  uint32_t host_ip;
  uint32_t console_type;
  uint32_t hardware_revision;
  uint32_t counter_bias;
  uint32_t retrace_counts[TLS_ENTROPY_TIMEBASE_SAMPLES];
  uint64_t timebase[TLS_ENTROPY_TIMEBASE_SAMPLES];
  int64_t system_time[4];
  uintptr_t process_addresses[4];
  uintptr_t thread;
  int32_t thread_priority;
  int32_t thread_stack_size;
} LocalEntropyMaterial;

static bool collect_local_entropy(uint8_t seed[TLS_ENTROPY_SEED_SIZE]) {
  LocalEntropyMaterial material = {0};
  material.timebase[0] = gettime();
  net_get_mac_address(material.mac);
  material.timebase[1] = gettime();
  material.host_ip = net_gethostip();
  material.timebase[2] = gettime();
  material.system_time[0] = __SYS_GetSystemTime();
  material.timebase[3] = gettime();
  material.console_type = SYS_GetConsoleType();
  material.counter_bias = SYS_GetCounterBias();
#if defined(HW_DOL)
  material.hardware_revision = SYS_GetFlipperRevision();
  material.core_temperature = SYS_GetCoreTemperature();
#else
  material.hardware_revision = SYS_GetHollywoodRevision();
  material.core_temperature = -1;
#endif
  material.system_time[1] = __SYS_GetSystemTime();

  for (size_t index = 4u; index < TLS_ENTROPY_TIMEBASE_SAMPLES; ++index) {
    material.retrace_counts[index] = VIDEO_GetRetraceCount();
    material.timebase[index] = gettime();
  }
  material.system_time[2] = __SYS_GetSystemTime();
  material.process_addresses[0] = (uintptr_t)&material;
  material.process_addresses[1] = (uintptr_t)seed;
  material.process_addresses[2] = (uintptr_t)&tls_random;
  material.process_addresses[3] = (uintptr_t)&tls_last_error;
  const lwp_t thread = LWP_GetSelf();
  material.thread = (uintptr_t)thread;
  material.thread_priority = LWP_GetThreadPriority(thread);
  material.thread_stack_size = LWP_GetThreadStackSize(thread);
  material.system_time[3] = __SYS_GetSystemTime();
  material.retrace_counts[0] = VIDEO_GetRetraceCount();

  const int result = mbedtls_sha256((const unsigned char *)&material,
                                    sizeof(material), seed, 0);
  clear_bytes(&material, sizeof(material));
  if (result != 0) {
    clear_bytes(seed, TLS_ENTROPY_SEED_SIZE);
    return false;
  }
  SYS_Report("REFERENCE GX: TLS local entropy collected bytes=%u\n",
             TLS_ENTROPY_SEED_SIZE);
  return true;
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

  uint8_t boot_seed[TLS_ENTROPY_SEED_SIZE];
  if (!collect_local_entropy(boot_seed)) {
    clear_bytes(boot_seed, sizeof(boot_seed));
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS local entropy collection failed";
    SYS_Report("REFERENCE GX: TLS local entropy collection failed\n");
    return false;
  }

  mbedtls_ctr_drbg_init(&tls_random);
  mbedtls_ctr_drbg_set_entropy_len(&tls_random, TLS_ENTROPY_SEED_SIZE);
  static const unsigned char personalization[] =
      "Multiplex native TLS local entropy v1";
  int result = mbedtls_ctr_drbg_set_nonce_len(&tls_random, 0u);
  if (result == 0) {
    memcpy(tls_boot_seed_entropy.seed, boot_seed, sizeof(boot_seed));
    tls_boot_seed_entropy.calls = 0u;
    tls_boot_seed_entropy.available = true;
    result = mbedtls_ctr_drbg_seed(&tls_random, boot_seed_entropy,
                                   &tls_boot_seed_entropy, personalization,
                                   sizeof(personalization) - 1u);
  }
  clear_bytes(boot_seed, sizeof(boot_seed));
  if (result != 0 || tls_boot_seed_entropy.calls != 1u ||
      tls_boot_seed_entropy.available) {
    clear_bytes(tls_boot_seed_entropy.seed, sizeof(tls_boot_seed_entropy.seed));
    tls_boot_seed_entropy.available = false;
    mbedtls_ctr_drbg_free(&tls_random);
    tls_last_error = result != 0 ? result : MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS secure random initialization failed";
    SYS_Report("REFERENCE GX: TLS DRBG initialization failed error=-%04x\n",
               (unsigned)-tls_last_error);
    return false;
  }
  mbedtls_ctr_drbg_set_reseed_interval(&tls_random, INT_MAX);
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
  SYS_Report("REFERENCE GX: TLS random source ready from local "
             "entropy-calls=%u bytes=%u\n",
             tls_boot_seed_entropy.calls, TLS_ENTROPY_SEED_SIZE);
  return true;
}

static bool tls_cancelled(const MultiplexTlsClient *client) {
  return client != NULL &&
         multiplex_http_cancellation_requested(&client->cancellation);
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
  if (tls_cancelled(client)) {
    return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
  }
  /*
   * libogc2's writable select event can remain cleared after a small record
   * even though the TCP send buffer has ample space. net_write synchronously
   * queues or rejects the copy, so probing select first can only strand the
   * next TLS record.
   */
  const int result = net_write(client->socket, bytes, size);
  const int flush_result =
      result > 0 ? flush_network_socket(client->socket) : 0;
  if (flush_result < 0) {
    return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
  }
  return result < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : result;
}

static int tls_receive(void *context, unsigned char *bytes, size_t size) {
  MultiplexTlsClient *client = context;
  const int ready = multiplex_tls_wait_readable(
      client->socket, client->io_timeout_seconds, &client->cancellation);
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

static void free_ca_candidates(mbedtls_x509_crt *candidates) {
  if (candidates == NULL) {
    return;
  }
  mbedtls_x509_crt_free(candidates);
  free(candidates);
}

static int find_ca_candidates(void *context, const mbedtls_x509_crt *child,
                              mbedtls_x509_crt **candidate_cas) {
  MultiplexTlsClient *client = context;
  *candidate_cas = NULL;

  const size_t end_marker_size = sizeof(tls_certificate_end) - 1u;
  size_t largest_pem_size = 0;
  unsigned scanned = 0;
  const char *cursor = multiplex_tls_ca_pem;
  while ((cursor = strstr(cursor, tls_certificate_begin)) != NULL) {
    if (tls_cancelled(client)) {
      return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    }
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
    if (tls_cancelled(client)) {
      free(pem);
      free_ca_candidates(*candidate_cas);
      *candidate_cas = NULL;
      return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    }
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

    if (multiplex_x509_name_equal(&candidate->subject, &child->issuer)) {
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

bool multiplex_tls_client_prepare(void) {
  if (tls_initialization_mutex_ready) {
    return true;
  }
  if (LWP_MutexInit(&tls_initialization_mutex, false) != 0) {
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS initialization lock unavailable";
    SYS_Report("REFERENCE GX: TLS initialization mutex unavailable\n");
    return false;
  }
  tls_initialization_mutex_ready = true;
  return true;
}

static bool initialize_tls_client_locked(void) {
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

bool multiplex_tls_client_initialize(void) {
  if (!tls_initialization_mutex_ready) {
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS initialization lock unavailable";
    return false;
  }
  if (LWP_MutexLock(tls_initialization_mutex) != 0) {
    tls_last_error = MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    tls_failure_message = "TLS initialization lock failed";
    return false;
  }
  const bool initialized = initialize_tls_client_locked();
  LWP_MutexUnlock(tls_initialization_mutex);
  return initialized;
}

MultiplexTlsClient *multiplex_tls_client_connect_cancellable(
    int socket, const char *hostname,
    const MultiplexHttpCancellation *cancellation) {
  tls_last_error = 0;
  tls_last_verify_flags = 0;
  if (socket < 0 || hostname == NULL || hostname[0] == '\0' ||
      multiplex_http_cancellation_requested(cancellation)) {
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
  if (cancellation != NULL) {
    client->cancellation = *cancellation;
  }
  mbedtls_ssl_init(&client->ssl);
  mbedtls_ssl_config_init(&client->config);
  int result = multiplex_tls_client_configure(&client->ssl, &client->config,
                                              hostname, find_ca_candidates,
                                              client, locked_tls_random, NULL);
  if (result == 0) {
    uint32_t verify_flags = 0;
    mbedtls_ssl_set_bio(&client->ssl, client, tls_send, tls_receive, NULL);
    result =
        multiplex_tls_client_handshake_and_verify(&client->ssl, &verify_flags);
    tls_last_verify_flags = verify_flags;
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

MultiplexTlsClient *multiplex_tls_client_connect(int socket,
                                                 const char *hostname) {
  return multiplex_tls_client_connect_cancellable(socket, hostname, NULL);
}

bool multiplex_tls_client_write_all_cancellable(
    MultiplexTlsClient *client, const uint8_t *bytes, size_t size,
    const MultiplexHttpCancellation *cancellation) {
  if (client == NULL || (size != 0 && bytes == NULL)) {
    return false;
  }
  if (cancellation != NULL) {
    client->cancellation = *cancellation;
  }
  size_t written = 0;
  while (written < size) {
    if (tls_cancelled(client)) {
      return false;
    }
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

bool multiplex_tls_client_write_all(MultiplexTlsClient *client,
                                    const uint8_t *bytes, size_t size) {
  return multiplex_tls_client_write_all_cancellable(client, bytes, size, NULL);
}

int multiplex_tls_client_read_cancellable(
    MultiplexTlsClient *client, uint8_t *destination, size_t size,
    unsigned timeout_seconds, const MultiplexHttpCancellation *cancellation) {
  if (client == NULL || destination == NULL || size == 0) {
    return -1;
  }
  if (cancellation != NULL) {
    client->cancellation = *cancellation;
  }
  if (tls_cancelled(client)) {
    return -ECANCELED;
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

int multiplex_tls_client_read(MultiplexTlsClient *client, uint8_t *destination,
                              size_t size, unsigned timeout_seconds) {
  return multiplex_tls_client_read_cancellable(client, destination, size,
                                               timeout_seconds, NULL);
}

void multiplex_tls_client_destroy(MultiplexTlsClient *client) {
  if (client == NULL) {
    return;
  }
  mbedtls_ssl_free(&client->ssl);
  mbedtls_ssl_config_free(&client->config);
  free(client);
}
