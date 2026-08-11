#include "app_jobs_test_support.h"

#include <assert.h>
#include <stdio.h>

int main(void) {
  AppJobsTestFixture fixture = {.poster_decode_succeeds = true};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  assert(jobs != NULL);

  MultiplexAppServicesWorkRequest details =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_DETAILS, 2);
  MultiplexAppServicesWorkRequest catalog =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_CATALOG, 1);
  assert(multiplex_app_jobs_start_work(jobs, &details));
  assert(multiplex_app_jobs_start_work(jobs, &catalog));
  assert(!multiplex_app_jobs_start_work(jobs, &catalog));
  MultiplexAppServicesWorkRequest cache = app_jobs_test_work_request(
      MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE, 3);
  MultiplexAppServicesWorkRequest startup =
      app_jobs_test_work_request(MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA, 4);
  assert(!multiplex_app_jobs_start_work(jobs, &cache));
  assert(!multiplex_app_jobs_start_work(jobs, &startup));
  app_jobs_test_complete_all_threads(&fixture);
  assert(multiplex_app_jobs_poll_work(jobs, 10));
  assert(fixture.inputs[0].payload.work_result.kind ==
         MULTIPLEX_APP_SERVICES_WORK_CATALOG);
  assert(fixture.inputs[1].payload.work_result.kind ==
         MULTIPLEX_APP_SERVICES_WORK_DETAILS);

  const MultiplexAppServicesPosterPlan posters = {
      .token = 20,
      .source = MULTIPLEX_APP_SERVICES_POSTER_SOURCE_CATALOG,
      .item_count = 2,
  };
  const unsigned before_posters = fixture.input_count;
  assert(multiplex_app_jobs_start_posters(jobs, &posters));
  assert(fixture.inputs[before_posters].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_STARTED);
  assert(fixture.inputs[before_posters + 1u].payload.poster_result.kind ==
         MULTIPLEX_APP_SERVICES_POSTER_COMPLETED);

  const MultiplexAppServicesHlsPrefetch prefetch = {.rating_key = 42};
  const unsigned before_prefetch = fixture.input_count;
  assert(multiplex_app_jobs_retain_prefetch(jobs, 30, &prefetch));
  assert(multiplex_app_jobs_release_prefetch(jobs, 31));
  assert(fixture.inputs[before_prefetch].payload.prefetch_result.kind ==
         MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);
  assert(fixture.inputs[before_prefetch + 1u].payload.prefetch_result.kind ==
         MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);

  assert(multiplex_app_jobs_quiesce_posters(jobs, 40));
  assert(multiplex_app_jobs_quiesce_storage(jobs, 41));
  assert(multiplex_app_jobs_quiesce_runtime(jobs, 42));
  multiplex_app_jobs_destroy(&jobs);
  app_jobs_test_assert_no_leaks(&fixture);
  puts("app jobs pairing-disabled tests passed");
  return 0;
}
