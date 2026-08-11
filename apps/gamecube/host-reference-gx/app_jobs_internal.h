#ifndef MULTIPLEX_APP_JOBS_INTERNAL_H
#define MULTIPLEX_APP_JOBS_INTERNAL_H

#include "media-source.h"

#include "app_jobs.h"
#include "http_cancellation.h"
#include "playback_session.h"
#include "presentation_posters.h"

#include <stddef.h>

typedef uintptr_t AppJobsThread;
typedef void *(*AppJobsThreadEntry)(void *context);

typedef struct {
  void *context;
  void *(*allocate)(void *context, size_t size, size_t alignment, bool clear);
  void (*release)(void *context, void *memory);
  void (*scrub)(void *context, void *memory, size_t size);
} AppJobsMemory;

typedef struct {
  void *context;
  bool (*launch)(void *context, AppJobsThread *thread, AppJobsThreadEntry entry,
                 void *entry_context, void *stack, size_t stack_size);
  void (*join)(void *context, AppJobsThread *thread);
  void (*barrier)(void *context);
  void (*yield)(void *context);
} AppJobsThreads;

typedef struct {
  void *context;
  uint32_t (*tick)(void *context);
  uint32_t (*elapsed_us)(void *context, uint32_t started_tick);
} AppJobsClock;

typedef struct {
  AppJobsMemory memory;
  AppJobsThreads threads;
  AppJobsClock clock;
} AppJobsPlatform;

typedef struct {
  void *context;
  bool (*report)(void *context, const MultiplexAppServicesInput *input);
} AppJobsReporter;

typedef struct AppJobsWorkSpec AppJobsWorkSpec;

typedef struct {
  volatile bool requested;
} AppJobsCancellation;

typedef struct {
  struct MultiplexAppJobs *owner;
  const AppJobsWorkSpec *spec;
  MultiplexAppServicesWorkRequest request;
  MultiplexMemoryCardLocation cache_location;
  AppJobsThread thread;
  void *stack;
  void *output;
  AppJobsCancellation cancellation;
  volatile bool complete;
  bool started;
  bool succeeded;
} AppJobsWork;

typedef enum {
  APP_JOBS_PREFETCH_IDLE = 0,
  APP_JOBS_PREFETCH_RETAINING,
  APP_JOBS_PREFETCH_RELEASING,
} AppJobsPrefetchKind;

typedef struct {
  AppJobsPrefetchKind kind;
  uint32_t token;
} AppJobsPrefetch;

#if MULTIPLEX_PAIRING_ENABLED
#define APP_JOBS_POSTER_LOADER_LANE_COUNT 4u

typedef struct AppJobsPosters AppJobsPosters;

typedef struct {
  AppJobsPosters *posters;
  uint16_t lane;
} AppJobsPosterWorker;

struct AppJobsPosters {
  struct MultiplexAppJobs *owner;
  uint32_t token;
  MultiplexAuthCredentials credentials;
  MultiplexGatewayItem items[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  uint16_t texture_slots[MULTIPLEX_GATEWAY_MAX_TOTAL_ITEMS];
  AppJobsThread threads[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  void *stacks[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  uint8_t *encoded[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  uint8_t *decoded_pixels[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  AppJobsPosterWorker workers[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  volatile bool item_ready[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  volatile bool item_decoded[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  volatile bool complete[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  volatile bool stopping;
  AppJobsCancellation cancellation;
  bool pending;
  bool credentials_held;
  volatile uint16_t item_index[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  volatile uint16_t decoded_count[APP_JOBS_POSTER_LOADER_LANE_COUNT];
  uint16_t lane_count;
  uint16_t item_count;
  uint16_t requested_count;
  uint16_t cache_hits;
  uint16_t texture_offset;
  uint32_t started_tick;
  bool first_ready_reported;
  volatile bool failed;
};
#endif

struct MultiplexAppJobs {
  MultiplexAppServices *services;
  MultiplexPresentation *presentation;
  MultiplexPlaybackSession *playback_session;
  AppJobsPlatform platform;
  AppJobsReporter reporter;
  AppJobsWork work[MULTIPLEX_APP_SERVICES_WORK_COUNT];
#if MULTIPLEX_PAIRING_ENABLED
  AppJobsPosters posters;
#endif
  AppJobsPrefetch prefetch;
};

bool multiplex_app_jobs_report(MultiplexAppJobs *jobs,
                               const MultiplexAppServicesInput *input);
void multiplex_app_jobs_work_release_all(MultiplexAppJobs *jobs);
void multiplex_app_jobs_work_cancel_all(MultiplexAppJobs *jobs);
void multiplex_app_jobs_work_release(MultiplexAppJobs *jobs,
                                     MultiplexAppServicesWorkKind kind);
void multiplex_app_jobs_prefetch_discard(MultiplexAppJobs *jobs);
void multiplex_app_jobs_posters_stop(MultiplexAppJobs *jobs);
void multiplex_app_jobs_posters_cancel(MultiplexAppJobs *jobs);
void multiplex_app_jobs_cancellation_request(AppJobsCancellation *state);
bool multiplex_app_jobs_cancellation_requested(void *context);
MultiplexHttpCancellation
multiplex_app_jobs_http_cancellation(AppJobsCancellation *state);

MultiplexAppJobs *multiplex_app_jobs_create_with_platform(
    MultiplexAppServices *services, MultiplexPresentation *presentation,
    MultiplexPlaybackSession *playback_session, const AppJobsPlatform *platform,
    const AppJobsReporter *reporter);
const AppJobsPlatform *multiplex_app_jobs_platform_default(void);

#endif
