#include "app_jobs_test_support.h"

#include <assert.h>

static MultiplexAppServicesPosterPlan poster_plan(uint32_t token,
                                                  uint16_t count) {
  return (MultiplexAppServicesPosterPlan){
      .token = token,
      .source = MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG,
      .item_count = count,
  };
}

static void test_poster_lifecycle_and_partial_launch_unwind(void) {
  AppJobsTestFixture failed = {.fail_launch_at = 3,
                               .poster_decode_succeeds = true};
  MultiplexAppJobs *failed_jobs = app_jobs_test_create(&failed);
  MultiplexAppServicesPosterPlan start = poster_plan(50, 4);
  assert(multiplex_app_jobs_start_posters(failed_jobs, &start));
  assert(failed.input_count == 1);
  assert(failed.inputs[0].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_FAILED);
  assert(failed.poster_scrub_count == 1);
  multiplex_app_jobs_destroy(&failed_jobs);
  assert(failed.poster_scrub_count == 1);
  app_jobs_test_assert_no_leaks(&failed);

  AppJobsTestFixture fixture = {.poster_decode_succeeds = true};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  start = poster_plan(51, 3);
  assert(multiplex_app_jobs_start_posters(jobs, &start));
  assert(fixture.inputs[0].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_STARTED);
  app_jobs_test_complete_all_threads(&fixture);
  assert(multiplex_app_jobs_poll_posters(jobs));
  assert(fixture.poster_consumed_count == 3);
  assert(fixture.inputs[1].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);
  assert(fixture.inputs[1].payload.poster_result.token == 51);
  assert(fixture.poster_scrub_count == 1);

  start = poster_plan(52, 2);
  assert(multiplex_app_jobs_start_posters(jobs, &start));
  assert(multiplex_app_jobs_quiesce_posters(jobs, 77));
  assert(fixture.inputs[fixture.input_count - 1u].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_QUIESCED);
  assert(fixture.inputs[fixture.input_count - 1u].payload.poster_result.token ==
         77);
  assert(multiplex_app_jobs_poll_posters(jobs));
  multiplex_app_jobs_destroy(&jobs);
  assert(fixture.poster_scrub_count == 2);
  app_jobs_test_assert_no_leaks(&fixture);
}

static void test_all_cached_posters_complete_immediately(void) {
  AppJobsTestFixture fixture = {.poster_reuse_all = true};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  MultiplexAppServicesPosterPlan start = poster_plan(61, 2);
  assert(multiplex_app_jobs_start_posters(jobs, &start));
  assert(fixture.input_count == 2);
  assert(fixture.inputs[0].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_STARTED);
  assert(fixture.inputs[1].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);
  assert(fixture.poster_scrub_count == 1);
  multiplex_app_jobs_destroy(&jobs);
  assert(fixture.poster_scrub_count == 1);
  app_jobs_test_assert_no_leaks(&fixture);
}

void app_jobs_test_run_posters(void) {
  test_poster_lifecycle_and_partial_launch_unwind();
  test_all_cached_posters_complete_immediately();
}
