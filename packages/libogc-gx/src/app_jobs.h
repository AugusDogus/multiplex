#ifndef MULTIPLEX_APP_JOBS_H
#define MULTIPLEX_APP_JOBS_H

#include "app_services.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct MultiplexAppJobs MultiplexAppJobs;
typedef struct MultiplexPresentation MultiplexPresentation;
typedef struct MultiplexPlaybackSession MultiplexPlaybackSession;

MultiplexAppJobs *
multiplex_app_jobs_create(MultiplexAppServices *services,
                          MultiplexPresentation *presentation,
                          MultiplexPlaybackSession *playback_session);
void multiplex_app_jobs_destroy(MultiplexAppJobs **jobs);

bool multiplex_app_jobs_start_work(
    MultiplexAppJobs *jobs, const MultiplexAppServicesWorkRequest *request);
bool multiplex_app_jobs_start_posters(
    MultiplexAppJobs *jobs, const MultiplexAppServicesPosterPlan *plan);
bool multiplex_app_jobs_quiesce_posters(MultiplexAppJobs *jobs, uint32_t token);
bool multiplex_app_jobs_quiesce_storage(MultiplexAppJobs *jobs, uint32_t token);
bool multiplex_app_jobs_quiesce_runtime(MultiplexAppJobs *jobs, uint32_t token);
bool multiplex_app_jobs_retain_prefetch(
    MultiplexAppJobs *jobs, uint32_t token,
    const MultiplexAppServicesHlsPrefetch *request);
bool multiplex_app_jobs_release_prefetch(MultiplexAppJobs *jobs,
                                         uint32_t token);
bool multiplex_app_jobs_poll_prefetch(MultiplexAppJobs *jobs);
bool multiplex_app_jobs_poll_posters(MultiplexAppJobs *jobs);
bool multiplex_app_jobs_poll_work(MultiplexAppJobs *jobs, uint64_t now_ms);
bool multiplex_app_jobs_work_running(const MultiplexAppJobs *jobs,
                                     MultiplexAppServicesWorkKind kind);

#endif
