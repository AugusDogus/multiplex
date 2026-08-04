#ifndef MULTIPLEX_MBEDTLS_GAMECUBE_CONFIG_H
#define MULTIPLEX_MBEDTLS_GAMECUBE_CONFIG_H

/*
 * Start from Mbed TLS' supported default profile, then remove host-only and
 * server features that a GameCube HTTPS client cannot use. Entropy is supplied
 * by the application before CTR-DRBG initialization.
 */
#include "mbedtls/mbedtls_config.h"

#define MBEDTLS_NO_PLATFORM_ENTROPY
#define MBEDTLS_PLATFORM_MS_TIME_ALT
#define MBEDTLS_X509_TRUSTED_CERTIFICATE_CALLBACK

#undef MBEDTLS_FS_IO
#undef MBEDTLS_NET_C
#undef MBEDTLS_PSA_CRYPTO_STORAGE_C
#undef MBEDTLS_PSA_ITS_FILE_C
#undef MBEDTLS_SSL_PROTO_DTLS
#undef MBEDTLS_SSL_PROTO_TLS1_3
#undef MBEDTLS_SSL_SRV_C
#undef MBEDTLS_TIMING_C

#endif
