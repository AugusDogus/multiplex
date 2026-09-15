#ifndef MULTIPLEX_XBOX_HTTP_H
#define MULTIPLEX_XBOX_HTTP_H

#include <stdbool.h>
#include <stddef.h>

typedef bool (*MultiplexXboxHttpRequest)(void *context, const char *method,
                                         const char *url,
                                         const char *bearer_token,
                                         const char *body, char *response_body,
                                         size_t response_capacity,
                                         unsigned *status);

bool multiplex_xbox_http_request_json(void *context, const char *method,
                                      const char *url, const char *bearer_token,
                                      const char *body, char *response_body,
                                      size_t response_capacity,
                                      unsigned *status);

#endif
