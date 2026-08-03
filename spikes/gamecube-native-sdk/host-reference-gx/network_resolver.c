#include "network_resolver.h"

#include <gccore.h>
#include <ogc/lwp_watchdog.h>

#include <stdint.h>
#include <string.h>

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

bool multiplex_resolve_ipv4(const char *host, const char *dns_server,
                            struct in_addr *address) {
  if (host == NULL || host[0] == '\0' || address == NULL) {
    return false;
  }
  if (inet_aton(host, address) != 0) {
    return true;
  }
#if defined(HW_RVL)
  const struct hostent *resolved_host = net_gethostbyname(host);
  if (resolved_host == NULL || resolved_host->h_addrtype != AF_INET ||
      resolved_host->h_length != sizeof(address->s_addr) ||
      resolved_host->h_addr_list == NULL ||
      resolved_host->h_addr_list[0] == NULL) {
    return false;
  }
  memcpy(&address->s_addr, resolved_host->h_addr_list[0],
         sizeof(address->s_addr));
  const bool resolved = true;
#else
  if (dns_server == NULL || dns_server[0] == '\0') {
    return false;
  }
  struct sockaddr_in dns;
  memset(&dns, 0, sizeof(dns));
  dns.sin_family = AF_INET;
  dns.sin_len = sizeof(dns);
  dns.sin_port = htons(53u);
  if (inet_aton(dns_server, &dns.sin_addr) == 0) {
    return false;
  }

  uint8_t query[512];
  memset(query, 0, sizeof(query));
  const uint16_t transaction =
      (uint16_t)((uint32_t)gettime() ^ (uint32_t)(uintptr_t)query);
  query[0] = (uint8_t)(transaction >> 8u);
  query[1] = (uint8_t)transaction;
  query[2] = 0x01u;
  query[5] = 0x01u;
  size_t used = 12u;
  const char *label = host;
  while (*label != '\0') {
    const char *dot = strchr(label, '.');
    const size_t length = dot == NULL ? strlen(label) : (size_t)(dot - label);
    if (length == 0 || length > 63u || used + length + 1u >= sizeof(query)) {
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
    return false;
  }
  query[used++] = 0;
  query[used++] = 0;
  query[used++] = 1;
  query[used++] = 0;
  query[used++] = 1;

  const int socket = net_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (socket < 0) {
    return false;
  }
  bool resolved = false;
  if (net_sendto(socket, query, used, 0, (struct sockaddr *)&dns,
                 sizeof(dns)) == (int)used) {
    fd_set readable;
    FD_ZERO(&readable);
    FD_SET(socket, &readable);
    struct timeval timeout = {.tv_sec = 5, .tv_usec = 0};
    if (net_select(socket + 1, &readable, NULL, NULL, &timeout) > 0) {
      struct sockaddr_in sender;
      socklen_t sender_size = sizeof(sender);
      const int received =
          net_recvfrom(socket, query, sizeof(query), 0,
                       (struct sockaddr *)&sender, &sender_size);
      if (received >= 12 && read_u16(query) == transaction &&
          (query[2] & 0x80u) != 0 && (query[3] & 0x0fu) == 0) {
        const size_t size = (size_t)received;
        const uint16_t questions = read_u16(query + 4u);
        const uint16_t answers = read_u16(query + 6u);
        size_t offset = 12u;
        for (uint16_t index = 0; index < questions && offset != 0; ++index) {
          offset = skip_dns_name(query, size, offset);
          offset = offset != 0 && offset + 4u <= size ? offset + 4u : 0u;
        }
        for (uint16_t index = 0; index < answers && offset != 0 && !resolved;
             ++index) {
          offset = skip_dns_name(query, size, offset);
          if (offset == 0 || offset + 10u > size) {
            break;
          }
          const uint16_t type = read_u16(query + offset);
          const uint16_t record_class = read_u16(query + offset + 2u);
          const uint16_t data_size = read_u16(query + offset + 8u);
          offset += 10u;
          if (offset + data_size > size) {
            break;
          }
          if (type == 1u && record_class == 1u &&
              data_size == sizeof(address->s_addr)) {
            memcpy(&address->s_addr, query + offset, sizeof(address->s_addr));
            resolved = true;
          }
          offset += data_size;
        }
      }
    }
  }
  net_close(socket);
#endif
  if (resolved) {
    char resolved_address[16];
    inet_ntoa_r(*address, resolved_address, sizeof(resolved_address));
    SYS_Report("REFERENCE GX: DNS host=%s address=%s\n", host,
               resolved_address);
  }
  return resolved;
}
