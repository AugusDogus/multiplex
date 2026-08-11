#include "plex_hls.h"

#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

static unsigned request_count;
static unsigned decision_request_count;
static unsigned start_request_count;
static unsigned successful_stop_reports;
static unsigned response_status;
static bool request_was_cancellable;
static bool cancel_after_start_transmission;
static bool *active_cancellation;

uint64_t gettime(void) { return 1u; }

void SYS_Report(const char *message, ...) {
  char report[256];
  va_list arguments;
  va_start(arguments, message);
  vsnprintf(report, sizeof(report), message, arguments);
  va_end(arguments);
  if (strstr(report, "Plex HLS stopped session=") != NULL) {
    successful_stop_reports += 1u;
  }
}

bool http_client_request_with_headers_cancellable(
    const char *method, const char *url, const HttpRequestHeader *headers,
    size_t header_count, const char *body, char *destination, size_t capacity,
    const MultiplexHttpCancellation *cancellation, HttpJsonResponse *response) {
  (void)headers;
  (void)header_count;
  (void)body;
  assert(strcmp(method, "GET") == 0);
  assert(destination != NULL && capacity != 0);
  if (strstr(url, "decision?") != NULL) {
    decision_request_count += 1u;
    *response = (HttpJsonResponse){.status = 200u};
    return true;
  }
  if (strstr(url, "start.m3u8?") != NULL) {
    start_request_count += 1u;
    assert(cancel_after_start_transmission && active_cancellation != NULL);
    *active_cancellation = true;
    *response = (HttpJsonResponse){0};
    return false;
  }
  assert(strstr(url, "stop?session=fixture-session") != NULL);
  request_count += 1u;
  request_was_cancellable = cancellation != NULL;
  *response = (HttpJsonResponse){.status = response_status};
  return false;
}

static bool cancelled(void *context) {
  assert(context != NULL);
  return *(const bool *)context;
}

bool hls_playlist_parse_master(const char *text, size_t size,
                               HlsVariant *variant) {
  (void)text;
  (void)size;
  (void)variant;
  assert(false);
  return false;
}

bool hls_playlist_resolve_url(const char *base_url, const char *reference,
                              char *destination, size_t capacity) {
  (void)base_url;
  (void)reference;
  (void)destination;
  (void)capacity;
  assert(false);
  return false;
}

static MultiplexAuthCredentials credentials(void) {
  MultiplexAuthCredentials value = {0};
  strcpy(value.plex_server_url, "http://fixture.test");
  strcpy(value.plex_server_token, "token");
  strcpy(value.plex_client_id, "client");
  return value;
}

static MultiplexPlexHlsSession session(void) {
  MultiplexPlexHlsSession value = {
      .started = true,
      .server_cleanup_required = true,
  };
  strcpy(value.session_id, "fixture-session");
  return value;
}

static void test_control_stop_is_fresh_and_idempotent(void) {
  const MultiplexAuthCredentials auth = credentials();
  MultiplexPlexHlsSession hls = session();
  response_status = 200u;
  multiplex_plex_hls_stop(&auth, &hls);
  assert(request_count == 1u);
  assert(!request_was_cancellable);
  assert(successful_stop_reports == 1u);
  assert(!hls.started && !hls.server_cleanup_required &&
         hls.session_id[0] == '\0');

  multiplex_plex_hls_stop(&auth, &hls);
  assert(request_count == 1u);
  assert(successful_stop_reports == 1u);
}

static void test_failed_or_cancelled_stop_is_not_reported_as_success(void) {
  const MultiplexAuthCredentials auth = credentials();
  MultiplexPlexHlsSession hls = session();
  response_status = 503u;
  multiplex_plex_hls_stop(&auth, &hls);
  assert(request_count == 2u);
  assert(successful_stop_reports == 1u);

  hls = session();
  response_status = 0u;
  bool cancellation_requested = true;
  const MultiplexHttpCancellation cancellation = {
      .is_cancelled = cancelled,
      .context = &cancellation_requested,
  };
  multiplex_plex_hls_stop_cancellable(&auth, &hls, &cancellation);
  assert(request_count == 3u);
  assert(request_was_cancellable);
  assert(successful_stop_reports == 1u);
}

static void test_cancelled_before_start_send_does_not_stop(void) {
  const MultiplexAuthCredentials auth = credentials();
  MultiplexPlexHlsSession hls = {0};
  bool cancellation_requested = true;
  const MultiplexHttpCancellation cancellation = {
      .is_cancelled = cancelled,
      .context = &cancellation_requested,
  };
  const unsigned stops_before = request_count;
  const unsigned decisions_before = decision_request_count;
  const unsigned starts_before = start_request_count;

  assert(!multiplex_plex_hls_start_cancellable(
      &auth, 42u, 0u, "fixture-session", false, 0u, &hls, &cancellation));
  multiplex_plex_hls_stop(&auth, &hls);

  assert(decision_request_count == decisions_before);
  assert(start_request_count == starts_before);
  assert(request_count == stops_before);
}

static void test_cancelled_after_start_send_stops_once(void) {
  const MultiplexAuthCredentials auth = credentials();
  MultiplexPlexHlsSession hls = {0};
  bool cancellation_requested = false;
  const MultiplexHttpCancellation cancellation = {
      .is_cancelled = cancelled,
      .context = &cancellation_requested,
  };
  const unsigned stops_before = request_count;
  const unsigned decisions_before = decision_request_count;
  const unsigned starts_before = start_request_count;
  active_cancellation = &cancellation_requested;
  cancel_after_start_transmission = true;

  assert(!multiplex_plex_hls_start_cancellable(
      &auth, 42u, 0u, "fixture-session", false, 0u, &hls, &cancellation));
  assert(cancellation_requested);
  assert(!hls.started);
  assert(decision_request_count == decisions_before + 1u);
  assert(start_request_count == starts_before + 1u);

  response_status = 200u;
  multiplex_plex_hls_stop(&auth, &hls);
  assert(request_count == stops_before + 1u);
  multiplex_plex_hls_stop(&auth, &hls);
  assert(request_count == stops_before + 1u);

  cancel_after_start_transmission = false;
  active_cancellation = NULL;
}

int main(void) {
  test_control_stop_is_fresh_and_idempotent();
  test_failed_or_cancelled_stop_is_not_reported_as_success();
  test_cancelled_before_start_send_does_not_stop();
  test_cancelled_after_start_send_stops_once();
  puts("GameCube Plex HLS stop tests passed.");
  return 0;
}
