#include "x509_name_compare.h"

#include <assert.h>
#include <stdio.h>

static unsigned char common_name_oid[] = {0x55, 0x04, 0x03};

static mbedtls_x509_name name_attribute(int tag, unsigned char *value,
                                        size_t value_size) {
  return (mbedtls_x509_name){
      .oid = {.tag = MBEDTLS_ASN1_OID,
              .len = sizeof(common_name_oid),
              .p = common_name_oid},
      .val = {.tag = tag, .len = value_size, .p = value},
      .next = NULL,
  };
}

static void test_matches_mbed_tls_string_variants(void) {
  static unsigned char printable_value[] = "Plex CA";
  static unsigned char utf8_value[] = "plex ca";
  mbedtls_x509_name printable =
      name_attribute(MBEDTLS_ASN1_PRINTABLE_STRING, printable_value,
                     sizeof(printable_value) - 1u);
  mbedtls_x509_name utf8 = name_attribute(MBEDTLS_ASN1_UTF8_STRING, utf8_value,
                                          sizeof(utf8_value) - 1u);

  assert(multiplex_x509_name_equal(&printable, &utf8));
}

static void test_rejects_other_casefolding(void) {
  static unsigned char upper_value[] = "PLEX";
  static unsigned char lower_value[] = "plex";
  mbedtls_x509_name upper = name_attribute(MBEDTLS_ASN1_IA5_STRING, upper_value,
                                           sizeof(upper_value) - 1u);
  mbedtls_x509_name lower = name_attribute(MBEDTLS_ASN1_IA5_STRING, lower_value,
                                           sizeof(lower_value) - 1u);

  assert(!multiplex_x509_name_equal(&upper, &lower));
}

static void test_rejects_different_names(void) {
  static unsigned char organizational_unit_oid[] = {0x55, 0x04, 0x0b};
  static unsigned char left_value[] = "Plex CA";
  static unsigned char right_value[] = "Other CA";
  mbedtls_x509_name left = name_attribute(MBEDTLS_ASN1_PRINTABLE_STRING,
                                          left_value, sizeof(left_value) - 1u);
  mbedtls_x509_name right = name_attribute(
      MBEDTLS_ASN1_PRINTABLE_STRING, right_value, sizeof(right_value) - 1u);

  assert(!multiplex_x509_name_equal(&left, &right));
  right.val = left.val;
  right.oid.p = organizational_unit_oid;
  assert(!multiplex_x509_name_equal(&left, &right));
}

static void test_matches_more_than_32_attributes(void) {
  enum { attribute_count = 33 };
  static unsigned char value[] = "A";
  static unsigned char different_value[] = "B";
  mbedtls_x509_name left[attribute_count];
  mbedtls_x509_name right[attribute_count];

  for (size_t index = 0; index < attribute_count; ++index) {
    left[index] = name_attribute(MBEDTLS_ASN1_PRINTABLE_STRING, value,
                                 sizeof(value) - 1u);
    right[index] =
        name_attribute(MBEDTLS_ASN1_UTF8_STRING, value, sizeof(value) - 1u);
    if (index + 1u < attribute_count) {
      left[index].next = &left[index + 1u];
      right[index].next = &right[index + 1u];
    }
  }

  assert(multiplex_x509_name_equal(left, right));
  right[32].val.p = different_value;
  assert(!multiplex_x509_name_equal(left, right));
}

int main(void) {
  test_matches_mbed_tls_string_variants();
  test_rejects_other_casefolding();
  test_rejects_different_names();
  test_matches_more_than_32_attributes();
  puts("GameCube X.509 Name comparison tests passed.");
  return 0;
}
