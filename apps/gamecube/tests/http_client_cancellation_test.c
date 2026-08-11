#include "http_client.h"

#include "network_resolver.h"
#include "tls_client.h"

#include <assert.h>
#include <ogc/mutex.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  bool requested;
  bool cancel_on_connect;
  bool cancel_on_yield;
} CancellationState;

static const uint8_t *response_bytes;
static size_t response_size;
static size_t response_offset;
static size_t first_read_size;
static size_t later_read_size;
static unsigned recv_count;
static unsigned cancel_after_recv;
static unsigned socket_count;
static unsigned connect_count;
static unsigned write_count;
static bool mutex_locked;
static bool mutex_force_busy;
static CancellationState *active_cancellation;

static bool cancelled(void *context) {
  return ((CancellationState *)context)->requested;
}

static MultiplexHttpCancellation cancellation(CancellationState *state) {
  active_cancellation = state;
  return (MultiplexHttpCancellation){
      .is_cancelled = cancelled,
      .context = state,
  };
}

static void set_response(const char *headers, const char *body) {
  static uint8_t bytes[1024];
  const size_t header_size = strlen(headers);
  const size_t body_size = strlen(body);
  assert(header_size + body_size <= sizeof(bytes));
  memcpy(bytes, headers, header_size);
  memcpy(bytes + header_size, body, body_size);
  response_bytes = bytes;
  response_size = header_size + body_size;
  response_offset = 0;
  first_read_size = 0;
  later_read_size = 0;
  recv_count = 0;
  cancel_after_recv = 0;
}

void SYS_Report(const char *message, ...) { (void)message; }

void LWP_YieldThread(void) {
  if (active_cancellation != NULL && active_cancellation->cancel_on_yield) {
    active_cancellation->requested = true;
  }
}

int LWP_MutexInit(mutex_t *mutex, bool recursive) {
  (void)recursive;
  *mutex = 1;
  return 0;
}

int LWP_MutexLock(mutex_t mutex) {
  (void)mutex;
  assert(!mutex_locked);
  mutex_locked = true;
  return 0;
}

int LWP_MutexTryLock(mutex_t mutex) {
  (void)mutex;
  if (mutex_force_busy || mutex_locked) {
    return 1;
  }
  mutex_locked = true;
  return 0;
}

int LWP_MutexUnlock(mutex_t mutex) {
  (void)mutex;
  assert(mutex_locked);
  mutex_locked = false;
  return 0;
}

int if_config(char *local_ip, char *netmask, char *gateway, bool use_dhcp) {
  (void)use_dhcp;
  strcpy(local_ip, "192.0.2.2");
  strcpy(netmask, "255.255.255.0");
  strcpy(gateway, "192.0.2.1");
  return 0;
}

int net_socket(int domain, int type, int protocol) {
  (void)domain;
  (void)type;
  (void)protocol;
  socket_count += 1u;
  return 3;
}

int net_setsockopt(int socket, int level, int option, const void *value,
                   socklen_t size) {
  (void)socket;
  (void)level;
  (void)option;
  (void)value;
  (void)size;
  return 0;
}

int net_connect(int socket, const struct sockaddr *address,
                socklen_t address_size) {
  (void)socket;
  (void)address;
  (void)address_size;
  connect_count += 1u;
  if (active_cancellation != NULL && active_cancellation->cancel_on_connect) {
    active_cancellation->requested = true;
  }
  return 0;
}

int net_fcntl(int socket, int command, int flags) {
  (void)socket;
  (void)command;
  (void)flags;
  return 0;
}

int net_getsockopt(int socket, int level, int option, void *value,
                   socklen_t *size) {
  (void)socket;
  (void)level;
  (void)option;
  assert(*size == sizeof(int));
  *(int *)value = 0;
  return 0;
}

int net_select(int descriptor_count, fd_set *readable, fd_set *writable,
               fd_set *exceptions, struct timeval *timeout) {
  (void)descriptor_count;
  (void)exceptions;
  (void)timeout;
  if (writable != NULL) {
    return 1;
  }
  return readable != NULL && response_offset < response_size ? 1 : 0;
}

int net_write(int socket, const void *bytes, size_t size) {
  (void)socket;
  (void)bytes;
  write_count += 1u;
  return (int)size;
}

int net_recv(int socket, void *destination, size_t size, int flags) {
  (void)socket;
  (void)flags;
  if (response_offset == response_size) {
    return 0;
  }
  recv_count += 1u;
  size_t copied = response_size - response_offset;
  const size_t limit = recv_count == 1u ? first_read_size : later_read_size;
  if (limit != 0 && copied > limit) {
    copied = limit;
  }
  if (copied > size) {
    copied = size;
  }
  memcpy(destination, response_bytes + response_offset, copied);
  response_offset += copied;
  if (cancel_after_recv == recv_count && active_cancellation != NULL) {
    active_cancellation->requested = true;
  }
  return (int)copied;
}

int net_close(int socket) {
  (void)socket;
  return 0;
}

bool multiplex_resolve_ipv4(const char *host, const char *dns_server,
                            struct in_addr *address) {
  (void)host;
  (void)dns_server;
  return inet_aton("192.0.2.3", address) != 0;
}

bool multiplex_resolve_ipv4_cancellable(
    const char *host, const char *dns_server, struct in_addr *address,
    const MultiplexHttpCancellation *request_cancellation) {
  if (multiplex_http_cancellation_requested(request_cancellation)) {
    return false;
  }
  return multiplex_resolve_ipv4(host, dns_server, address);
}

int32_t multiplex_resolver_last_error(void) { return 0; }
uint32_t multiplex_resolver_attempts(void) { return 0; }

bool multiplex_tls_client_initialize(void) { return true; }
int multiplex_tls_client_last_error(void) { return 0; }
uint32_t multiplex_tls_client_last_verify_flags(void) { return 0; }
MultiplexTlsClient *multiplex_tls_client_connect_cancellable(
    int socket, const char *hostname,
    const MultiplexHttpCancellation *request_cancellation) {
  (void)socket;
  (void)hostname;
  (void)request_cancellation;
  return NULL;
}
bool multiplex_tls_client_write_all_cancellable(
    MultiplexTlsClient *client, const uint8_t *bytes, size_t size,
    const MultiplexHttpCancellation *request_cancellation) {
  (void)client;
  (void)bytes;
  (void)size;
  (void)request_cancellation;
  return false;
}
int multiplex_tls_client_read_cancellable(
    MultiplexTlsClient *client, uint8_t *destination, size_t size,
    unsigned timeout_seconds,
    const MultiplexHttpCancellation *request_cancellation) {
  (void)client;
  (void)destination;
  (void)size;
  (void)timeout_seconds;
  (void)request_cancellation;
  return -1;
}
void multiplex_tls_client_destroy(MultiplexTlsClient *client) { (void)client; }

static bool accept_body(void *context, const uint8_t *bytes, size_t size) {
  size_t *accepted = context;
  (void)bytes;
  *accepted += size;
  return true;
}

static void test_non_cancellable_wrapper(void) {
  active_cancellation = NULL;
  set_response("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n", "{}");
  char destination[16];
  HttpJsonResponse response = {0};
  assert(http_client_request_json("GET", "http://fixture.test/value", NULL,
                                  NULL, destination, sizeof(destination),
                                  &response));
  assert(response.status == 200 && response.body_size == 2u);
  assert(strcmp(destination, "{}") == 0);
}

static void test_cancel_before_connect_and_write(void) {
  CancellationState state = {.requested = true};
  const MultiplexHttpCancellation request_cancellation = cancellation(&state);
  const unsigned sockets_before = socket_count;
  HttpJsonResponse response = {0};
  char destination[16];
  assert(!http_client_request_json_cancellable(
      "GET", "http://fixture.test/value", NULL, NULL, destination,
      sizeof(destination), &request_cancellation, &response));
  assert(socket_count == sockets_before);

  state = (CancellationState){.cancel_on_connect = true};
  const MultiplexHttpCancellation write_cancellation = cancellation(&state);
  const unsigned writes_before = write_count;
  assert(!http_client_request_json_cancellable(
      "GET", "http://fixture.test/value", NULL, NULL, destination,
      sizeof(destination), &write_cancellation, &response));
  assert(write_count == writes_before);
}

static void test_cancel_while_waiting_for_transaction(void) {
  CancellationState state = {.cancel_on_yield = true};
  const MultiplexHttpCancellation request_cancellation = cancellation(&state);
  mutex_force_busy = true;
  const unsigned sockets_before = socket_count;
  HttpJsonResponse response = {0};
  char destination[16];
  assert(!http_client_request_json_cancellable(
      "GET", "http://fixture.test/value", NULL, NULL, destination,
      sizeof(destination), &request_cancellation, &response));
  mutex_force_busy = false;
  assert(state.requested);
  assert(socket_count == sockets_before);
}

static void assert_body_cancellation(const char *headers, const char *body) {
  CancellationState state = {0};
  const MultiplexHttpCancellation request_cancellation = cancellation(&state);
  set_response(headers, body);
  first_read_size = strlen(headers);
  later_read_size = 1u;
  cancel_after_recv = 2u;
  size_t accepted = 0;
  HttpJsonResponse response = {0};
  assert(!http_client_stream_get_with_headers_cancellable(
      "http://fixture.test/body", NULL, 0, accept_body, &accepted, 0,
      &request_cancellation, &response));
  assert(state.requested);
  assert(accepted == 0);
}

static void test_cancel_during_each_body_framing(void) {
  assert_body_cancellation("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n",
                           "hello");
  assert_body_cancellation(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n",
      "5\r\nhello\r\n0\r\n\r\n");
  assert_body_cancellation("HTTP/1.1 200 OK\r\nX-Test: close\r\n\r\n", "hello");
}

static void test_cancel_during_headers_and_before_retry(void) {
  CancellationState state = {0};
  const MultiplexHttpCancellation request_cancellation = cancellation(&state);
  set_response("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n", "hello");
  first_read_size = 8u;
  cancel_after_recv = 1u;
  HttpJsonResponse response = {0};
  size_t accepted = 0;
  assert(!http_client_stream_get_with_headers_cancellable(
      "http://fixture.test/body", NULL, 0, accept_body, &accepted, 0,
      &request_cancellation, &response));

  state = (CancellationState){0};
  const MultiplexHttpCancellation retry_cancellation = cancellation(&state);
  set_response("HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n", "x");
  cancel_after_recv = 1u;
  const unsigned connects_before = connect_count;
  assert(http_client_open_cancellable("http://fixture.test/media",
                                      &retry_cancellation) == NULL);
  assert(connect_count == connects_before + 1u);
}

int main(void) {
  test_cancel_before_connect_and_write();
  test_non_cancellable_wrapper();
  test_cancel_while_waiting_for_transaction();
  test_cancel_during_each_body_framing();
  test_cancel_during_headers_and_before_retry();
  puts("GameCube HTTP cancellation tests passed.");
  return 0;
}
