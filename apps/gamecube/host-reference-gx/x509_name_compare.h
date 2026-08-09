#ifndef MULTIPLEX_X509_NAME_COMPARE_H
#define MULTIPLEX_X509_NAME_COMPARE_H

#include <mbedtls/x509.h>

#include <stdbool.h>

bool multiplex_x509_name_equal(const mbedtls_x509_name *left,
                               const mbedtls_x509_name *right);

#endif
