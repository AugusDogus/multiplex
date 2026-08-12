#include "x509_name_compare.h"

#include <mbedtls/asn1.h>

#include <stddef.h>
#include <string.h>

static bool ascii_case_equal(const unsigned char *left,
                             const unsigned char *right, size_t size) {
  for (size_t index = 0; index < size; ++index) {
    const unsigned char difference = left[index] ^ right[index];
    if (difference == 0) {
      continue;
    }
    if (difference != 32u || !((left[index] >= 'a' && left[index] <= 'z') ||
                               (left[index] >= 'A' && left[index] <= 'Z'))) {
      return false;
    }
  }
  return true;
}

static bool x509_string_equal(const mbedtls_x509_buf *left,
                              const mbedtls_x509_buf *right) {
  if (left->tag == right->tag && left->len == right->len &&
      memcmp(left->p, right->p, right->len) == 0) {
    return true;
  }

  const bool left_is_casefolded = left->tag == MBEDTLS_ASN1_UTF8_STRING ||
                                  left->tag == MBEDTLS_ASN1_PRINTABLE_STRING;
  const bool right_is_casefolded = right->tag == MBEDTLS_ASN1_UTF8_STRING ||
                                   right->tag == MBEDTLS_ASN1_PRINTABLE_STRING;
  return left_is_casefolded && right_is_casefolded && left->len == right->len &&
         ascii_case_equal(left->p, right->p, right->len);
}

static bool continues_relative_name(const mbedtls_x509_name *name) {
  /* Mbed TLS 3.6.4's read-only public helper lacks a const parameter. */
  return mbedtls_x509_dn_get_next((mbedtls_x509_name *)name) != name->next;
}

bool multiplex_x509_name_equal(const mbedtls_x509_name *left,
                               const mbedtls_x509_name *right) {
  while (left != NULL || right != NULL) {
    if (left == NULL || right == NULL || left->oid.tag != right->oid.tag ||
        left->oid.len != right->oid.len ||
        memcmp(left->oid.p, right->oid.p, right->oid.len) != 0 ||
        !x509_string_equal(&left->val, &right->val) ||
        continues_relative_name(left) != continues_relative_name(right)) {
      return false;
    }
    left = left->next;
    right = right->next;
  }
  return true;
}
