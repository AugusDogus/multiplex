#include "app_jobs_internal.h"

void multiplex_app_jobs_prefetch_discard(MultiplexAppJobs *jobs) {
  multiplex_playback_session_discard_hls_prefetch(jobs->playback_session);
  jobs->prefetch = (AppJobsPrefetch){.kind = APP_JOBS_PREFETCH_IDLE};
}

static bool report_prefetch(MultiplexAppJobs *jobs, uint32_t token,
                            MultiplexAppServicesPrefetchResultKind kind) {
  const MultiplexAppServicesInput input = {
      .kind = MULTIPLEX_APP_SERVICES_INPUT_PREFETCH_RESULT,
      .payload.prefetch_result = {.token = token, .kind = kind},
  };
  return multiplex_app_jobs_report(jobs, &input);
}

bool multiplex_app_jobs_retain_prefetch(
    MultiplexAppJobs *jobs, uint32_t token,
    const MultiplexAppServicesHlsPrefetch *request) {
  if (jobs == NULL || request == NULL) {
    return false;
  }
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexPlaybackPrefetchRequest playback_request = {
      .credentials = request->credentials,
      .rating_key = request->rating_key,
      .offset_ms = request->offset_ms,
      .burn_subtitles = request->burn_subtitles,
      .subtitle_stream_index = request->subtitle_stream_index,
  };
  if (multiplex_playback_session_retain_hls_prefetch(jobs->playback_session,
                                                     &playback_request)) {
    jobs->prefetch = (AppJobsPrefetch){
        .kind = APP_JOBS_PREFETCH_RETAINING,
        .token = token,
    };
    return true;
  }
#endif
  return report_prefetch(jobs, token, MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);
}

bool multiplex_app_jobs_release_prefetch(MultiplexAppJobs *jobs,
                                         uint32_t token) {
  if (jobs == NULL) {
    return false;
  }
#if MULTIPLEX_PAIRING_ENABLED
  if (multiplex_playback_session_release_hls_prefetch(jobs->playback_session)) {
    jobs->prefetch = (AppJobsPrefetch){
        .kind = APP_JOBS_PREFETCH_RELEASING,
        .token = token,
    };
    return true;
  }
#endif
  return report_prefetch(jobs, token, MULTIPLEX_APP_SERVICES_PREFETCH_FAILED);
}

bool multiplex_app_jobs_poll_prefetch(MultiplexAppJobs *jobs) {
  if (jobs == NULL) {
    return false;
  }
  if (jobs->prefetch.kind == APP_JOBS_PREFETCH_IDLE) {
    return true;
  }
  const MultiplexPlaybackHlsPrefetchStatus status =
      multiplex_playback_session_hls_prefetch_status(jobs->playback_session);
  if ((jobs->prefetch.kind == APP_JOBS_PREFETCH_RETAINING &&
       status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_RETAINING) ||
      (jobs->prefetch.kind == APP_JOBS_PREFETCH_RELEASING &&
       status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_RELEASING)) {
    return true;
  }
  MultiplexAppServicesPrefetchResultKind result =
      MULTIPLEX_APP_SERVICES_PREFETCH_FAILED;
  if (jobs->prefetch.kind == APP_JOBS_PREFETCH_RETAINING &&
      status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_READY) {
    result = MULTIPLEX_APP_SERVICES_PREFETCH_READY;
  } else if (jobs->prefetch.kind == APP_JOBS_PREFETCH_RELEASING &&
             status == MULTIPLEX_PLAYBACK_HLS_PREFETCH_IDLE) {
    result = MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED;
  }
  const uint32_t token = jobs->prefetch.token;
  jobs->prefetch = (AppJobsPrefetch){.kind = APP_JOBS_PREFETCH_IDLE};
  return report_prefetch(jobs, token, result);
}
