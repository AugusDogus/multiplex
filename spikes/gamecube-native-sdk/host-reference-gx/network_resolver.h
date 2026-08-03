#ifndef MULTIPLEX_NETWORK_RESOLVER_H
#define MULTIPLEX_NETWORK_RESOLVER_H

#include <stdbool.h>

#include <network.h>

bool multiplex_resolve_ipv4(const char *host, const char *dns_server,
                            struct in_addr *address);

#endif
