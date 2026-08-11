#include "app_jobs_internal.h"

void SYS_Report(const char *message, ...) __attribute__((format(printf, 1, 2)));

bool multiplex_app_jobs_report(MultiplexAppJobs *jobs,
                               const MultiplexAppServicesInput *input) {
  return jobs->reporter.report(jobs->reporter.context, input);
}

static bool report_to_app_services(void *context,
                                   const MultiplexAppServicesInput *input) {
  MultiplexAppServices *services = context;
  const MultiplexAppServicesDispatchResult result =
      multiplex_app_services_dispatch(services, input);
  if (result == MULTIPLEX_APP_SERVICES_DISPATCH_READY) {
    return true;
  }
  SYS_Report("REFERENCE GX: app services dispatch failed result=%u input=%u\n",
             (unsigned)result, (unsigned)input->kind);
  return false;
}

MultiplexAppJobs *multiplex_app_jobs_create_with_platform(
    MultiplexAppServices *services, MultiplexPresentation *presentation,
    MultiplexPlaybackSession *playback_session, const AppJobsPlatform *platform,
    const AppJobsReporter *reporter) {
  if (services == NULL || presentation == NULL || playback_session == NULL ||
      platform == NULL || platform->memory.allocate == NULL ||
      platform->memory.release == NULL || platform->memory.scrub == NULL ||
      platform->threads.launch == NULL || platform->threads.join == NULL ||
      platform->threads.barrier == NULL || platform->threads.yield == NULL ||
      platform->clock.tick == NULL || platform->clock.elapsed_us == NULL ||
      reporter == NULL || reporter->report == NULL) {
    return NULL;
  }
  MultiplexAppJobs *jobs = platform->memory.allocate(platform->memory.context,
                                                     sizeof(*jobs), 1, true);
  if (jobs == NULL) {
    return NULL;
  }
  jobs->services = services;
  jobs->presentation = presentation;
  jobs->playback_session = playback_session;
  jobs->platform = *platform;
  jobs->reporter = *reporter;
#if MULTIPLEX_PAIRING_ENABLED
  jobs->posters.owner = jobs;
#endif
  return jobs;
}

MultiplexAppJobs *
multiplex_app_jobs_create(MultiplexAppServices *services,
                          MultiplexPresentation *presentation,
                          MultiplexPlaybackSession *playback_session) {
  const AppJobsReporter reporter = {
      .context = services,
      .report = report_to_app_services,
  };
  return multiplex_app_jobs_create_with_platform(
      services, presentation, playback_session,
      multiplex_app_jobs_platform_default(), &reporter);
}

void multiplex_app_jobs_destroy(MultiplexAppJobs **jobs) {
  if (jobs == NULL || *jobs == NULL) {
    return;
  }
  MultiplexAppJobs *owned = *jobs;
  multiplex_app_jobs_prefetch_discard(owned);
  multiplex_app_jobs_work_release_all(owned);
  multiplex_app_jobs_posters_stop(owned);
  owned->platform.memory.release(owned->platform.memory.context, owned);
  *jobs = NULL;
}

bool multiplex_app_jobs_quiesce_storage(MultiplexAppJobs *jobs,
                                        uint32_t token) {
  if (jobs == NULL) {
    return false;
  }
  multiplex_app_jobs_work_release(
      jobs, MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE);
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_STORAGE_QUIESCED,
      .payload.reset_storage_quiesced = {.token = token},
  };
  return multiplex_app_jobs_report(jobs, &input);
}

bool multiplex_app_jobs_quiesce_runtime(MultiplexAppJobs *jobs,
                                        uint32_t token) {
  if (jobs == NULL) {
    return false;
  }
  multiplex_app_jobs_posters_stop(jobs);
  multiplex_app_jobs_prefetch_discard(jobs);
  multiplex_app_jobs_work_release_all(jobs);
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_RESET_RUNTIME_QUIESCED,
      .payload.reset_runtime_quiesced = {.token = token},
  };
  return multiplex_app_jobs_report(jobs, &input);
}
