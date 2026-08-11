#ifndef MULTIPLEX_APP_SERVICES_SCHEDULER_H
#define MULTIPLEX_APP_SERVICES_SCHEDULER_H

#include "app_services_contract.h"

typedef struct MultiplexAppServices MultiplexAppServices;

typedef enum {
  MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG = 0,
  MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY = 1,
  MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS = 2,
  MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK = 3,
  MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH = 4,
} MultiplexAppServicesForegroundDomain;

typedef enum {
  MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE = 0,
  MULTIPLEX_APP_SERVICES_FOREGROUND_PENDING = 1,
  MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE = 2,
} MultiplexAppServicesForegroundKind;

typedef struct {
  MultiplexAppServicesForegroundKind kind;
  union {
    struct {
      MultiplexAppServicesForegroundDomain domain;
    } pending;
    struct {
      MultiplexAppServicesForegroundDomain domain;
    } active;
  } state;
} MultiplexAppServicesForegroundScheduler;

typedef enum {
  MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED = 0,
  MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED = 1,
  MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED = 2,
} MultiplexAppServicesDomainScheduleResult;

typedef enum {
  MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE = 0,
  MULTIPLEX_APP_SERVICES_POSTER_LATEST_PRESENT = 1,
} MultiplexAppServicesPosterLatestKind;

typedef struct {
  MultiplexAppServicesPosterLatestKind kind;
  union {
    MultiplexAppServicesPosterPlan plan;
  } value;
} MultiplexAppServicesPosterLatest;

typedef enum {
  MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE = 0,
  MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED = 1,
  MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING = 2,
  MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING = 3,
  MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUIESCING = 4,
} MultiplexAppServicesPosterSlotKind;

typedef struct {
  MultiplexAppServicesPosterSlotKind kind;
  union {
    struct {
      MultiplexAppServicesPosterPlan plan;
    } queued;
    struct {
      MultiplexAppServicesPosterPlan plan;
      MultiplexAppServicesPosterLatest latest;
    } starting;
    struct {
      MultiplexAppServicesPosterPlan plan;
      MultiplexAppServicesPosterLatest latest;
    } running;
    struct {
      MultiplexAppServicesPosterPlan active_plan;
      MultiplexAppServicesPosterLatest latest;
    } quiescing;
  } state;
} MultiplexAppServicesPosterSlot;

typedef struct {
  MultiplexAppServicesForegroundScheduler foreground;
  MultiplexAppServicesPosterSlot posters;
} MultiplexAppServicesScheduler;

void multiplex_app_services_scheduler_initialize(
    MultiplexAppServicesScheduler *scheduler);
bool multiplex_app_services_scheduler_run(MultiplexAppServices *services);
bool multiplex_app_services_scheduler_apply_poster_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPosterResult *result);
bool multiplex_app_services_scheduler_start_posters(
    MultiplexAppServices *services, const MultiplexAppServicesPosterPlan *plan);
bool multiplex_app_services_scheduler_quiesce_posters(
    MultiplexAppServices *services);
void multiplex_app_services_scheduler_finish_foreground(
    MultiplexAppServices *services,
    MultiplexAppServicesForegroundDomain domain);

bool multiplex_app_services_catalog_has_queued(
    const MultiplexAppServices *services);
MultiplexAppServicesDomainScheduleResult
multiplex_app_services_catalog_schedule_queued(MultiplexAppServices *services);
bool multiplex_app_services_discovery_has_queued(
    const MultiplexAppServices *services);
MultiplexAppServicesDomainScheduleResult
multiplex_app_services_discovery_schedule_queued(
    MultiplexAppServices *services);
bool multiplex_app_services_details_has_queued(
    const MultiplexAppServices *services);
MultiplexAppServicesDomainScheduleResult
multiplex_app_services_details_schedule_queued(MultiplexAppServices *services);
bool multiplex_app_services_playback_has_queued(
    const MultiplexAppServices *services);
MultiplexAppServicesDomainScheduleResult
multiplex_app_services_playback_schedule_queued(MultiplexAppServices *services);
bool multiplex_app_services_watch_has_queued(
    const MultiplexAppServices *services);
MultiplexAppServicesDomainScheduleResult
multiplex_app_services_watch_schedule_queued(MultiplexAppServices *services);

#endif
