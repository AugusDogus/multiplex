#include "app_jobs_internal.h"

#include <gccore.h>
#include <malloc.h>
#include <ogc/lwp.h>
#include <ogc/lwp_watchdog.h>
#include <stdlib.h>
#include <string.h>

static void *allocate(void *context, size_t size, size_t alignment,
                      bool clear) {
  (void)context;
  if (size == 0) {
    return NULL;
  }
  void *memory = alignment > 1 ? memalign(alignment, size) : malloc(size);
  if (clear && memory != NULL) {
    memset(memory, 0, size);
  }
  return memory;
}

static void release(void *context, void *memory) {
  (void)context;
  free(memory);
}

static void scrub(void *context, void *memory, size_t size) {
  (void)context;
  volatile unsigned char *bytes = memory;
  for (size_t index = 0; index < size; ++index) {
    bytes[index] = 0;
  }
}

static bool launch(void *context, AppJobsThread *thread,
                   AppJobsThreadEntry entry, void *entry_context, void *stack,
                   size_t stack_size) {
  (void)context;
  lwp_t native = LWP_THREAD_NULL;
  if (LWP_CreateThread(&native, entry, entry_context, stack, stack_size,
                       LWP_PRIO_NORMAL / 2) != 0) {
    return false;
  }
  *thread = (uintptr_t)native;
  return true;
}

static void join(void *context, AppJobsThread *thread) {
  (void)context;
  if (*thread == 0) {
    return;
  }
  lwp_t native = (lwp_t)(uintptr_t)*thread;
  LWP_SetThreadPriority(native, LWP_PRIO_NORMAL + 1u);
  LWP_JoinThread(native, NULL);
  *thread = 0;
}

static void barrier(void *context) {
  (void)context;
  __sync_synchronize();
}

static void yield(void *context) {
  (void)context;
  LWP_YieldThread();
}

static uint32_t tick(void *context) {
  (void)context;
  return gettick();
}

static uint32_t elapsed_us(void *context, uint32_t started_tick) {
  (void)context;
  return (uint32_t)ticks_to_microsecs((uint32_t)(gettick() - started_tick));
}

const AppJobsPlatform *multiplex_app_jobs_platform_default(void) {
  static const AppJobsPlatform platform = {
      .memory =
          {
              .allocate = allocate,
              .release = release,
              .scrub = scrub,
          },
      .threads =
          {
              .launch = launch,
              .join = join,
              .barrier = barrier,
              .yield = yield,
          },
      .clock =
          {
              .tick = tick,
              .elapsed_us = elapsed_us,
          },
  };
  return &platform;
}
