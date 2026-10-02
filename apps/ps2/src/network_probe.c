#include "network_probe_config.h"

#include <arpa/inet.h>
#include <debug.h>
#include <iopcontrol.h>
#include <iopheap.h>
#include <kernel.h>
#include <loadfile.h>
#include <netinet/in.h>
#include <netman.h>
#include <ps2ip.h>
#include <sbv_patches.h>
#include <sifrpc.h>
#include <sys/socket.h>

#include <stdio.h>
#include <string.h>
#include <unistd.h>

extern unsigned char DEV9_irx[];
extern unsigned int size_DEV9_irx;
extern unsigned char NETMAN_irx[];
extern unsigned int size_NETMAN_irx;
extern unsigned char SMAP_irx[];
extern unsigned int size_SMAP_irx;

enum {
  NETWORK_WAIT_ATTEMPTS = 20,
  RESPONSE_CAPACITY = 4096,
};

static int load_module(const char *name, const unsigned char *bytes,
                       unsigned int size) {
  int module_result = 0;
  const int module_id =
      SifExecModuleBuffer((void *)bytes, size, 0, NULL, &module_result);
  if (module_id < 0 || module_result < 0) {
    scr_printf("FAIL module %s id=%d result=%d\n", name, module_id,
               module_result);
    return 0;
  }
  scr_printf("module %s ready\n", name);
  return 1;
}

static int link_is_ready(void) {
  return NetManIoctl(NETMAN_NETIF_IOCTL_GET_LINK_STATUS, NULL, 0, NULL, 0) ==
         NETMAN_NETIF_ETH_LINK_STATE_UP;
}

static int dhcp_is_ready(void) {
  t_ip_info info;
  if (ps2ip_getconfig("sm0", &info) < 0 || !info.dhcp_enabled) {
    return 0;
  }
  return info.dhcp_status == DHCP_STATE_BOUND;
}

static int wait_until(int (*ready)(void)) {
  for (int attempt = 0; attempt < NETWORK_WAIT_ATTEMPTS; ++attempt) {
    if (ready()) {
      return 1;
    }
    sleep(1);
  }
  return 0;
}

static int start_network(void) {
  struct ip4_addr address;
  struct ip4_addr netmask;
  struct ip4_addr gateway;

  sceSifInitRpc(0);
  while (!SifIopReset("", 0)) {
  }
  while (!SifIopSync()) {
  }
  sceSifInitRpc(0);
  SifLoadFileInit();
  SifInitIopHeap();
  sbv_patch_enable_lmb();

  if (!load_module("DEV9", DEV9_irx, size_DEV9_irx) ||
      !load_module("NETMAN", NETMAN_irx, size_NETMAN_irx) ||
      !load_module("SMAP", SMAP_irx, size_SMAP_irx)) {
    return 0;
  }
  if (NetManInit() < 0) {
    scr_printf("FAIL NetManInit\n");
    return 0;
  }

  ip4_addr_set_zero(&address);
  ip4_addr_set_zero(&netmask);
  ip4_addr_set_zero(&gateway);
  if (ps2ipInit(&address, &netmask, &gateway) < 0) {
    scr_printf("FAIL ps2ipInit\n");
    return 0;
  }

  t_ip_info info;
  if (ps2ip_getconfig("sm0", &info) < 0) {
    scr_printf("FAIL read sm0 config\n");
    return 0;
  }
  info.dhcp_enabled = 1;
  if (ps2ip_setconfig(&info) < 0) {
    scr_printf("FAIL enable DHCP\n");
    return 0;
  }

  scr_printf("waiting for DEV9 link...\n");
  if (!wait_until(link_is_ready)) {
    scr_printf("FAIL DEV9 link timeout\n");
    return 0;
  }
  scr_printf("waiting for DHCP...\n");
  if (!wait_until(dhcp_is_ready)) {
    scr_printf("FAIL DHCP timeout\n");
    return 0;
  }

  if (ps2ip_getconfig("sm0", &info) < 0) {
    scr_printf("FAIL final sm0 config\n");
    return 0;
  }
  const struct ip4_addr *leased_address =
      (const struct ip4_addr *)&info.ipaddr;
  scr_printf("network ready %u.%u.%u.%u\n", ip4_addr1(leased_address),
             ip4_addr2(leased_address), ip4_addr3(leased_address),
             ip4_addr4(leased_address));
  return 1;
}

static int probe_gateway(void) {
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    scr_printf("FAIL socket\n");
    return 0;
  }

  struct sockaddr_in address;
  memset(&address, 0, sizeof(address));
  address.sin_family = AF_INET;
  address.sin_port = htons(MULTIPLEX_PROBE_PORT);
  address.sin_addr.s_addr = inet_addr(MULTIPLEX_PROBE_HOST);
  if (connect(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
    scr_printf("FAIL connect %s:%d\n", MULTIPLEX_PROBE_HOST,
               MULTIPLEX_PROBE_PORT);
    close(fd);
    return 0;
  }

  char request[512];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET /probe?nonce=%s HTTP/1.1\r\nHost: %s:%d\r\n"
      "User-Agent: Multiplex-PS2-Network-Probe/1\r\nConnection: close\r\n\r\n",
      MULTIPLEX_PROBE_NONCE, MULTIPLEX_PROBE_HOST, MULTIPLEX_PROBE_PORT);
  if (request_size <= 0 || request_size >= (int)sizeof(request) ||
      send(fd, request, request_size, 0) != request_size) {
    scr_printf("FAIL send request\n");
    close(fd);
    return 0;
  }

  char response[RESPONSE_CAPACITY];
  size_t response_size = 0;
  for (;;) {
    const int received =
        recv(fd, response + response_size,
             sizeof(response) - response_size - 1u, 0);
    if (received < 0) {
      scr_printf("FAIL receive response\n");
      close(fd);
      return 0;
    }
    if (received == 0) {
      break;
    }
    response_size += (size_t)received;
    if (response_size + 1u >= sizeof(response)) {
      scr_printf("FAIL oversized response\n");
      close(fd);
      return 0;
    }
  }
  close(fd);
  response[response_size] = '\0';

  if (strstr(response, "HTTP/1.1 200") == NULL ||
      strstr(response, MULTIPLEX_PROBE_NONCE) == NULL) {
    scr_printf("FAIL invalid HTTP response (%u bytes)\n",
               (unsigned)response_size);
    return 0;
  }

  scr_printf("\nPASS real HTTP round trip\n");
  scr_printf("host %s:%d\n", MULTIPLEX_PROBE_HOST, MULTIPLEX_PROBE_PORT);
  scr_printf("nonce %s\n", MULTIPLEX_PROBE_NONCE);
  return 1;
}

int main(void) {
  init_scr();
  scr_printf("Multiplex PS2 network probe\n\n");

  const int network_ready = start_network();
  const int probe_ready = network_ready && probe_gateway();
  scr_printf("\n%s\n", probe_ready ? "MPS2-NET-VERIFIED" : "MPS2-NET-FAILED");

  for (;;) {
    sleep(1);
  }
}
