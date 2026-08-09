#include "app_job_slot.h"

#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
  uint64_t now;
  bool allocation_fails;
  bool launch_fails;
  bool completed;
  bool cancel_fails;
  bool join_fails;
  unsigned allocations;
  unsigned launches;
  unsigned completions;
  unsigned cancellations;
  unsigned joins;
  unsigned frees;
  int handle;
} Fixture;

static void *allocate(void *context, size_t size) {
  Fixture *fixture = context;
  assert(size != 0);
  fixture->allocations += 1;
  return fixture->allocation_fails ? NULL : &fixture->handle;
}
static bool launch(void *context, void *handle) {
  Fixture *fixture = context;
  assert(handle == &fixture->handle);
  fixture->launches += 1;
  return !fixture->launch_fails;
}
static bool complete(void *context, void *handle) {
  Fixture *fixture = context;
  assert(handle == &fixture->handle);
  fixture->completions += 1;
  return fixture->completed;
}
static bool cancel(void *context, void *handle) {
  Fixture *fixture = context;
  assert(handle == &fixture->handle);
  fixture->cancellations += 1;
  return !fixture->cancel_fails;
}
static bool join(void *context, void *handle) {
  Fixture *fixture = context;
  assert(handle == &fixture->handle);
  fixture->joins += 1;
  return !fixture->join_fails;
}
static void release(void *context, void *handle) {
  Fixture *fixture = context;
  assert(handle == &fixture->handle);
  fixture->frees += 1;
}
static uint64_t now_ms(void *context) { return ((Fixture *)context)->now; }

static MultiplexAppJobOps ops(Fixture *fixture) {
  return (MultiplexAppJobOps){.allocate = allocate,
                              .launch = launch,
                              .complete = complete,
                              .cancel = cancel,
                              .join = join,
                              .free = release,
                              .now_ms = now_ms,
                              .context = fixture};
}

static void test_launch_failure_and_retry(void) {
  Fixture fixture = {.launch_fails = true};
  MultiplexAppJobSlot slot;
  multiplex_app_job_slot_init(&slot, ops(&fixture));
  assert(!multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 10));
  assert(fixture.allocations == 1 && fixture.launches == 1 &&
         fixture.frees == 1);
  assert(multiplex_app_job_slot_state(&slot) == MULTIPLEX_APP_JOB_EMPTY);
  fixture.launch_fails = false;
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 10));
  assert(multiplex_app_job_slot_state(&slot) == MULTIPLEX_APP_JOB_RUNNING);
}

static void test_completion_join_cleanup_and_retry(void) {
  Fixture fixture = {0};
  MultiplexAppJobSlot slot;
  multiplex_app_job_slot_init(&slot, ops(&fixture));
  assert(multiplex_app_job_slot_poll(&slot) == MULTIPLEX_APP_JOB_POLL_INACTIVE);
  fixture.now = 100;
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 20));
  assert(multiplex_app_job_slot_poll(&slot) == MULTIPLEX_APP_JOB_POLL_PENDING);
  fixture.completed = true;
  assert(multiplex_app_job_slot_poll(&slot) ==
         MULTIPLEX_APP_JOB_POLL_COMPLETED);
  assert(multiplex_app_job_slot_join(&slot));
  assert(multiplex_app_job_slot_join(&slot));
  assert(fixture.joins == 1);
  assert(multiplex_app_job_slot_poll(&slot) == MULTIPLEX_APP_JOB_POLL_INACTIVE);
  assert(multiplex_app_job_slot_cleanup(&slot));
  assert(multiplex_app_job_slot_cleanup(&slot));
  assert(fixture.frees == 1);
  assert(multiplex_app_job_slot_poll(&slot) == MULTIPLEX_APP_JOB_POLL_INACTIVE);
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 20));
}

static void test_deadline_cancel_is_deterministic_and_idempotent(void) {
  Fixture fixture = {0};
  MultiplexAppJobSlot slot;
  multiplex_app_job_slot_init(&slot, ops(&fixture));
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 50));
  fixture.now = 49;
  assert(multiplex_app_job_slot_poll(&slot) == MULTIPLEX_APP_JOB_POLL_PENDING);
  fixture.now = 50;
  assert(multiplex_app_job_slot_poll(&slot) ==
         MULTIPLEX_APP_JOB_POLL_TIMED_OUT);
  assert(multiplex_app_job_slot_poll(&slot) ==
         MULTIPLEX_APP_JOB_POLL_TIMED_OUT);
  assert(fixture.cancellations == 1);
  assert(multiplex_app_job_slot_cancel(&slot));
  assert(multiplex_app_job_slot_join(&slot));
  assert(multiplex_app_job_slot_cleanup(&slot));
}

static void test_failed_operations_preserve_ownership(void) {
  Fixture fixture = {0};
  MultiplexAppJobSlot slot;
  multiplex_app_job_slot_init(&slot, ops(&fixture));
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 10));
  fixture.cancel_fails = true;
  assert(!multiplex_app_job_slot_cancel(&slot));
  assert(multiplex_app_job_slot_state(&slot) == MULTIPLEX_APP_JOB_RUNNING);
  fixture.cancel_fails = false;
  fixture.join_fails = true;
  assert(multiplex_app_job_slot_cancel(&slot));
  assert(!multiplex_app_job_slot_join(&slot));
  fixture.join_fails = false;
  assert(multiplex_app_job_slot_join(&slot));
  assert(multiplex_app_job_slot_cleanup(&slot));
}

static void test_timeout_reports_cancel_failure(void) {
  Fixture fixture = {.cancel_fails = true};
  MultiplexAppJobSlot slot;
  multiplex_app_job_slot_init(&slot, ops(&fixture));
  assert(multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 10));
  fixture.now = 10;
  assert(multiplex_app_job_slot_poll(&slot) ==
         MULTIPLEX_APP_JOB_POLL_CANCEL_FAILED);
  assert(multiplex_app_job_slot_state(&slot) == MULTIPLEX_APP_JOB_RUNNING);
  assert(fixture.cancellations == 1);
  fixture.cancel_fails = false;
  assert(multiplex_app_job_slot_poll(&slot) ==
         MULTIPLEX_APP_JOB_POLL_TIMED_OUT);
  assert(fixture.cancellations == 2);
  assert(multiplex_app_job_slot_join(&slot));
  assert(multiplex_app_job_slot_cleanup(&slot));
}

static void test_launch_requires_complete_ownership_operations(void) {
  Fixture fixture = {0};
  MultiplexAppJobSlot slot;
  MultiplexAppJobOps incomplete = ops(&fixture);
  incomplete.join = NULL;
  multiplex_app_job_slot_init(&slot, incomplete);
  assert(!multiplex_app_job_slot_launch(&slot, sizeof(fixture.handle), 10));
  assert(fixture.allocations == 0);
  assert(multiplex_app_job_slot_cleanup(&slot));
}

int main(void) {
  test_launch_failure_and_retry();
  test_completion_join_cleanup_and_retry();
  test_deadline_cancel_is_deterministic_and_idempotent();
  test_failed_operations_preserve_ownership();
  test_timeout_reports_cancel_failure();
  test_launch_requires_complete_ownership_operations();
  puts("GameCube app job slot tests passed.");
  return 0;
}
