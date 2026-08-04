#ifndef MULTIPLEX_NETWORK_RESOLVER_H
#define MULTIPLEX_NETWORK_RESOLVER_H

#include <stdbool.h>
#include <stdint.h>

#include <network.h>

typedef enum {
  MULTIPLEX_RESOLVER_INVALID_ARGUMENT = -1,
  MULTIPLEX_RESOLVER_SERVER_REQUIRED = -2,
  MULTIPLEX_RESOLVER_SERVER_INVALID = -3,
  MULTIPLEX_RESOLVER_SOCKET_FAILED = -4,
  MULTIPLEX_RESOLVER_SEND_FAILED = -5,
  MULTIPLEX_RESOLVER_TIMEOUT = -6,
  MULTIPLEX_RESOLVER_RECEIVE_FAILED = -7,
  MULTIPLEX_RESOLVER_RESPONSE_INVALID = -8,
  MULTIPLEX_RESOLVER_SENDER_INVALID = -9,
} MultiplexResolverError;

bool multiplex_resolve_ipv4(const char *host, const char *dns_server,
                            struct in_addr *address);
int32_t multiplex_resolver_last_error(void);
uint32_t multiplex_resolver_attempts(void);

#endif
