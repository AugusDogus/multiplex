#ifndef MULTIPLEX_HTTP_CANCELLATION_H
#define MULTIPLEX_HTTP_CANCELLATION_H

#include <stdbool.h>
#include <stddef.h>

typedef bool (*MultiplexHttpCancelledFn)(void *context);

typedef struct {
  MultiplexHttpCancelledFn is_cancelled;
  void *context;
} MultiplexHttpCancellation;

static inline bool multiplex_http_cancellation_requested(
    const MultiplexHttpCancellation *cancellation) {
  return cancellation != NULL && cancellation->is_cancelled != NULL &&
         cancellation->is_cancelled(cancellation->context);
}

#endif
