#ifndef MULTIPLEX_APP_JOBS_TEST_SUPPORT_H
#define MULTIPLEX_APP_JOBS_TEST_SUPPORT_H

#include "app_jobs_internal.h"

#include <stddef.h>

#define APP_JOBS_TEST_MAX_ALLOCATIONS 128u
#define APP_JOBS_TEST_MAX_THREADS 32u
#define APP_JOBS_TEST_MAX_INPUTS 32u
#define APP_JOBS_TEST_MAX_EVENTS 128u

typedef struct AppJobsTestFixture AppJobsTestFixture;

struct MultiplexAppServices {
  AppJobsTestFixture *fixture;
};

struct MultiplexPresentation {
  AppJobsTestFixture *fixture;
};

struct MultiplexPlaybackSession {
  AppJobsTestFixture *fixture;
};

typedef struct {
  void *memory;
  size_t size;
  bool alive;
} AppJobsTestAllocation;

typedef struct {
  AppJobsThreadEntry entry;
  void *context;
  bool ran;
  bool joined;
} AppJobsTestThread;

struct AppJobsTestFixture {
  MultiplexAppServices services;
  MultiplexPresentation presentation;
  MultiplexPlaybackSession playback;
  AppJobsTestAllocation allocations[APP_JOBS_TEST_MAX_ALLOCATIONS];
  AppJobsTestThread threads[APP_JOBS_TEST_MAX_THREADS];
  MultiplexAppServicesInput inputs[APP_JOBS_TEST_MAX_INPUTS];
  char events[APP_JOBS_TEST_MAX_EVENTS];
  unsigned allocation_count;
  unsigned release_count;
  unsigned thread_count;
  unsigned input_count;
  unsigned event_count;
  unsigned fail_allocation_at;
  unsigned fail_launch_at;
  unsigned dispatch_work_count;
  unsigned fail_work_dispatch_at;
  unsigned work_runs[MULTIPLEX_APP_SERVICES_WORK_COUNT];
  MultiplexAppServicesWorkKind work_run_order[16];
  unsigned work_run_count;
  bool cache_snapshot_seen;
  bool result_alive_during_dispatch;
  bool poster_reuse_all;
  bool poster_decode_succeeds;
  unsigned poster_begin_count;
  unsigned poster_commit_count;
  unsigned poster_cancel_count;
  unsigned poster_copy_count;
  unsigned poster_scrub_count;
  unsigned poster_consumed_count;
  MultiplexPlaybackHlsPrefetchStatus prefetch_status;
  bool prefetch_retain_succeeds;
  bool prefetch_release_succeeds;
  unsigned prefetch_retain_count;
  unsigned prefetch_release_count;
  unsigned prefetch_discard_count;
  uint8_t poster_pixels[MULTIPLEX_GATEWAY_ARTWORK_ITEM_BYTES * 4u];
};

MultiplexAppServices *app_jobs_test_services(AppJobsTestFixture *fixture);
MultiplexPresentation *app_jobs_test_presentation(AppJobsTestFixture *fixture);
MultiplexPlaybackSession *app_jobs_test_playback(AppJobsTestFixture *fixture);
AppJobsPlatform app_jobs_test_platform(AppJobsTestFixture *fixture);
AppJobsReporter app_jobs_test_reporter(AppJobsTestFixture *fixture);
AppJobsTestFixture *app_jobs_test_current(void);
MultiplexAppJobs *app_jobs_test_create(AppJobsTestFixture *fixture);
MultiplexAppServicesWorkRequest
app_jobs_test_work_request(MultiplexAppServicesWorkKind kind, uint32_t token);
void app_jobs_test_record_work(MultiplexAppServicesWorkKind kind, void *output);
void app_jobs_test_complete_all_threads(AppJobsTestFixture *fixture);
unsigned app_jobs_test_count_inputs(const AppJobsTestFixture *fixture,
                                    MultiplexAppServicesInputKind kind);
void app_jobs_test_assert_no_leaks(const AppJobsTestFixture *fixture);

#endif
