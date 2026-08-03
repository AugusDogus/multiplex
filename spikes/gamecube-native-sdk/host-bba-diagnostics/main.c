#include "network_resolver.h"

#include <gccore.h>
#include <network.h>
#include <ogc/consol.h>
#include <ogc/exi.h>
#include <ogc/system.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define BBA_DEVICE_ID 0x04020200u
#define MULTIPLEX_HOST "web-production-15c27.up.railway.app"
#define PLEX_HOST "192.168.86.245"

static void initialize_console(void) {
  VIDEO_Init();
  PAD_Init();
  GXRModeObj *mode = VIDEO_GetPreferredMode(NULL);
  void *framebuffer = MEM_K0_TO_K1(SYS_AllocateFramebuffer(mode));
  CON_Init(framebuffer, 24, 24, mode->fbWidth - 48, mode->xfbHeight - 48,
           mode->fbWidth * VI_DISPLAY_PIX_SZ);
  VIDEO_Configure(mode);
  VIDEO_SetNextFramebuffer(framebuffer);
  VIDEO_SetBlack(FALSE);
  VIDEO_Flush();
  VIDEO_WaitVSync();
  if ((mode->viTVMode & VI_NON_INTERLACE) != 0) {
    VIDEO_WaitVSync();
  }
}

static void print_result(bool passed, const char *label) {
  printf("%s  %s\n", passed ? "[PASS]" : "[FAIL]", label);
}

static bool tcp_connect(const struct in_addr *address, uint16_t port) {
  const int socket = net_socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (socket < 0) {
    return false;
  }
  struct sockaddr_in remote;
  memset(&remote, 0, sizeof(remote));
  remote.sin_family = AF_INET;
  remote.sin_len = sizeof(remote);
  remote.sin_port = htons(port);
  remote.sin_addr = *address;
  const bool connected =
      net_connect(socket, (struct sockaddr *)&remote, sizeof(remote)) == 0;
  net_close(socket);
  return connected;
}

static void run_diagnostics(void) {
  printf("Multiplex BBA Diagnostics\n");
  printf("=========================\n\n");

  uint32_t device_id = 0;
  const bool adapter_detected =
      EXI_GetID(EXI_CHANNEL_0, EXI_DEVICE_2, &device_id) != 0 &&
      device_id == BBA_DEVICE_ID;
  print_result(adapter_detected, "Official Broadband Adapter detected");
  printf("       EXI device ID: %08lx\n\n", (unsigned long)device_id);
  if (!adapter_detected) {
    printf("The console cannot see a DOL-015 in Serial Port 1.\n");
    printf("Power off, reseat the adapter, and try again.\n");
    return;
  }

  printf("[....] Requesting a DHCP lease. This can take a few seconds...\n");
  char local_ip[16] = {0};
  char netmask[16] = {0};
  char gateway[16] = {0};
  const int network_status = if_config(local_ip, netmask, gateway, true);
  const bool dhcp_ready = network_status >= 0 && local_ip[0] != '\0' &&
                          strcmp(local_ip, "0.0.0.0") != 0;
  print_result(dhcp_ready, "Ethernet link and DHCP");
  printf("       libogc2 status: %d\n", network_status);
  if (!dhcp_ready) {
    if (network_status == -1) {
      printf("       BBA detected, but its PHY did not establish a link.\n");
      printf("       Check the Ethernet cable and router/switch port.\n");
    } else {
      printf("       Link may be up, but no DHCP lease was received.\n");
      printf("       Check your router's DHCP server and lease list.\n");
    }
    return;
  }

  printf("       IP:      %s\n", local_ip);
  printf("       Netmask: %s\n", netmask);
  printf("       Gateway: %s\n", gateway);
  uint8_t mac[6] = {0};
  if (net_get_mac_address(mac) == 0) {
    printf("       MAC:     %02x:%02x:%02x:%02x:%02x:%02x\n", mac[0], mac[1],
           mac[2], mac[3], mac[4], mac[5]);
  }
  printf("\n");

  struct in_addr plex_address;
  const bool plex_address_valid = inet_aton(PLEX_HOST, &plex_address) != 0;
  print_result(plex_address_valid && tcp_connect(&plex_address, 32400),
               "Plex TCP 192.168.86.245:32400");

  struct in_addr multiplex_address;
  const bool dns_ready =
      multiplex_resolve_ipv4(MULTIPLEX_HOST, gateway, &multiplex_address);
  print_result(dns_ready, "Multiplex DNS through the router");
  if (dns_ready) {
    char resolved_ip[16];
    inet_ntoa_r(multiplex_address, resolved_ip, sizeof(resolved_ip));
    printf("       %s\n", resolved_ip);
    print_result(tcp_connect(&multiplex_address, 443),
                 "Multiplex TCP port 443");
  }

  printf(
      "\nDiagnostics complete. Photograph this screen if anything failed.\n");
}

int main(void) {
  initialize_console();
  run_diagnostics();
  printf(
      "\nThis test will remain open. Reset the console to return to Swiss.\n");
  while (SYS_MainLoop()) {
    PAD_ScanPads();
    VIDEO_WaitVSync();
  }
  return 0;
}
