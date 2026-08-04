#include "network_resolver.h"

#include <gccore.h>
#include <network.h>
#include <ogc/consol.h>
#include <ogc/exi.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <ogc/system.h>

#include <stdbool.h>
#include <stdint.h>
#include <errno.h>
#include <malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define BBA_DEVICE_ID 0x04020200u
#define MULTIPLEX_HOST "web-production-15c27.up.railway.app"
#define PLEX_HOST "192.168.86.245"
#define PLEX_PORT 32400u
#define PLEX_ASSET_FALLBACK                                                    \
  "/web/js/main-8792-5e6a05fd7fbc07797f88-plex-4.160.0-75ddd7b.js"
#define HTTP_HEADER_CAPACITY 8192u
#define HTTP_READ_CAPACITY 16384u
#define HTTP_READ_TIMEOUT_SECONDS 8u
#define HTTP_DOWNLOAD_DEADLINE_MS 20000u
#define PRIOR_ART_READ_CAPACITY 2048u
#define PRIOR_ART_POLL_INTERVAL_US 4000u
#define CONTROL_THREAD_STACK_SIZE (64u * 1024u)

typedef struct {
  bool connected;
  bool headers_received;
  bool timed_out;
  unsigned status;
  size_t body_bytes;
  uint32_t elapsed_ms;
  uint32_t read_calls;
  uint32_t largest_read;
  uint32_t max_read_gap_ms;
  int terminal_select;
  int terminal_recv;
} DownloadResult;

typedef enum {
  READ_WITH_SELECT,
  READ_LIKE_SWISS,
} ReadStrategy;

typedef struct {
  int selected;
  int received;
} ReadAttempt;

typedef struct {
  struct in_addr address;
  DownloadResult result;
} ConcurrentControlRequest;

static char plex_index_buffer[40u * 1024u];

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

static int connect_socket(const struct in_addr *address, uint16_t port) {
  const int socket = net_socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (socket < 0) {
    return -1;
  }
  struct sockaddr_in remote;
  memset(&remote, 0, sizeof(remote));
  remote.sin_family = AF_INET;
  remote.sin_len = sizeof(remote);
  remote.sin_port = htons(port);
  remote.sin_addr = *address;
  if (net_connect(socket, (struct sockaddr *)&remote, sizeof(remote)) != 0) {
    net_close(socket);
    return -1;
  }
  return socket;
}

static bool write_request(int socket, const char *path) {
  char request[512];
  const int request_size = snprintf(
      request, sizeof(request),
      "GET %s HTTP/1.1\r\nHost: " PLEX_HOST
      ":32400\r\nConnection: close\r\nUser-Agent: Multiplex-BBA-Diagnostics/1\r\n\r\n",
      path);
  if (request_size <= 0 || (size_t)request_size >= sizeof(request)) {
    return false;
  }
  size_t written = 0;
  while (written < (size_t)request_size) {
    const int result =
        net_write(socket, request + written, (size_t)request_size - written);
    if (result <= 0) {
      return false;
    }
    written += (size_t)result;
  }
  return true;
}

static ReadAttempt read_with_select(int socket, void *destination,
                                    size_t capacity) {
  fd_set readable;
  FD_ZERO(&readable);
  FD_SET(socket, &readable);
  struct timeval timeout = {
      .tv_sec = HTTP_READ_TIMEOUT_SECONDS,
      .tv_usec = 0,
  };
  ReadAttempt attempt;
  attempt.selected = net_select(socket + 1, &readable, NULL, NULL, &timeout);
  attempt.received = attempt.selected > 0
                         ? net_recv(socket, destination, capacity, 0)
                         : -EAGAIN;
  return attempt;
}

static ReadAttempt read_like_swiss(int socket, void *destination,
                                   size_t capacity) {
  ReadAttempt attempt = {.selected = -1, .received = -EAGAIN};
  const uint64_t started = gettime();
  const size_t bounded_capacity = capacity > PRIOR_ART_READ_CAPACITY
                                      ? PRIOR_ART_READ_CAPACITY
                                      : capacity;
  do {
    attempt.received =
        net_recv(socket, destination, bounded_capacity, MSG_DONTWAIT);
    if (attempt.received != -EAGAIN && attempt.received != -EWOULDBLOCK) {
      return attempt;
    }
    usleep(PRIOR_ART_POLL_INTERVAL_US);
  } while (ticks_to_millisecs(gettime() - started) <
           HTTP_READ_TIMEOUT_SECONDS * 1000u);
  return attempt;
}

static ReadAttempt read_with_strategy(int socket, void *destination,
                                      size_t capacity,
                                      ReadStrategy strategy) {
  return strategy == READ_LIKE_SWISS
             ? read_like_swiss(socket, destination, capacity)
             : read_with_select(socket, destination, capacity);
}

static bool parse_response_headers(const char *headers, size_t size,
                                   unsigned *status,
                                   size_t *body_offset) {
  if (headers == NULL || status == NULL || body_offset == NULL) {
    return false;
  }
  const char *separator = NULL;
  for (size_t index = 3; index < size; ++index) {
    if (headers[index - 3] == '\r' && headers[index - 2] == '\n' &&
        headers[index - 1] == '\r' && headers[index] == '\n') {
      separator = headers + index - 3;
      break;
    }
  }
  if (separator == NULL ||
      sscanf(headers, "HTTP/%*u.%*u %u", status) != 1) {
    return false;
  }
  *body_offset = (size_t)(separator - headers) + 4u;
  return true;
}

static DownloadResult download_path(const struct in_addr *address,
                                    const char *path, ReadStrategy strategy) {
  DownloadResult result;
  memset(&result, 0, sizeof(result));
  const uint64_t started = gettime();
  uint8_t *workspace = malloc(HTTP_HEADER_CAPACITY + HTTP_READ_CAPACITY);
  if (workspace == NULL) {
    return result;
  }
  char *headers = (char *)workspace;
  uint8_t *read_buffer = workspace + HTTP_HEADER_CAPACITY;
  const int socket = connect_socket(address, PLEX_PORT);
  if (socket < 0) {
    free(workspace);
    return result;
  }
  result.connected = true;
  if (!write_request(socket, path)) {
    net_close(socket);
    free(workspace);
    return result;
  }

  size_t header_bytes = 0;
  while (header_bytes + 1u < HTTP_HEADER_CAPACITY) {
    const ReadAttempt attempt = read_with_strategy(
        socket, headers + header_bytes,
        HTTP_HEADER_CAPACITY - header_bytes - 1u, strategy);
    const int received = attempt.received;
    result.terminal_select = attempt.selected;
    result.terminal_recv = received;
    result.read_calls++;
    if (received <= 0) {
      result.timed_out = true;
      break;
    }
    header_bytes += (size_t)received;
    headers[header_bytes] = '\0';
    size_t body_offset = 0;
    if (parse_response_headers(headers, header_bytes, &result.status,
                               &body_offset)) {
      result.headers_received = true;
      result.body_bytes = header_bytes - body_offset;
      break;
    }
  }

  uint32_t previous_read_ms =
      (uint32_t)ticks_to_millisecs(gettime() - started);
  while (result.headers_received) {
    if (ticks_to_millisecs(gettime() - started) >=
        HTTP_DOWNLOAD_DEADLINE_MS) {
      result.timed_out = true;
      break;
    }
    const ReadAttempt attempt = read_with_strategy(
        socket, read_buffer, HTTP_READ_CAPACITY, strategy);
    const int received = attempt.received;
    result.terminal_select = attempt.selected;
    result.terminal_recv = received;
    result.read_calls++;
    if (received == 0) {
      break;
    }
    if (received < 0) {
      result.timed_out = true;
      break;
    }
    const uint32_t read_ms =
        (uint32_t)ticks_to_millisecs(gettime() - started);
    const uint32_t read_gap_ms = read_ms - previous_read_ms;
    if (read_gap_ms > result.max_read_gap_ms) {
      result.max_read_gap_ms = read_gap_ms;
    }
    previous_read_ms = read_ms;
    if ((uint32_t)received > result.largest_read) {
      result.largest_read = (uint32_t)received;
    }
    result.body_bytes += (size_t)received;
  }
  result.elapsed_ms =
      (uint32_t)ticks_to_millisecs(gettime() - started);
  net_close(socket);
  free(workspace);
  return result;
}

static bool load_plex_web_asset_path(const struct in_addr *address,
                                     char *path, size_t capacity) {
  const int socket = connect_socket(address, PLEX_PORT);
  if (socket < 0 || !write_request(socket, "/web/index.html")) {
    if (socket >= 0) {
      net_close(socket);
    }
    return false;
  }
  size_t used = 0;
  ReadAttempt terminal = {.selected = -1, .received = 0};
  uint32_t reads = 0;
  while (used + 1u < sizeof(plex_index_buffer)) {
    terminal = read_like_swiss(socket, plex_index_buffer + used,
                               sizeof(plex_index_buffer) - used - 1u);
    const int received = terminal.received;
    reads++;
    if (received <= 0) {
      break;
    }
    used += (size_t)received;
  }
  net_close(socket);
  plex_index_buffer[used] = '\0';
  SYS_Report("BBA DIAGNOSTIC: discovery bytes=%lu reads=%lu select=%d recv=%d\n",
             (unsigned long)used, (unsigned long)reads, terminal.selected,
             terminal.received);
  const char marker[] = "src=\"/web/js/main-";
  const char *start = strstr(plex_index_buffer, marker);
  if (start == NULL) {
    return false;
  }
  start += strlen("src=\"");
  const char *end = strchr(start, '"');
  const size_t path_size = end == NULL ? 0u : (size_t)(end - start);
  if (path_size == 0 || path_size >= capacity) {
    return false;
  }
  memcpy(path, start, path_size);
  path[path_size] = '\0';
  return true;
}

static uint32_t download_kib_per_second(const DownloadResult *result) {
  if (result == NULL || result->elapsed_ms == 0) {
    return 0;
  }
  return (uint32_t)(((uint64_t)result->body_bytes * 1000u) /
                    ((uint64_t)result->elapsed_ms * 1024u));
}

static void *run_concurrent_control_request(void *context) {
  ConcurrentControlRequest *request = context;
  usleep(250000);
  request->result =
      download_path(&request->address, "/identity", READ_LIKE_SWISS);
  return NULL;
}

static void print_download_result(const char *label,
                                  const DownloadResult *result) {
  printf("%s: %lu KiB/s, %lu KiB in %lu ms%s\n", label,
         (unsigned long)download_kib_per_second(result),
         (unsigned long)(result->body_bytes / 1024u),
         (unsigned long)result->elapsed_ms,
         result->timed_out ? " [TIMEOUT]" : "");
  printf("       HTTP %u, connected=%u, headers=%u\n", result->status,
         result->connected ? 1u : 0u,
         result->headers_received ? 1u : 0u);
  printf("       reads=%lu, max=%lu B, gap=%lu ms, sel=%d recv=%d\n",
         (unsigned long)result->read_calls,
         (unsigned long)result->largest_read,
         (unsigned long)result->max_read_gap_ms, result->terminal_select,
         result->terminal_recv);
  SYS_Report("BBA DIAGNOSTIC: %s rate=%luKiB/s bytes=%lu elapsed=%lums "
             "timeout=%u http=%u connected=%u headers=%u reads=%lu max=%lu "
             "gap=%lums select=%d recv=%d\n",
             label, (unsigned long)download_kib_per_second(result),
             (unsigned long)result->body_bytes,
             (unsigned long)result->elapsed_ms, result->timed_out ? 1u : 0u,
             result->status, result->connected ? 1u : 0u,
             result->headers_received ? 1u : 0u,
             (unsigned long)result->read_calls,
             (unsigned long)result->largest_read,
             (unsigned long)result->max_read_gap_ms, result->terminal_select,
             result->terminal_recv);
}

static void run_throughput_diagnostics(const struct in_addr *plex_address,
                                       const char *local_ip) {
  char asset_path[256];
  printf("\nDiscovering a large public asset from Plex...\n");
  if (!load_plex_web_asset_path(plex_address, asset_path,
                                sizeof(asset_path))) {
    snprintf(asset_path, sizeof(asset_path), "%s", PLEX_ASSET_FALLBACK);
    printf("[WARN] Discovery stalled; using the known Plex asset.\n");
    SYS_Report("BBA DIAGNOSTIC: discovery failed; fallback asset=%s\n",
               asset_path);
  }

  printf("Running single-stream and concurrency tests...\n");
  SYS_Report("BBA DIAGNOSTIC: throughput test asset=%s\n", asset_path);
  const DownloadResult selected =
      download_path(plex_address, asset_path, READ_WITH_SELECT);
  const DownloadResult single =
      download_path(plex_address, asset_path, READ_LIKE_SWISS);

  ConcurrentControlRequest control;
  memset(&control, 0, sizeof(control));
  control.address = *plex_address;
  void *control_stack = memalign(32, CONTROL_THREAD_STACK_SIZE);
  lwp_t control_thread = LWP_THREAD_NULL;
  bool control_started =
      control_stack != NULL &&
      LWP_CreateThread(&control_thread, run_concurrent_control_request,
                       &control, control_stack, CONTROL_THREAD_STACK_SIZE,
                       LWP_PRIO_NORMAL / 2) == 0;
  const DownloadResult concurrent =
      download_path(plex_address, asset_path, READ_LIKE_SWISS);
  if (control_started) {
    LWP_JoinThread(control_thread, NULL);
  }
  free(control_stack);

  printf("\x1b[2J\x1b[H");
  printf("Multiplex BBA Throughput\n");
  printf("========================\n");
  printf("GameCube IP: %s\n", local_ip);
  printf("Plex: " PLEX_HOST ":32400\n\n");
  print_download_result("Current select reader", &selected);
  printf("\n");
  print_download_result("Swiss-style reader", &single);
  printf("\n");
  print_download_result("With control request", &concurrent);
  if (control_started) {
    printf("       Control: HTTP %u in %lu ms\n", control.result.status,
           (unsigned long)control.result.elapsed_ms);
    SYS_Report("BBA DIAGNOSTIC: control http=%u bytes=%lu elapsed=%lums "
               "timeout=%u connected=%u headers=%u\n",
               control.result.status, (unsigned long)control.result.body_bytes,
               (unsigned long)control.result.elapsed_ms,
               control.result.timed_out ? 1u : 0u,
               control.result.connected ? 1u : 0u,
               control.result.headers_received ? 1u : 0u);
  } else {
    printf("       Control thread could not start.\n");
    SYS_Report("BBA DIAGNOSTIC: control thread could not start\n");
  }

  const uint32_t single_rate = download_kib_per_second(&single);
  const uint32_t concurrent_rate = download_kib_per_second(&concurrent);
  printf("\n");
  if (single.status != 200 || single.timed_out || single_rate < 128u) {
    printf("[FAIL] One BBA stream is too slow for media.\n");
  } else if (control_started &&
             (concurrent.timed_out || concurrent_rate * 2u < single_rate)) {
    printf("[FAIL] A second request collapses BBA throughput.\n");
  } else {
    printf("[PASS] BBA transport sustained media-class throughput.\n");
  }
  printf("\nPhotograph this screen and report both rates.\n");
}

static void run_diagnostics(void) {
  SYS_Report("BBA DIAGNOSTIC: started\n");
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

  if (plex_address_valid) {
    run_throughput_diagnostics(&plex_address, local_ip);
  }
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
