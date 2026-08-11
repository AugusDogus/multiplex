#include "app_jobs_test_support.h"

#include <assert.h>

static void test_work_slots_order_snapshot_and_reuse(void) {
  AppJobsTestFixture fixture = {.poster_decode_succeeds = true};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  assert(jobs != NULL);
  MultiplexAppServicesWorkRequest catalog =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_CATALOG, 10);
  MultiplexAppServicesWorkRequest details =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_DETAILS, 60);
  assert(multiplex_app_jobs_start_work(jobs, &details));
  assert(multiplex_app_jobs_start_work(jobs, &catalog));
  assert(!multiplex_app_jobs_start_work(jobs, &catalog));
  assert(multiplex_app_jobs_work_running(jobs,
                                         MULTIPLEX_APP_SERVICES_WORK_CATALOG));
  app_jobs_test_complete_all_threads(&fixture);
  assert(multiplex_app_jobs_poll_work(jobs, 99));
  assert(fixture.input_count == 2);
  assert(fixture.inputs[0].payload.work_result.kind ==
         MULTIPLEX_APP_SERVICES_WORK_CATALOG);
  assert(fixture.inputs[1].payload.work_result.kind ==
         MULTIPLEX_APP_SERVICES_WORK_DETAILS);
  assert(fixture.result_alive_during_dispatch);
  assert(multiplex_app_jobs_start_work(jobs, &catalog));

  MultiplexAppServicesWorkRequest cache = app_jobs_test_work_request(
      MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE, 20);
  assert(multiplex_app_jobs_start_work(jobs, &cache));
  app_jobs_test_complete_all_threads(&fixture);
  assert(fixture.cache_snapshot_seen);
  assert(multiplex_app_jobs_poll_work(jobs, 100));
  multiplex_app_jobs_destroy(&jobs);
  assert(jobs == NULL);
  app_jobs_test_assert_no_leaks(&fixture);
}

static void test_poll_stops_after_first_dispatch_failure(void) {
  AppJobsTestFixture fixture = {.fail_work_dispatch_at = 1};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  MultiplexAppServicesWorkRequest catalog =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_CATALOG, 1);
  MultiplexAppServicesWorkRequest browse =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_BROWSE, 2);
  assert(multiplex_app_jobs_start_work(jobs, &catalog));
  assert(multiplex_app_jobs_start_work(jobs, &browse));
  app_jobs_test_complete_all_threads(&fixture);
  assert(!multiplex_app_jobs_poll_work(jobs, 5));
  assert(fixture.dispatch_work_count == 1);
  fixture.fail_work_dispatch_at = 0;
  assert(multiplex_app_jobs_poll_work(jobs, 6));
  assert(fixture.dispatch_work_count == 2);
  multiplex_app_jobs_destroy(&jobs);
  app_jobs_test_assert_no_leaks(&fixture);
}

static void test_quiesce_order_and_late_result_suppression(void) {
  AppJobsTestFixture fixture = {.prefetch_retain_succeeds = true,
                                .poster_decode_succeeds = true};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  MultiplexAppServicesWorkRequest catalog =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_CATALOG, 1);
  MultiplexAppServicesWorkRequest cache = app_jobs_test_work_request(
      MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE, 2);
  assert(multiplex_app_jobs_start_work(jobs, &catalog));
  assert(multiplex_app_jobs_start_work(jobs, &cache));
  assert(multiplex_app_jobs_quiesce_storage(jobs, 90));
  assert(fixture.events[fixture.event_count - 2u] == 'J');
  assert(fixture.events[fixture.event_count - 1u] == 'S');
  assert(multiplex_app_jobs_work_running(jobs,
                                         MULTIPLEX_APP_SERVICES_WORK_CATALOG));
  assert(!multiplex_app_jobs_work_running(
      jobs, MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE));

  const MultiplexAppServicesPosterPlan posters = {
      .token = 80,
      .source = MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG,
      .item_count = 1,
  };
  assert(multiplex_app_jobs_start_posters(jobs, &posters));
  const MultiplexAppServicesHlsPrefetch prefetch = {.rating_key = 42};
  assert(multiplex_app_jobs_retain_prefetch(jobs, 81, &prefetch));
  const unsigned before = fixture.input_count;
  const unsigned events_before = fixture.event_count;
  assert(multiplex_app_jobs_quiesce_runtime(jobs, 91));
  assert(fixture.prefetch_discard_count == 1);
  assert(fixture.event_count == events_before + 5u);
  assert(fixture.events[events_before] == 'J');
  assert(fixture.events[events_before + 1u] == 'C');
  assert(fixture.events[events_before + 2u] == 'D');
  assert(fixture.events[events_before + 3u] == 'J');
  assert(fixture.events[events_before + 4u] == 'R');
  assert(fixture.input_count == before + 1u);
  assert(fixture.inputs[before].kind ==
         MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED);
  assert(app_jobs_test_count_inputs(
             &fixture, MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW) == 0);
  multiplex_app_jobs_destroy(&jobs);
  app_jobs_test_assert_no_leaks(&fixture);
}

void app_jobs_test_run_work(void) {
  test_work_slots_order_snapshot_and_reuse();
  test_poll_stops_after_first_dispatch_failure();
  test_quiesce_order_and_late_result_suppression();
}
