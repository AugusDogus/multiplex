#ifndef MULTIPLEX_TLS_READ_POLL_H
#define MULTIPLEX_TLS_READ_POLL_H

#include "http_cancellation.h"

#define MULTIPLEX_TLS_READ_CANCEL_BOUND_US 100000u

int multiplex_tls_wait_readable(int socket, unsigned timeout_seconds,
                                const MultiplexHttpCancellation *cancellation);

#endif
