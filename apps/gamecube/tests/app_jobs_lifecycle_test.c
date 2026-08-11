#include "app_jobs_test_support.h"

#include <assert.h>

static void test_create_destroy_failures(void) {
  AppJobsTestFixture failed = {.fail_allocation_at = 1};
  const AppJobsPlatform failed_platform = app_jobs_test_platform(&failed);
  const AppJobsReporter failed_reporter = app_jobs_test_reporter(&failed);
  assert(multiplex_app_jobs_create_with_platform(
             app_jobs_test_services(&failed),
             app_jobs_test_presentation(&failed),
             app_jobs_test_playback(&failed), &failed_platform,
             &failed_reporter) == NULL);
  assert(failed.release_count == 0);

  AppJobsTestFixture fixture = {0};
  const AppJobsPlatform platform = app_jobs_test_platform(&fixture);
  const AppJobsReporter reporter = app_jobs_test_reporter(&fixture);
  assert(multiplex_app_jobs_create_with_platform(
             NULL, app_jobs_test_presentation(&fixture),
             app_jobs_test_playback(&fixture), &platform, &reporter) == NULL);
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  assert(jobs != NULL);
  assert(!multiplex_app_jobs_start_work(jobs, NULL));
  assert(!multiplex_app_jobs_retain_prefetch(jobs, 1, NULL));
  multiplex_app_jobs_destroy(&jobs);
  multiplex_app_jobs_destroy(&jobs);
  multiplex_app_jobs_destroy(NULL);
  app_jobs_test_assert_no_leaks(&fixture);
}

void app_jobs_test_run_lifecycle(void) { test_create_destroy_failures(); }
