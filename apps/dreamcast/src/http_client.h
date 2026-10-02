#ifndef MULTIPLEX_DREAMCAST_HTTP_CLIENT_H
#define MULTIPLEX_DREAMCAST_HTTP_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef bool (*DreamcastHttpWrite)(void *context, const uint8_t *bytes,
                                   size_t size);

typedef struct {
  unsigned status;
  size_t content_length;
} DreamcastHttpResponse;

bool dreamcast_http_get(const char *url, DreamcastHttpWrite write,
                        void *context, DreamcastHttpResponse *response);
bool dreamcast_http_get_range(const char *url, size_t offset, size_t size,
                              DreamcastHttpWrite write, void *context,
                              DreamcastHttpResponse *response);
bool dreamcast_http_get_ranges(const char *url, size_t total_size,
                               size_t range_size, DreamcastHttpWrite write,
                               void *context);
bool dreamcast_http_get_buffer(const char *url, uint8_t *destination,
                               size_t capacity, size_t *size,
                               DreamcastHttpResponse *response);

#endif
