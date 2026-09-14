#include "http_client.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint8_t *bytes;
  size_t capacity;
  size_t size;
} Writer;

static bool write_bytes(void *context, const uint8_t *bytes, size_t size) {
  Writer *writer = context;
  if (size > writer->capacity - writer->size) {
    return false;
  }
  memcpy(writer->bytes + writer->size, bytes, size);
  writer->size += size;
  return true;
}

int main(int argc, char **argv) {
  assert(argc == 2);
  uint8_t body[64];
  size_t size = 0;
  DreamcastHttpResponse response;
  char body_url[1024];
  const int body_url_size =
      snprintf(body_url, sizeof(body_url), "%s/body.bin", argv[1]);
  assert(body_url_size > 0 && (size_t)body_url_size < sizeof(body_url));
  assert(dreamcast_http_get_buffer(body_url, body, sizeof(body), &size,
                                   &response));
  assert(response.status == 200);
  static const char expected[] = "multiplex-dreamcast-http";
  assert(size == sizeof(expected) - 1u);
  assert(memcmp(body, expected, size) == 0);

  enum { RANGE_BODY_SIZE = 32768, RANGE_SIZE = 4096 };
  uint8_t *range_body = malloc(RANGE_BODY_SIZE);
  assert(range_body != NULL);
  Writer writer = {
      .bytes = range_body,
      .capacity = RANGE_BODY_SIZE,
      .size = 0,
  };
  char ranges_url[1024];
  const int ranges_url_size =
      snprintf(ranges_url, sizeof(ranges_url), "%s/ranges.bin", argv[1]);
  assert(ranges_url_size > 0 &&
         (size_t)ranges_url_size < sizeof(ranges_url));
  assert(dreamcast_http_get_ranges(ranges_url, RANGE_BODY_SIZE, RANGE_SIZE,
                                   write_bytes, &writer));
  assert(writer.size == RANGE_BODY_SIZE);
  for (size_t index = 0; index < writer.size; ++index) {
    assert(writer.bytes[index] == (uint8_t)(index % 251u));
  }
  free(range_body);
  puts("Dreamcast HTTP client integration test passed.");
  return 0;
}
