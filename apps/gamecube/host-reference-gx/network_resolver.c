#include "network_resolver.h"

#include <gccore.h>
#include <ogc/lwp_watchdog.h>

#include <stdint.h>
#include <string.h>

#define DNS_QUERY_ATTEMPTS 3u
#define DNS_QUERY_TIMEOUT_SECONDS 1
#define DNS_CANCEL_POLL_US 100000u
#define DNS_POLLS_PER_SECOND (1000000u / DNS_CANCEL_POLL_US)
#define DNS_CACHE_HOST_CAPACITY 128u

static char cached_host[DNS_CACHE_HOST_CAPACITY];
static struct in_addr cached_address;
static volatile int32_t resolver_last_error;
static volatile uint32_t resolver_attempt_count;

static bool cache_lookup(const char *host, struct in_addr *address) {
  const uint32_t level = IRQ_Disable();
  const bool found =
      strcmp(host, cached_host) == 0 && cached_address.s_addr != 0;
  if (found) {
    *address = cached_address;
  }
  IRQ_Restore(level);
  return found;
}

static void cache_store(const char *host, size_t host_size,
                        const struct in_addr *address) {
  const uint32_t level = IRQ_Disable();
  cached_address = *address;
  memcpy(cached_host, host, host_size + 1u);
  IRQ_Restore(level);
}

int32_t multiplex_resolver_last_error(void) { return resolver_last_error; }

uint32_t multiplex_resolver_attempts(void) { return resolver_attempt_count; }

#if !defined(HW_RVL)
static uint16_t read_u16(const uint8_t *bytes) {
  return (uint16_t)(((uint16_t)bytes[0] << 8u) | bytes[1]);
}

static size_t skip_dns_name(const uint8_t *response, size_t size,
                            size_t offset) {
  while (offset < size) {
    const uint8_t length = response[offset++];
    if (length == 0) {
      return offset;
    }
    if ((length & 0xc0u) == 0xc0u) {
      return offset < size ? offset + 1u : 0u;
    }
    if ((length & 0xc0u) != 0 || length > 63u || offset + length > size) {
      return 0;
    }
    offset += length;
  }
  return 0;
}
#endif

bool multiplex_resolve_ipv4_cancellable(
    const char *host, const char *dns_server, struct in_addr *address,
    const MultiplexHttpCancellation *cancellation) {
  resolver_attempt_count = 0;
  resolver_last_error = 0;
  if (host == NULL || host[0] == '\0' || address == NULL ||
      multiplex_http_cancellation_requested(cancellation)) {
    resolver_last_error = MULTIPLEX_RESOLVER_INVALID_ARGUMENT;
    return false;
  }
  if (inet_aton(host, address) != 0) {
    return true;
  }
  const size_t host_size = strlen(host);
  if (host_size >= sizeof(cached_host)) {
    resolver_last_error = MULTIPLEX_RESOLVER_INVALID_ARGUMENT;
    return false;
  }
  if (cache_lookup(host, address)) {
    return true;
  }
#if defined(HW_RVL)
  (void)dns_server;
  resolver_attempt_count = 1;
  const struct hostent *resolved_host = net_gethostbyname(host);
  if (multiplex_http_cancellation_requested(cancellation)) {
    resolver_last_error = MULTIPLEX_RESOLVER_TIMEOUT;
    return false;
  }
  if (resolved_host == NULL || resolved_host->h_addrtype != AF_INET ||
      resolved_host->h_length != sizeof(address->s_addr) ||
      resolved_host->h_addr_list == NULL ||
      resolved_host->h_addr_list[0] == NULL) {
    resolver_last_error = MULTIPLEX_RESOLVER_RESPONSE_INVALID;
    return false;
  }
  memcpy(&address->s_addr, resolved_host->h_addr_list[0],
         sizeof(address->s_addr));
  const bool resolved = true;
#else
  if (dns_server == NULL || dns_server[0] == '\0') {
    resolver_last_error = MULTIPLEX_RESOLVER_SERVER_REQUIRED;
    return false;
  }
  struct sockaddr_in dns;
  memset(&dns, 0, sizeof(dns));
  dns.sin_family = AF_INET;
  dns.sin_len = sizeof(dns);
  dns.sin_port = htons(53u);
  if (inet_aton(dns_server, &dns.sin_addr) == 0) {
    resolver_last_error = MULTIPLEX_RESOLVER_SERVER_INVALID;
    return false;
  }

  uint8_t query[512];
  uint8_t response[512];
  memset(query, 0, sizeof(query));
  query[2] = 0x01u;
  query[5] = 0x01u;
  size_t used = 12u;
  const char *label = host;
  while (*label != '\0') {
    const char *dot = strchr(label, '.');
    const size_t length = dot == NULL ? strlen(label) : (size_t)(dot - label);
    if (length == 0 || length > 63u || used + length + 1u >= sizeof(query)) {
      resolver_last_error = MULTIPLEX_RESOLVER_INVALID_ARGUMENT;
      return false;
    }
    query[used++] = (uint8_t)length;
    memcpy(query + used, label, length);
    used += length;
    if (dot == NULL) {
      break;
    }
    label = dot + 1u;
  }
  if (used + 5u > sizeof(query)) {
    resolver_last_error = MULTIPLEX_RESOLVER_INVALID_ARGUMENT;
    return false;
  }
  query[used++] = 0;
  query[used++] = 0;
  query[used++] = 1;
  query[used++] = 0;
  query[used++] = 1;

  const int socket = net_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (socket < 0) {
    resolver_last_error = MULTIPLEX_RESOLVER_SOCKET_FAILED;
    return false;
  }
  bool resolved = false;
  for (uint32_t attempt = 1; attempt <= DNS_QUERY_ATTEMPTS && !resolved;
       ++attempt) {
    if (multiplex_http_cancellation_requested(cancellation)) {
      resolver_last_error = MULTIPLEX_RESOLVER_TIMEOUT;
      break;
    }
    resolver_attempt_count = attempt;
    const uint16_t transaction =
        (uint16_t)((uint32_t)gettime() ^ (uint32_t)(uintptr_t)query ^
                   (attempt * UINT32_C(0x9e37)));
    query[0] = (uint8_t)(transaction >> 8u);
    query[1] = (uint8_t)transaction;
    if (net_sendto(socket, query, used, 0, (struct sockaddr *)&dns,
                   sizeof(dns)) != (int)used) {
      resolver_last_error = MULTIPLEX_RESOLVER_SEND_FAILED;
      continue;
    }
    int selected = 0;
    for (unsigned poll = 0;
         poll < DNS_QUERY_TIMEOUT_SECONDS * DNS_POLLS_PER_SECOND; ++poll) {
      if (multiplex_http_cancellation_requested(cancellation)) {
        selected = -1;
        resolver_last_error = MULTIPLEX_RESOLVER_TIMEOUT;
        break;
      }
      fd_set readable;
      FD_ZERO(&readable);
      FD_SET(socket, &readable);
      struct timeval timeout = {
          .tv_sec = 0,
          .tv_usec = DNS_CANCEL_POLL_US,
      };
      selected = net_select(socket + 1, &readable, NULL, NULL, &timeout);
      if (selected != 0) {
        break;
      }
    }
    if (selected <= 0) {
      resolver_last_error = selected == 0 ? MULTIPLEX_RESOLVER_TIMEOUT
                                          : MULTIPLEX_RESOLVER_RECEIVE_FAILED;
      continue;
    }
    struct sockaddr_in sender;
    socklen_t sender_size = sizeof(sender);
    const int received = net_recvfrom(socket, response, sizeof(response), 0,
                                      (struct sockaddr *)&sender, &sender_size);
    if (received < 12) {
      resolver_last_error = MULTIPLEX_RESOLVER_RECEIVE_FAILED;
      continue;
    }
    if (sender.sin_addr.s_addr != dns.sin_addr.s_addr ||
        sender.sin_port != dns.sin_port) {
      resolver_last_error = MULTIPLEX_RESOLVER_SENDER_INVALID;
      continue;
    }
    if (read_u16(response) != transaction || (response[2] & 0x80u) == 0 ||
        (response[3] & 0x0fu) != 0) {
      resolver_last_error = MULTIPLEX_RESOLVER_RESPONSE_INVALID;
      continue;
    }
    const size_t size = (size_t)received;
    const uint16_t questions = read_u16(response + 4u);
    const uint16_t answers = read_u16(response + 6u);
    size_t offset = 12u;
    for (uint16_t index = 0; index < questions && offset != 0; ++index) {
      offset = skip_dns_name(response, size, offset);
      offset = offset != 0 && offset + 4u <= size ? offset + 4u : 0u;
    }
    for (uint16_t index = 0; index < answers && offset != 0 && !resolved;
         ++index) {
      offset = skip_dns_name(response, size, offset);
      if (offset == 0 || offset + 10u > size) {
        break;
      }
      const uint16_t type = read_u16(response + offset);
      const uint16_t record_class = read_u16(response + offset + 2u);
      const uint16_t data_size = read_u16(response + offset + 8u);
      offset += 10u;
      if (offset + data_size > size) {
        break;
      }
      if (type == 1u && record_class == 1u &&
          data_size == sizeof(address->s_addr)) {
        memcpy(&address->s_addr, response + offset, sizeof(address->s_addr));
        resolved = true;
      }
      offset += data_size;
    }
    resolver_last_error = resolved ? 0 : MULTIPLEX_RESOLVER_RESPONSE_INVALID;
    if (!resolved) {
      continue;
    }
  }
  net_close(socket);
#endif
  if (resolved) {
    cache_store(host, host_size, address);
    char resolved_address[16];
    inet_ntoa_r(*address, resolved_address, sizeof(resolved_address));
    SYS_Report("REFERENCE GX: DNS host=%s address=%s\n", host,
               resolved_address);
  }
  return resolved;
}

bool multiplex_resolve_ipv4(const char *host, const char *dns_server,
                            struct in_addr *address) {
  return multiplex_resolve_ipv4_cancellable(host, dns_server, address, NULL);
}
