#include "app_services_internal.h"

#include <string.h>

void multiplex_app_services_scheduler_initialize(
    MultiplexAppServicesScheduler *scheduler) {
  memset(scheduler, 0, sizeof(*scheduler));
  scheduler->foreground.kind = MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE;
  scheduler->posters.kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE;
}

static bool queue_poster_start(MultiplexAppServices *services,
                               const MultiplexAppServicesPosterPlan *plan) {
  const MultiplexAppServicesEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_POSTER_START,
      .payload.poster_start = *plan,
  };
  return multiplex_app_services_queue(services, &effect);
}

static bool domain_queued(const MultiplexAppServices *services,
                          MultiplexAppServicesForegroundDomain domain) {
  switch (domain) {
  case MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH:
    return multiplex_app_services_watch_has_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK:
    return multiplex_app_services_playback_has_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS:
    return multiplex_app_services_details_has_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY:
    return multiplex_app_services_discovery_has_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG:
    return multiplex_app_services_catalog_has_queued(services);
  }
  return false;
}

static MultiplexAppServicesDomainScheduleResult
schedule_domain(MultiplexAppServices *services,
                MultiplexAppServicesForegroundDomain domain) {
  switch (domain) {
  case MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH:
    return multiplex_app_services_watch_schedule_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK:
    return multiplex_app_services_playback_schedule_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS:
    return multiplex_app_services_details_schedule_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY:
    return multiplex_app_services_discovery_schedule_queued(services);
  case MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG:
    return multiplex_app_services_catalog_schedule_queued(services);
  }
  return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
}

typedef enum {
  MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_NONE = 0,
  MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_PRESENT = 1,
} MultiplexAppServicesDomainSelectionKind;

typedef struct {
  MultiplexAppServicesDomainSelectionKind kind;
  union {
    MultiplexAppServicesForegroundDomain domain;
  } value;
} MultiplexAppServicesDomainSelection;

static MultiplexAppServicesDomainSelection
select_pending_domain(const MultiplexAppServices *services) {
  static const MultiplexAppServicesForegroundDomain priority[] = {
      MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH,
      MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK,
      MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS,
      MULTIPLEX_APP_SERVICES_FOREGROUND_DISCOVERY,
      MULTIPLEX_APP_SERVICES_FOREGROUND_CATALOG,
  };
  for (size_t index = 0; index < sizeof(priority) / sizeof(priority[0]);
       ++index) {
    if (domain_queued(services, priority[index])) {
      return (MultiplexAppServicesDomainSelection){
          .kind = MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_PRESENT,
          .value.domain = priority[index],
      };
    }
  }
  return (MultiplexAppServicesDomainSelection){
      .kind = MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_NONE,
  };
}

static bool foreground_waiting(const MultiplexAppServices *services) {
  return services->scheduler.foreground.kind !=
             MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE ||
         select_pending_domain(services).kind ==
             MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_PRESENT;
}

static bool poster_focus_eligible(const MultiplexAppServices *services) {
  if (services->focus.kind != MULTIPLEX_APP_SERVICES_FOCUS_PRESENT) {
    return false;
  }
  const MultiplexAppServicesScreen screen = services->focus.value.view.screen;
  return screen == MULTIPLEX_APP_SERVICES_SCREEN_HOME ||
         screen == MULTIPLEX_APP_SERVICES_SCREEN_BROWSE ||
         screen == MULTIPLEX_APP_SERVICES_SCREEN_SEARCH;
}

static bool playback_session_active(const MultiplexAppServices *services) {
  return services->content.playback.kind ==
             MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN &&
         services->content.playback.value.view.rating_key != 0;
}

static bool posters_eligible(const MultiplexAppServices *services) {
  return poster_focus_eligible(services) && !playback_session_active(services);
}

static bool start_queued_posters(MultiplexAppServices *services) {
  MultiplexAppServicesPosterSlot *slot = &services->scheduler.posters;
  const MultiplexAppServicesPosterPlan plan = slot->state.queued.plan;
  slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING;
  slot->state.starting.plan = plan;
  slot->state.starting.latest.kind = MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE;
  return queue_poster_start(services, &plan);
}

bool multiplex_app_services_scheduler_run(MultiplexAppServices *services) {
  if (services == NULL) {
    return false;
  }
  for (;;) {
    if (!posters_eligible(services) &&
        (services->scheduler.posters.kind ==
             MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING ||
         services->scheduler.posters.kind ==
             MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING)) {
      return multiplex_app_services_scheduler_quiesce_posters(services);
    }
    MultiplexAppServicesForegroundScheduler *foreground =
        &services->scheduler.foreground;
    if (foreground->kind == MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE) {
      return true;
    }
    MultiplexAppServicesDomainSelection selection = {
        .kind = MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_NONE,
    };
    if (foreground->kind == MULTIPLEX_APP_SERVICES_FOREGROUND_PENDING) {
      if (!domain_queued(services, foreground->state.pending.domain)) {
        foreground->kind = MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE;
      } else {
        selection = (MultiplexAppServicesDomainSelection){
            .kind = MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_PRESENT,
            .value.domain = foreground->state.pending.domain,
        };
      }
    }
    if (foreground->kind == MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE) {
      selection = select_pending_domain(services);
      if (selection.kind == MULTIPLEX_APP_SERVICES_DOMAIN_SELECTION_NONE) {
        return services->scheduler.posters.kind ==
                           MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED &&
                       posters_eligible(services)
                   ? start_queued_posters(services)
                   : true;
      }
    }
    const MultiplexAppServicesForegroundDomain domain = selection.value.domain;
    MultiplexAppServicesPosterSlot *slot = &services->scheduler.posters;
    if (slot->kind != MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE &&
        slot->kind != MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED) {
      foreground->kind = MULTIPLEX_APP_SERVICES_FOREGROUND_PENDING;
      foreground->state.pending.domain = domain;
      return multiplex_app_services_scheduler_quiesce_posters(services);
    }
    foreground->kind = MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE;
    foreground->state.active.domain = domain;
    const MultiplexAppServicesDomainScheduleResult scheduled =
        schedule_domain(services, domain);
    if (scheduled == MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED) {
      return true;
    }
    foreground->kind = MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE;
    if (scheduled != MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED) {
      return false;
    }
  }
}

bool multiplex_app_services_scheduler_start_posters(
    MultiplexAppServices *services,
    const MultiplexAppServicesPosterPlan *plan) {
  MultiplexAppServicesPosterSlot *slot = &services->scheduler.posters;
  if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE) {
    if (foreground_waiting(services) || !posters_eligible(services)) {
      slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED;
      slot->state.queued.plan = *plan;
      return true;
    }
    slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING;
    slot->state.starting.plan = *plan;
    slot->state.starting.latest.kind =
        MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE;
    return queue_poster_start(services, plan);
  }
  if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED) {
    slot->state.queued.plan = *plan;
    return true;
  }
  MultiplexAppServicesPosterLatest *latest =
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING
          ? &slot->state.starting.latest
      : slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING
          ? &slot->state.running.latest
          : &slot->state.quiescing.latest;
  latest->kind = MULTIPLEX_APP_SERVICES_POSTER_LATEST_PRESENT;
  latest->value.plan = *plan;
  return multiplex_app_services_scheduler_quiesce_posters(services);
}

bool multiplex_app_services_scheduler_quiesce_posters(
    MultiplexAppServices *services) {
  MultiplexAppServicesPosterSlot *slot = &services->scheduler.posters;
  if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE ||
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED ||
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUIESCING) {
    return true;
  }
  const MultiplexAppServicesPosterPlan *active =
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING
          ? &slot->state.starting.plan
          : &slot->state.running.plan;
  const MultiplexAppServicesPosterLatest latest =
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING
          ? slot->state.starting.latest
          : slot->state.running.latest;
  const MultiplexAppServicesEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_POSTER_QUIESCE,
      .payload.poster_quiesce = {.token = active->token},
  };
  slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUIESCING;
  slot->state.quiescing.active_plan = *active;
  slot->state.quiescing.latest = latest;
  return multiplex_app_services_queue(services, &effect);
}

bool multiplex_app_services_scheduler_apply_poster_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPosterResult *result) {
  MultiplexAppServicesPosterSlot *slot = &services->scheduler.posters;
  if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE ||
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED) {
    return true;
  }
  MultiplexAppServicesPosterPlan active_plan = {0};
  MultiplexAppServicesPosterLatest latest = {
      .kind = MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE,
  };
  if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING) {
    active_plan = slot->state.starting.plan;
    latest = slot->state.starting.latest;
  } else if (slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING) {
    active_plan = slot->state.running.plan;
    latest = slot->state.running.latest;
  } else {
    active_plan = slot->state.quiescing.active_plan;
    latest = slot->state.quiescing.latest;
  }
  if (result->token != active_plan.token) {
    return true;
  }
  if (result->kind == MULTIPLEX_APP_SERVICES_POSTER_STARTED &&
      slot->kind == MULTIPLEX_APP_SERVICES_POSTER_SLOT_STARTING) {
    const MultiplexAppServicesPosterPlan plan = slot->state.starting.plan;
    slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_RUNNING;
    slot->state.running.plan = plan;
    slot->state.running.latest = latest;
    return true;
  }
  if (result->kind == MULTIPLEX_APP_SERVICES_POSTER_COMPLETED ||
      result->kind == MULTIPLEX_APP_SERVICES_POSTER_QUIESCED ||
      result->kind == MULTIPLEX_APP_SERVICES_POSTER_FAILED) {
    slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_IDLE;
    MultiplexAppServicesPosterLatest candidate = latest;
    if (result->kind == MULTIPLEX_APP_SERVICES_POSTER_QUIESCED &&
        candidate.kind == MULTIPLEX_APP_SERVICES_POSTER_LATEST_NONE) {
      candidate = (MultiplexAppServicesPosterLatest){
          .kind = MULTIPLEX_APP_SERVICES_POSTER_LATEST_PRESENT,
          .value.plan = active_plan,
      };
    }
    if (candidate.kind != MULTIPLEX_APP_SERVICES_POSTER_LATEST_PRESENT) {
      return true;
    }
    if (foreground_waiting(services) || !posters_eligible(services)) {
      slot->kind = MULTIPLEX_APP_SERVICES_POSTER_SLOT_QUEUED;
      slot->state.queued.plan = candidate.value.plan;
      return true;
    }
    return multiplex_app_services_scheduler_start_posters(
        services, &candidate.value.plan);
  }
  return true;
}

void multiplex_app_services_scheduler_finish_foreground(
    MultiplexAppServices *services,
    MultiplexAppServicesForegroundDomain domain) {
  MultiplexAppServicesForegroundScheduler *foreground =
      &services->scheduler.foreground;
  if (foreground->kind == MULTIPLEX_APP_SERVICES_FOREGROUND_ACTIVE &&
      foreground->state.active.domain == domain) {
    foreground->kind = MULTIPLEX_APP_SERVICES_FOREGROUND_IDLE;
  }
}
