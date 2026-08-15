#include "tls_read_poll.h"

#include <errno.h>
#include <network.h>

#define TLS_READ_POLLS_PER_SECOND                                              \
  (1000000u / MULTIPLEX_TLS_READ_CANCEL_BOUND_US)

int multiplex_tls_wait_readable(int socket, unsigned timeout_seconds,
                                const MultiplexHttpCancellation *cancellation) {
  const unsigned poll_limit =
      timeout_seconds == 0 ? 1u : timeout_seconds * TLS_READ_POLLS_PER_SECOND;
  for (unsigned poll = 0; poll < poll_limit; ++poll) {
    if (multiplex_http_cancellation_requested(cancellation)) {
      return -ECANCELED;
    }
    fd_set readable;
    FD_ZERO(&readable);
    FD_SET(socket, &readable);
    struct timeval timeout = {
        .tv_sec = 0,
        .tv_usec =
            timeout_seconds == 0 ? 0 : MULTIPLEX_TLS_READ_CANCEL_BOUND_US,
    };
    const int selected =
        net_select(socket + 1, &readable, NULL, NULL, &timeout);
    if (selected != 0) {
      return selected;
    }
  }
  return 0;
}
