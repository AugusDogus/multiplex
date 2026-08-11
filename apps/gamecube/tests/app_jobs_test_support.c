#include "app_jobs_test_support.h"

#include <assert.h>
#include <stdlib.h>
#include <string.h>

static AppJobsTestFixture *current_fixture;
static AppJobsPlatform default_platform;

MultiplexAppServices *app_jobs_test_services(AppJobsTestFixture *fixture) {
  return &fixture->services;
}

MultiplexPresentation *app_jobs_test_presentation(AppJobsTestFixture *fixture) {
  return &fixture->presentation;
}

MultiplexPlaybackSession *app_jobs_test_playback(AppJobsTestFixture *fixture) {
  return &fixture->playback;
}

AppJobsTestFixture *app_jobs_test_current(void) {
  assert(current_fixture != NULL);
  return current_fixture;
}

static void record_event(AppJobsTestFixture *fixture, char value) {
  assert(fixture->event_count < APP_JOBS_TEST_MAX_EVENTS);
  fixture->events[fixture->event_count++] = value;
}

static void *allocate(void *context, size_t size, size_t alignment,
                      bool clear) {
  AppJobsTestFixture *fixture = context;
  (void)alignment;
  fixture->allocation_count += 1;
  if (fixture->fail_allocation_at == fixture->allocation_count) {
    return NULL;
  }
  assert(fixture->allocation_count <= APP_JOBS_TEST_MAX_ALLOCATIONS);
  void *memory = clear ? calloc(1, size) : malloc(size);
  assert(memory != NULL);
  fixture->allocations[fixture->allocation_count - 1u] =
      (AppJobsTestAllocation){.memory = memory, .size = size, .alive = true};
  return memory;
}

static void release(void *context, void *memory) {
  AppJobsTestFixture *fixture = context;
  if (memory == NULL) {
    return;
  }
  for (unsigned index = 0; index < fixture->allocation_count; ++index) {
    AppJobsTestAllocation *allocation = &fixture->allocations[index];
    if (allocation->memory == memory && allocation->alive) {
      allocation->alive = false;
      fixture->release_count += 1;
      free(memory);
      return;
    }
  }
  assert(false);
}

static bool memory_alive(const AppJobsTestFixture *fixture,
                         const void *memory) {
  for (unsigned index = 0; index < fixture->allocation_count; ++index) {
    if (fixture->allocations[index].memory == memory &&
        fixture->allocations[index].alive) {
      return true;
    }
  }
  return false;
}

static bool launch(void *context, AppJobsThread *thread,
                   AppJobsThreadEntry entry, void *entry_context, void *stack,
                   size_t stack_size) {
  AppJobsTestFixture *fixture = context;
  (void)stack;
  (void)stack_size;
  fixture->thread_count += 1;
  if (fixture->fail_launch_at == fixture->thread_count) {
    return false;
  }
  assert(fixture->thread_count < APP_JOBS_TEST_MAX_THREADS);
  *thread = fixture->thread_count;
  fixture->threads[*thread] =
      (AppJobsTestThread){.entry = entry, .context = entry_context};
  return true;
}

static void run_thread(AppJobsTestFixture *fixture, AppJobsThread thread) {
  assert(thread != 0 && thread < APP_JOBS_TEST_MAX_THREADS);
  AppJobsTestThread *fake = &fixture->threads[thread];
  assert(fake->entry != NULL);
  if (!fake->ran) {
    fake->ran = true;
    fake->entry(fake->context);
  }
}

static void join(void *context, AppJobsThread *thread) {
  AppJobsTestFixture *fixture = context;
  if (*thread == 0) {
    return;
  }
  record_event(fixture, 'J');
  run_thread(fixture, *thread);
  fixture->threads[*thread].joined = true;
  *thread = 0;
}

static void barrier(void *context) { (void)context; }
static void yield(void *context) { (void)context; }
static uint32_t tick(void *context) {
  (void)context;
  return 10;
}
static uint32_t elapsed_us(void *context, uint32_t started_tick) {
  (void)context;
  return 20u - started_tick;
}

static void scrub(void *context, void *memory, size_t size) {
  AppJobsTestFixture *fixture = context;
  memset(memory, 0, size);
  fixture->poster_scrub_count += 1;
  record_event(fixture, 'C');
}

AppJobsPlatform app_jobs_test_platform(AppJobsTestFixture *fixture) {
  return (AppJobsPlatform){
      .memory =
          {
              .context = fixture,
              .allocate = allocate,
              .release = release,
              .scrub = scrub,
          },
      .threads =
          {
              .context = fixture,
              .launch = launch,
              .join = join,
              .barrier = barrier,
              .yield = yield,
          },
      .clock =
          {
              .context = fixture,
              .tick = tick,
              .elapsed_us = elapsed_us,
          },
  };
}

static const void *work_result_pointer(const MultiplexAppServicesInput *input) {
  switch (input->payload.work_result.kind) {
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG:
    return input->payload.work_result.payload.catalog.catalog;
  case MULTIPLEX_APP_SERVICES_WORK_BROWSE:
    return input->payload.work_result.payload.browse.page;
  case MULTIPLEX_APP_SERVICES_WORK_SEARCH:
    return input->payload.work_result.payload.search.page;
  case MULTIPLEX_APP_SERVICES_WORK_DETAILS:
    return input->payload.work_result.payload.details.details;
  case MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA:
    return input->payload.work_result.payload.startup_data.rooms;
  case MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE:
  case MULTIPLEX_APP_SERVICES_WORK_COUNT:
    return NULL;
  }
  return NULL;
}

static bool report(void *context, const MultiplexAppServicesInput *input) {
  AppJobsTestFixture *fixture = context;
  assert(fixture->input_count < APP_JOBS_TEST_MAX_INPUTS);
  fixture->inputs[fixture->input_count++] = *input;
  if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW) {
    record_event(fixture, 'W');
    fixture->dispatch_work_count += 1;
    const void *result = work_result_pointer(input);
    if (result != NULL) {
      fixture->result_alive_during_dispatch = memory_alive(fixture, result);
    }
    return fixture->fail_work_dispatch_at != fixture->dispatch_work_count;
  }
  if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED) {
    record_event(fixture, 'S');
  } else if (input->kind ==
             MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED) {
    record_event(fixture, 'R');
  } else if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_POSTER_RESULT) {
    record_event(fixture, 'P');
  } else if (input->kind == MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT) {
    record_event(fixture, 'F');
  }
  return true;
}

AppJobsReporter app_jobs_test_reporter(AppJobsTestFixture *fixture) {
  return (AppJobsReporter){.context = fixture, .report = report};
}

const AppJobsPlatform *multiplex_app_jobs_platform_default(void) {
  return &default_platform;
}

MultiplexAppJobs *app_jobs_test_create(AppJobsTestFixture *fixture) {
  fixture->services.fixture = fixture;
  fixture->presentation.fixture = fixture;
  fixture->playback.fixture = fixture;
  current_fixture = fixture;
  default_platform = app_jobs_test_platform(fixture);
  const AppJobsReporter reporter = app_jobs_test_reporter(fixture);
  return multiplex_app_jobs_create_with_platform(
      app_jobs_test_services(fixture), app_jobs_test_presentation(fixture),
      app_jobs_test_playback(fixture), &default_platform, &reporter);
}

MultiplexAppServicesWorkRequest
app_jobs_test_work_request(MultiplexAppServicesWorkKind kind, uint32_t token) {
  return (MultiplexAppServicesWorkRequest){.token = token, .kind = kind};
}

void app_jobs_test_record_work(MultiplexAppServicesWorkKind kind,
                               void *output) {
  AppJobsTestFixture *fixture = app_jobs_test_current();
  fixture->work_runs[kind] += 1;
  fixture->work_run_order[fixture->work_run_count++] = kind;
  memset(output, (int)kind + 1, 1);
}

void app_jobs_test_complete_all_threads(AppJobsTestFixture *fixture) {
  for (AppJobsThread thread = 1; thread <= fixture->thread_count; ++thread) {
    run_thread(fixture, thread);
  }
}

unsigned app_jobs_test_count_inputs(const AppJobsTestFixture *fixture,
                                    MultiplexAppServicesInputKind kind) {
  unsigned count = 0;
  for (unsigned index = 0; index < fixture->input_count; ++index) {
    count += fixture->inputs[index].kind == kind;
  }
  return count;
}

void app_jobs_test_assert_no_leaks(const AppJobsTestFixture *fixture) {
  for (unsigned index = 0; index < fixture->allocation_count; ++index) {
    assert(!fixture->allocations[index].alive);
  }
}
