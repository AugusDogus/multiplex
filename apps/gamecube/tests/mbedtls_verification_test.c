#define _POSIX_C_SOURCE 200809L

#include "tls_client_verification.h"

#include <mbedtls/error.h>
#include <mbedtls/platform_time.h>
#include <mbedtls/x509_crt.h>

#include <arpa/inet.h>
#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  unsigned char *data;
  size_t size;
} PemFile;

typedef struct {
  const PemFile *root;
} TrustSource;

typedef struct {
  uint32_t state;
} TestRandom;

mbedtls_ms_time_t mbedtls_ms_time(void) { return (mbedtls_ms_time_t)0; }

static mbedtls_time_t fixed_certificate_time(mbedtls_time_t *timer) {
  const mbedtls_time_t value = (mbedtls_time_t)1767225600;
  if (timer != NULL) {
    *timer = value;
  }
  return value;
}

static void print_mbedtls_error(const char *operation, int error) {
  char message[256];
  mbedtls_strerror(error, message, sizeof(message));
  fprintf(stderr, "%s failed: %d (%s)\n", operation, error, message);
}

static int read_pem_file(const char *path, PemFile *file) {
  FILE *stream = fopen(path, "rb");
  if (stream == NULL) {
    fprintf(stderr, "Unable to open PEM file %s: %s\n", path, strerror(errno));
    return -1;
  }

  int result = -1;
  unsigned char *data = NULL;
  if (fseek(stream, 0, SEEK_END) != 0) {
    fprintf(stderr, "Unable to seek PEM file %s: %s\n", path, strerror(errno));
    goto cleanup;
  }
  const long length = ftell(stream);
  if (length < 0 || (uintmax_t)length > (uintmax_t)SIZE_MAX - 1u) {
    fprintf(stderr, "Unable to measure PEM file %s safely.\n", path);
    goto cleanup;
  }
  if (fseek(stream, 0, SEEK_SET) != 0) {
    fprintf(stderr, "Unable to rewind PEM file %s: %s\n", path,
            strerror(errno));
    goto cleanup;
  }

  const size_t expected = (size_t)length;
  data = malloc(expected + 1u);
  if (data == NULL) {
    fprintf(stderr, "Unable to allocate %zu bytes for PEM file %s.\n",
            expected + 1u, path);
    goto cleanup;
  }
  if (fread(data, 1u, expected, stream) != expected) {
    fprintf(stderr, "Unable to read PEM file %s.\n", path);
    goto cleanup;
  }

  data[expected] = '\0';
  file->data = data;
  file->size = expected + 1u;
  data = NULL;
  result = 0;

cleanup:
  free(data);
  if (fclose(stream) != 0 && result == 0) {
    fprintf(stderr, "Unable to close PEM file %s: %s\n", path, strerror(errno));
    free(file->data);
    file->data = NULL;
    file->size = 0;
    result = -1;
  }
  return result;
}

static int provide_trust_root(void *context, const mbedtls_x509_crt *child,
                              mbedtls_x509_crt **candidate_cas) {
  (void)child;
  const TrustSource *trust = context;
  *candidate_cas = NULL;
  if (trust == NULL || trust->root == NULL) {
    return MBEDTLS_ERR_X509_BAD_INPUT_DATA;
  }

  mbedtls_x509_crt *root = calloc(1, sizeof(*root));
  if (root == NULL) {
    return MBEDTLS_ERR_X509_ALLOC_FAILED;
  }
  mbedtls_x509_crt_init(root);
  const int result =
      mbedtls_x509_crt_parse(root, trust->root->data, trust->root->size);
  if (result != 0) {
    mbedtls_x509_crt_free(root);
    free(root);
    return result < 0 ? result : MBEDTLS_ERR_X509_INVALID_FORMAT;
  }
  *candidate_cas = root;
  return 0;
}

static int test_random(void *context, unsigned char *output, size_t size) {
  TestRandom *random = context;
  if (random == NULL || output == NULL) {
    return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
  }
  for (size_t index = 0; index < size; ++index) {
    random->state ^= random->state << 13u;
    random->state ^= random->state >> 17u;
    random->state ^= random->state << 5u;
    output[index] = (unsigned char)random->state;
  }
  return 0;
}

static int connect_to_server(uint16_t port) {
  const struct sockaddr_in address = {
      .sin_family = AF_INET,
      .sin_port = htons(port),
      .sin_addr = {.s_addr = htonl(INADDR_LOOPBACK)},
  };
  const struct timespec retry_delay = {
      .tv_sec = 0,
      .tv_nsec = 10000000,
  };

  for (unsigned attempt = 0; attempt < 200u; ++attempt) {
    const int socket_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (socket_fd < 0) {
      fprintf(stderr, "Unable to create TLS test socket: %s\n",
              strerror(errno));
      return -1;
    }
    if (connect(socket_fd, (const struct sockaddr *)&address,
                sizeof(address)) == 0) {
      const struct timeval io_timeout = {
          .tv_sec = 5,
          .tv_usec = 0,
      };
      if (setsockopt(socket_fd, SOL_SOCKET, SO_RCVTIMEO, &io_timeout,
                     sizeof(io_timeout)) != 0 ||
          setsockopt(socket_fd, SOL_SOCKET, SO_SNDTIMEO, &io_timeout,
                     sizeof(io_timeout)) != 0) {
        fprintf(stderr, "Unable to bound TLS test socket I/O: %s\n",
                strerror(errno));
        close(socket_fd);
        return -1;
      }
      return socket_fd;
    }
    const int connect_error = errno;
    close(socket_fd);
    if (connect_error != ECONNREFUSED && connect_error != EINTR) {
      fprintf(stderr, "Unable to connect to TLS test server: %s\n",
              strerror(connect_error));
      return -1;
    }
    nanosleep(&retry_delay, NULL);
  }
  fprintf(stderr, "TLS test server did not accept connections.\n");
  return -1;
}

static int socket_send(void *context, const unsigned char *bytes, size_t size) {
  const int socket_fd = *(const int *)context;
  const ssize_t result = send(socket_fd, bytes, size, 0);
  return result < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : (int)result;
}

static int socket_receive(void *context, unsigned char *bytes, size_t size) {
  const int socket_fd = *(const int *)context;
  const ssize_t result = recv(socket_fd, bytes, size, 0);
  return result < 0 ? MBEDTLS_ERR_SSL_INTERNAL_ERROR : (int)result;
}

static int parse_port(const char *text, uint16_t *port) {
  char *end = NULL;
  errno = 0;
  const unsigned long value = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value == 0u ||
      value > UINT16_MAX) {
    return -1;
  }
  *port = (uint16_t)value;
  return 0;
}

static int parse_expected_flags(const char *text, uint32_t *flags) {
  if (strcmp(text, "none") == 0) {
    *flags = 0u;
    return 0;
  }
  if (strcmp(text, "hostname") == 0) {
    *flags = MBEDTLS_X509_BADCERT_CN_MISMATCH;
    return 0;
  }
  if (strcmp(text, "trust") == 0) {
    *flags = MBEDTLS_X509_BADCERT_NOT_TRUSTED;
    return 0;
  }
  return -1;
}

int main(int argc, char **argv) {
  if (argc != 5) {
    fprintf(stderr, "Usage: %s PORT TRUST_ROOT_PEM HOSTNAME EXPECTATION\n",
            argv[0]);
    return EXIT_FAILURE;
  }

  uint16_t port = 0;
  uint32_t expected_flags = 0;
  if (parse_port(argv[1], &port) != 0 ||
      parse_expected_flags(argv[4], &expected_flags) != 0) {
    fprintf(stderr, "Invalid port or verification expectation.\n");
    return EXIT_FAILURE;
  }
  if (mbedtls_platform_set_time(fixed_certificate_time) != 0) {
    fprintf(stderr, "Unable to set the deterministic certificate time.\n");
    return EXIT_FAILURE;
  }
  if (multiplex_tls_client_accept_handshake(0,
                                            MBEDTLS_X509_BADCERT_CN_MISMATCH) !=
      MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) {
    fprintf(stderr, "TLS client accepted nonzero verification flags.\n");
    return EXIT_FAILURE;
  }

  PemFile root_file = {0};
  if (read_pem_file(argv[2], &root_file) != 0) {
    return EXIT_FAILURE;
  }
  TrustSource trust = {.root = &root_file};
  TestRandom random = {.state = UINT32_C(0x6d756c74)};
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config config;
  mbedtls_ssl_init(&ssl);
  mbedtls_ssl_config_init(&config);

  int socket_fd = -1;
  int result = multiplex_tls_client_configure(
      &ssl, &config, argv[3], provide_trust_root, &trust, test_random, &random);
  uint32_t actual_flags = 0;
  if (result == 0) {
    socket_fd = connect_to_server(port);
    if (socket_fd < 0) {
      result = MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    } else {
      mbedtls_ssl_set_bio(&ssl, &socket_fd, socket_send, socket_receive, NULL);
      result = multiplex_tls_client_handshake_and_verify(&ssl, &actual_flags);
    }
  }

  int test_result = EXIT_FAILURE;
  if (expected_flags == 0u) {
    if (result == 0 && actual_flags == 0u) {
      test_result = EXIT_SUCCESS;
    }
  } else if (result == MBEDTLS_ERR_X509_CERT_VERIFY_FAILED &&
             actual_flags == expected_flags) {
    test_result = EXIT_SUCCESS;
  }

  if (test_result != EXIT_SUCCESS) {
    fprintf(stderr,
            "Expected handshake result %d with flags 0x%08" PRIx32
            ", got %d with flags 0x%08" PRIx32 ".\n",
            expected_flags == 0u ? 0 : MBEDTLS_ERR_X509_CERT_VERIFY_FAILED,
            expected_flags, result, actual_flags);
    if (result != 0) {
      print_mbedtls_error("TLS handshake", result);
    }
  } else {
    printf("TLS handshake result %d with exact flags 0x%08" PRIx32 ".\n",
           result, actual_flags);
  }

  if (socket_fd >= 0) {
    close(socket_fd);
  }
  mbedtls_ssl_free(&ssl);
  mbedtls_ssl_config_free(&config);
  free(root_file.data);
  return test_result;
}
