#include "app_jobs_internal.h"

#include "catalog_cache.h"
#include "gateway_client.h"
#include "media-source.h"
#include "memory_card_auth.h"
#include "plex_catalog.h"
#include "trpc_client.h"

#include <string.h>

#define WORK_STACK_SIZE (256u * 1024u)
#define CACHE_SAVE_STACK_SIZE (128u * 1024u)

typedef struct {
  MultiplexTrpcRoomList rooms;
  MultiplexTrpcInviteeList invitees;
  uint32_t user_id;
  bool user_available;
  bool rooms_available;
  bool invitees_available;
} AppJobsStartupDataResult;

typedef bool (*AppJobsWorkPrepare)(MultiplexAppJobs *jobs, AppJobsWork *work);
typedef bool (*AppJobsWorkExecute)(AppJobsWork *work);
typedef void (*AppJobsWorkProject)(MultiplexAppServicesInput *input,
                                   const AppJobsWork *work);

struct AppJobsWorkSpec {
  MultiplexAppServicesWorkKind kind;
  size_t output_size;
  size_t stack_size;
  bool supported;
  AppJobsWorkPrepare prepare;
  AppJobsWorkExecute execute;
  AppJobsWorkProject project;
};

static bool prepare_none(MultiplexAppJobs *jobs, AppJobsWork *work) {
  (void)jobs;
  (void)work;
  return true;
}

static bool prepare_cache_save(MultiplexAppJobs *jobs, AppJobsWork *work) {
  return multiplex_app_services_copy_cache_save_plan(
      jobs->services, &work->request, &work->cache_location, work->output,
      work->spec->output_size);
}

static bool execute_catalog(AppJobsWork *work) {
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&work->cancellation);
#if MULTIPLEX_PAIRING_ENABLED
  return multiplex_plex_load_catalog_cancellable(
      &work->request.payload.catalog.credentials, work->output, &cancellation);
#else
  return multiplex_gateway_load_catalog_cancellable(
      MULTIPLEX_GATEWAY_URL, work->output, &cancellation);
#endif
}

static bool execute_cache_save(AppJobsWork *work) {
#if MULTIPLEX_PAIRING_ENABLED
  return multiplex_memory_card_save_cache(&work->cache_location, work->output,
                                          MULTIPLEX_CATALOG_CACHE_SIZE) ==
         MULTIPLEX_MEMORY_CARD_OK;
#else
  (void)work;
  return false;
#endif
}

static bool execute_startup_data(AppJobsWork *work) {
#if MULTIPLEX_PAIRING_ENABLED
  AppJobsStartupDataResult *result = work->output;
  const MultiplexAuthCredentials *credentials =
      &work->request.payload.startup_data.credentials;
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&work->cancellation);
  result->user_available = multiplex_trpc_load_user_id_cancellable(
      credentials->origin, credentials->session_token, &result->user_id,
      &cancellation);
  if (multiplex_http_cancellation_requested(&cancellation)) {
    return false;
  }
  result->rooms_available =
      multiplex_trpc_load_watch_together_rooms_cancellable(
          MULTIPLEX_BASE_URL, credentials->session_token, &result->rooms,
          &cancellation);
  if (multiplex_http_cancellation_requested(&cancellation)) {
    return false;
  }
  result->invitees_available =
      multiplex_trpc_load_watch_together_invitees_cancellable(
          MULTIPLEX_BASE_URL, credentials->session_token, &result->invitees,
          &cancellation);
  return !multiplex_http_cancellation_requested(&cancellation);
#else
  (void)work;
  return false;
#endif
}

static bool execute_browse(AppJobsWork *work) {
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&work->cancellation);
#if MULTIPLEX_PAIRING_ENABLED
  return multiplex_plex_load_browse_cancellable(
      &work->request.payload.browse.credentials,
      &work->request.payload.browse.library, work->request.payload.browse.start,
      work->output, &cancellation);
#else
  return multiplex_gateway_load_browse_cancellable(
      MULTIPLEX_GATEWAY_URL, work->request.payload.browse.library.section_id,
      work->request.payload.browse.start, work->output, &cancellation);
#endif
}

static bool execute_search(AppJobsWork *work) {
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&work->cancellation);
#if MULTIPLEX_PAIRING_ENABLED
  return multiplex_plex_load_search_cancellable(
      &work->request.payload.search.credentials,
      work->request.payload.search.query,
      work->request.payload.search.query_length, work->output, &cancellation);
#else
  return multiplex_gateway_load_search_cancellable(
      MULTIPLEX_GATEWAY_URL, work->request.payload.search.query,
      work->request.payload.search.query_length, work->output, &cancellation);
#endif
}

static bool execute_details(AppJobsWork *work) {
  const MultiplexHttpCancellation cancellation =
      multiplex_app_jobs_http_cancellation(&work->cancellation);
#if MULTIPLEX_PAIRING_ENABLED
  return multiplex_plex_load_details_cancellable(
      &work->request.payload.details.credentials,
      work->request.payload.details.rating_key, work->output, &cancellation);
#else
  return multiplex_gateway_load_details_cancellable(
      MULTIPLEX_GATEWAY_URL, work->request.payload.details.rating_key,
      work->output, &cancellation);
#endif
}

static void project_catalog(MultiplexAppServicesInput *input,
                            const AppJobsWork *work) {
  input->payload.work_result.payload.catalog.catalog = work->output;
}

static void project_cache_save(MultiplexAppServicesInput *input,
                               const AppJobsWork *work) {
  (void)input;
  (void)work;
}

static void project_startup_data(MultiplexAppServicesInput *input,
                                 const AppJobsWork *work) {
  const AppJobsStartupDataResult *result = work->output;
  input->payload.work_result.payload.startup_data =
      (MultiplexAppServicesStartupDataResultView){
          .user =
              {
                  .kind = result->user_available
                              ? MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT
                              : MULTIPLEX_APP_SERVICES_STARTUP_USER_NONE,
                  .value.id = result->user_id,
              },
          .rooms = result->rooms_available ? &result->rooms : NULL,
          .invitees = result->invitees_available ? &result->invitees : NULL,
      };
}

static void project_browse(MultiplexAppServicesInput *input,
                           const AppJobsWork *work) {
  input->payload.work_result.payload.browse.page = work->output;
}

static void project_search(MultiplexAppServicesInput *input,
                           const AppJobsWork *work) {
  input->payload.work_result.payload.search.page = work->output;
}

static void project_details(MultiplexAppServicesInput *input,
                            const AppJobsWork *work) {
  input->payload.work_result.payload.details.details = work->output;
}

#if MULTIPLEX_PAIRING_ENABLED
#define APP_JOBS_CACHE_SAVE_SUPPORTED true
#define APP_JOBS_STARTUP_DATA_SUPPORTED true
#else
#define APP_JOBS_CACHE_SAVE_SUPPORTED false
#define APP_JOBS_STARTUP_DATA_SUPPORTED false
#endif

#define APP_JOBS_WORK_SPEC_LIST(X)                                             \
  X(CATALOG, MultiplexGatewayCatalog, WORK_STACK_SIZE, true, prepare_none,     \
    execute_catalog, project_catalog)                                          \
  X(CATALOG_CACHE_SAVE, uint8_t[MULTIPLEX_CATALOG_CACHE_SIZE],                 \
    CACHE_SAVE_STACK_SIZE, APP_JOBS_CACHE_SAVE_SUPPORTED, prepare_cache_save,  \
    execute_cache_save, project_cache_save)                                    \
  X(STARTUP_DATA, AppJobsStartupDataResult, WORK_STACK_SIZE,                   \
    APP_JOBS_STARTUP_DATA_SUPPORTED, prepare_none, execute_startup_data,       \
    project_startup_data)                                                      \
  X(BROWSE, MultiplexGatewayBrowsePage, WORK_STACK_SIZE, true, prepare_none,   \
    execute_browse, project_browse)                                            \
  X(SEARCH, MultiplexGatewaySearchPage, WORK_STACK_SIZE, true, prepare_none,   \
    execute_search, project_search)                                            \
  X(DETAILS, MultiplexGatewayDetails, WORK_STACK_SIZE, true, prepare_none,     \
    execute_details, project_details)

#define APP_JOBS_COUNT_SPEC(name, output_type, stack_bytes, is_supported,      \
                            prepare_fn, execute_fn, project_fn)                \
  +1
enum {
  APP_JOBS_WORK_SPEC_COUNT = 0 APP_JOBS_WORK_SPEC_LIST(APP_JOBS_COUNT_SPEC)
};
#undef APP_JOBS_COUNT_SPEC

#define APP_JOBS_DEFINE_SPEC(name, output_type, stack_bytes, is_supported,     \
                             prepare_fn, execute_fn, project_fn)               \
  [MULTIPLEX_APP_SERVICES_WORK_##name] = {                                     \
      .kind = MULTIPLEX_APP_SERVICES_WORK_##name,                              \
      .output_size = sizeof(output_type),                                      \
      .stack_size = stack_bytes,                                               \
      .supported = is_supported,                                               \
      .prepare = prepare_fn,                                                   \
      .execute = execute_fn,                                                   \
      .project = project_fn,                                                   \
  },
static const AppJobsWorkSpec WORK_SPECS[MULTIPLEX_APP_SERVICES_WORK_COUNT] = {
    APP_JOBS_WORK_SPEC_LIST(APP_JOBS_DEFINE_SPEC)};
#undef APP_JOBS_DEFINE_SPEC

_Static_assert((int)APP_JOBS_WORK_SPEC_COUNT ==
                   (int)MULTIPLEX_APP_SERVICES_WORK_COUNT,
               "work specification must cover every work kind");
_Static_assert(sizeof(WORK_SPECS) / sizeof(WORK_SPECS[0]) ==
                   MULTIPLEX_APP_SERVICES_WORK_COUNT,
               "work specification index must match the work enum");

static void *run_work(void *context) {
  AppJobsWork *work = context;
  MultiplexAppJobs *jobs = work->owner;
  work->succeeded = work->spec->execute(work);
  jobs->platform.threads.barrier(jobs->platform.threads.context);
  work->complete = true;
  return NULL;
}

static void release_work(MultiplexAppJobs *jobs, AppJobsWork *work) {
  if (work->thread != 0) {
    jobs->platform.threads.join(jobs->platform.threads.context, &work->thread);
  }
  jobs->platform.memory.release(jobs->platform.memory.context, work->stack);
  jobs->platform.memory.release(jobs->platform.memory.context, work->output);
  memset(work, 0, sizeof(*work));
}

bool multiplex_app_jobs_start_work(
    MultiplexAppJobs *jobs, const MultiplexAppServicesWorkRequest *request) {
  if (jobs == NULL || request == NULL ||
      (unsigned)request->kind >= MULTIPLEX_APP_SERVICES_WORK_COUNT) {
    return false;
  }
  const AppJobsWorkSpec *spec = &WORK_SPECS[request->kind];
  AppJobsWork *work = &jobs->work[spec->kind];
  if (!spec->supported || work->started) {
    return false;
  }
  work->owner = jobs;
  work->spec = spec;
  work->request = *request;
  work->output = jobs->platform.memory.allocate(jobs->platform.memory.context,
                                                spec->output_size, 1, true);
  work->stack = jobs->platform.memory.allocate(jobs->platform.memory.context,
                                               spec->stack_size, 1, false);
  if (work->output == NULL || work->stack == NULL ||
      !spec->prepare(jobs, work) ||
      !jobs->platform.threads.launch(jobs->platform.threads.context,
                                     &work->thread, run_work, work, work->stack,
                                     spec->stack_size)) {
    release_work(jobs, work);
    return false;
  }
  work->started = true;
  return true;
}

bool multiplex_app_jobs_poll_work(MultiplexAppJobs *jobs, uint64_t now_ms) {
  if (jobs == NULL) {
    return false;
  }
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    AppJobsWork *work = &jobs->work[index];
    if (!work->started || !work->complete) {
      continue;
    }
    jobs->platform.threads.barrier(jobs->platform.threads.context);
    if (work->cancellation.requested) {
      release_work(jobs, work);
      continue;
    }
    jobs->platform.threads.join(jobs->platform.threads.context, &work->thread);
    MultiplexAppServicesInput input = {
        .kind = MULTIPLEX_APP_SERVICES_INPUT_WORK_RESULT_VIEW,
        .payload.work_result =
            {
                .token = work->request.token,
                .kind = work->spec->kind,
                .succeeded = work->succeeded,
                .now_ms = now_ms,
            },
    };
    work->spec->project(&input, work);
    const bool reported = multiplex_app_jobs_report(jobs, &input);
    release_work(jobs, work);
    if (!reported) {
      return false;
    }
  }
  return true;
}

bool multiplex_app_jobs_work_running(const MultiplexAppJobs *jobs,
                                     MultiplexAppServicesWorkKind kind) {
  return jobs != NULL && (unsigned)kind < MULTIPLEX_APP_SERVICES_WORK_COUNT &&
         jobs->work[kind].started && !jobs->work[kind].complete;
}

void multiplex_app_jobs_work_release_all(MultiplexAppJobs *jobs) {
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    release_work(jobs, &jobs->work[index]);
  }
}

void multiplex_app_jobs_work_cancel_all(MultiplexAppJobs *jobs) {
  for (unsigned index = 0; index < MULTIPLEX_APP_SERVICES_WORK_COUNT; ++index) {
    AppJobsWork *work = &jobs->work[index];
    if (work->started &&
        work->spec->kind != MULTIPLEX_APP_SERVICES_WORK_CATALOG_CACHE_SAVE) {
      multiplex_app_jobs_cancellation_request(&work->cancellation);
    }
  }
}

void multiplex_app_jobs_work_release(MultiplexAppJobs *jobs,
                                     MultiplexAppServicesWorkKind kind) {
  if (jobs != NULL && (unsigned)kind < MULTIPLEX_APP_SERVICES_WORK_COUNT) {
    release_work(jobs, &jobs->work[kind]);
  }
}
