#include "app_jobs_test_support.h"

#include <assert.h>

static MultiplexAppServicesHlsPrefetch prefetch_request(void) {
  return (MultiplexAppServicesHlsPrefetch){.rating_key = 42};
}

static void test_prefetch_correlation_exactly_once(void) {
  AppJobsTestFixture fixture = {.prefetch_retain_succeeds = true,
                                .prefetch_release_succeeds = true,
                                .prefetch_status =
                                    MULTIPLEX_PLAYBACK_HLS_PREFETCH_RETAINING};
  MultiplexAppJobs *jobs = app_jobs_test_create(&fixture);
  MultiplexAppServicesHlsPrefetch retain = prefetch_request();
  assert(multiplex_app_jobs_retain_prefetch(jobs, 70, &retain));
  assert(multiplex_app_jobs_poll_prefetch(jobs));
  assert(fixture.input_count == 0);
  fixture.prefetch_status = MULTIPLEX_PLAYBACK_HLS_PREFETCH_READY;
  assert(multiplex_app_jobs_poll_prefetch(jobs));
  assert(multiplex_app_jobs_poll_prefetch(jobs));
  assert(fixture.input_count == 1);
  assert(fixture.inputs[0].payload.prefetch_result.token == 70);
  assert(fixture.inputs[0].payload.prefetch_result.kind ==
         MULTIPLEX_APP_SERVICES_PREFETCH_READY);

  fixture.prefetch_status = MULTIPLEX_PLAYBACK_HLS_PREFETCH_IDLE;
  assert(multiplex_app_jobs_release_prefetch(jobs, 71));
  assert(multiplex_app_jobs_poll_prefetch(jobs));
  assert(fixture.inputs[1].payload.prefetch_result.kind ==
         MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED);

  fixture.prefetch_status = MULTIPLEX_PLAYBACK_HLS_PREFETCH_FAILED;
  assert(multiplex_app_jobs_retain_prefetch(jobs, 70, &retain));
  assert(multiplex_app_jobs_poll_prefetch(jobs));
  assert(fixture.inputs[2].payload.prefetch_result.kind ==
         MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);

  assert(multiplex_app_jobs_retain_prefetch(jobs, 70, &retain));
  const unsigned before_destroy = fixture.input_count;
  multiplex_app_jobs_destroy(&jobs);
  assert(fixture.input_count == before_destroy);
  assert(fixture.prefetch_discard_count == 1);
  app_jobs_test_assert_no_leaks(&fixture);
}

void app_jobs_test_run_prefetch(void) {
  test_prefetch_correlation_exactly_once();
}
