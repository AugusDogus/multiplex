#include "tls_read_poll.h"

#include <assert.h>
#include <errno.h>
#include <network.h>
#include <stdio.h>

typedef struct {
  unsigned checks;
  unsigned cancel_after_checks;
} CancellationState;

static unsigned select_calls;
static unsigned readable_after_calls;

static bool cancelled(void *context) {
  CancellationState *state = context;
  state->checks += 1u;
  return state->cancel_after_checks != 0 &&
         state->checks >= state->cancel_after_checks;
}

int net_select(int descriptor_count, fd_set *readable, fd_set *writable,
               fd_set *exceptions, struct timeval *timeout) {
  (void)descriptor_count;
  assert(readable != NULL);
  assert(writable == NULL);
  assert(exceptions == NULL);
  assert(timeout->tv_sec == 0);
  assert(timeout->tv_usec == MULTIPLEX_TLS_READ_CANCEL_BOUND_US);
  select_calls += 1u;
  return readable_after_calls != 0 && select_calls >= readable_after_calls ? 1
                                                                           : 0;
}

static void test_cancellation_bound(void) {
  select_calls = 0;
  readable_after_calls = 0;
  CancellationState state = {.cancel_after_checks = 4};
  const MultiplexHttpCancellation cancellation = {
      .is_cancelled = cancelled,
      .context = &state,
  };
  assert(multiplex_tls_wait_readable(3, 30, &cancellation) == -ECANCELED);
  assert(select_calls == 3u);
}

static void test_readable_and_timeout(void) {
  select_calls = 0;
  readable_after_calls = 2;
  assert(multiplex_tls_wait_readable(3, 1, NULL) == 1);
  assert(select_calls == 2u);

  select_calls = 0;
  readable_after_calls = 0;
  assert(multiplex_tls_wait_readable(3, 1, NULL) == 0);
  assert(select_calls == 1000000u / MULTIPLEX_TLS_READ_CANCEL_BOUND_US);
}

int main(void) {
  test_cancellation_bound();
  test_readable_and_timeout();
  puts("GameCube TLS read polling tests passed.");
  return 0;
}
