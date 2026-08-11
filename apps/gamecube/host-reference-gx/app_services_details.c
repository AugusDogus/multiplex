#include "app_services_internal.h"
#include "app_services_playback_resolution.h"
#include "app_services_request_slots.h"

#include "media-source.h"
#include "native_ui.h"
#include "plex_catalog.h"

#include <stdio.h>
#include <string.h>

#define DETAILS_PREFETCH_DELAY_MS 250u

static MultiplexAppServicesDetailsPrefetchTarget no_prefetch_target(void) {
  return (MultiplexAppServicesDetailsPrefetchTarget){
      .kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_NONE,
  };
}

static MultiplexAppServicesDetailsPrefetchTarget
prefetch_target(MultiplexAppServices *services,
                const MultiplexGatewayDetails *details) {
  MultiplexAppServicesDetailsPrefetchTarget target = no_prefetch_target();
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL || details == NULL || details->rating_key == 0 ||
      details->duration_ms == 0) {
    return target;
  }
  bool burn_subtitles = false;
  uint32_t subtitle_stream_index = 0;
  for (uint8_t index = 0; index < details->subtitle_stream_count; ++index) {
    if (details->subtitle_streams[index].selected &&
        details->subtitle_streams[index].has_index) {
      burn_subtitles = true;
      subtitle_stream_index = details->subtitle_streams[index].index;
      break;
    }
  }
  target.kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT;
  target.value.prefetch = (MultiplexAppServicesDetailsPrefetchRequest){
      .rating_key = details->rating_key,
      .offset_ms = details->view_offset_ms < details->duration_ms
                       ? details->view_offset_ms
                       : 0,
      .burn_subtitles = burn_subtitles,
      .subtitle_stream_index = subtitle_stream_index,
  };
#else
  (void)services;
  (void)details;
#endif
  return target;
}

static bool
same_prefetch(const MultiplexAppServicesDetailsPrefetchRequest *left,
              const MultiplexAppServicesDetailsPrefetchRequest *right) {
  return left->rating_key == right->rating_key &&
         left->offset_ms == right->offset_ms &&
         left->burn_subtitles == right->burn_subtitles &&
         (!left->burn_subtitles ||
          left->subtitle_stream_index == right->subtitle_stream_index);
}

static void
set_prefetch_target(MultiplexAppServicesDetailsPrefetch *prefetch,
                    MultiplexAppServicesDetailsPrefetchTarget target) {
  switch (prefetch->kind) {
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE:
    if (target.kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT) {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED;
      prefetch->state.retain_queued.prefetch = target.value.prefetch;
    }
    return;
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED:
    if (target.kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_NONE) {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE;
    } else {
      prefetch->state.retain_queued.prefetch = target.value.prefetch;
    }
    return;
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINING:
    prefetch->state.retaining.desired = target;
    return;
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINED:
    if (target.kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT &&
        same_prefetch(&prefetch->state.retained.active,
                      &target.value.prefetch)) {
      return;
    }
    prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED;
    prefetch->state.release_queued.desired = target;
    return;
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED:
    prefetch->state.release_queued.desired = target;
    return;
  case MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASING:
    prefetch->state.releasing.desired = target;
    return;
  }
}

static bool bind_details(const MultiplexGatewayDetails *details) {
  char facts[MULTIPLEX_GATEWAY_DETAIL_SHORT_CAPACITY] = {0};
  char hierarchy[48] = {0};
  uint16_t secondary_length = 0;
  uint32_t hierarchy_length = 0;
  if (!multiplex_app_services_playback_resolution_format_episode(
          details, &secondary_length, hierarchy, sizeof(hierarchy),
          &hierarchy_length)) {
    return false;
  }
  const uint32_t minutes =
      details->duration_ms == 0 ? 0 : (details->duration_ms + 30000u) / 60000u;
  int facts_length = 0;
  if (details->year != 0 && minutes != 0 && details->rating_tenths != 0) {
    facts_length = snprintf(
        facts, sizeof(facts), "%u - %u min - %u.%u/10", details->year, minutes,
        details->rating_tenths / 10u, details->rating_tenths % 10u);
  } else if (details->year != 0 && minutes != 0) {
    facts_length =
        snprintf(facts, sizeof(facts), "%u - %u min", details->year, minutes);
  } else if (minutes != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u min", minutes);
  } else if (details->year != 0) {
    facts_length = snprintf(facts, sizeof(facts), "%u", details->year);
  }
  if (facts_length < 0 || (size_t)facts_length >= sizeof(facts)) {
    return false;
  }
  return multiplex_native_app_details_commit(
             (const uint8_t *)details->title, details->title_length,
             (const uint8_t *)details->secondary, secondary_length,
             (const uint8_t *)hierarchy, hierarchy_length,
             (const uint8_t *)details->media_type, details->media_type_length,
             (const uint8_t *)details->library, details->library_length,
             (const uint8_t *)details->content_rating,
             details->content_rating_length, (const uint8_t *)facts,
             (uint32_t)facts_length, (const uint8_t *)details->summary,
             details->summary_length, (const uint8_t *)details->genres,
             details->genres_length, (const uint8_t *)details->directors,
             details->directors_length, (details->flags & 1u) != 0) != 0 &&
         multiplex_app_services_playback_resolution_bind_subtitles(details);
}

static bool bind_children(uint32_t rating_key,
                          const MultiplexGatewayChildrenPage *page) {
  if (multiplex_native_app_details_children_begin(
          rating_key, page->start, page->total_size, page->item_count) == 0) {
    return false;
  }
  for (uint16_t index = 0; index < page->item_count; ++index) {
    const MultiplexGatewayItem *item = &page->items[index];
    if (multiplex_native_app_details_child(
            index, item->rating_key, (const uint8_t *)item->title,
            item->title_length, (const uint8_t *)item->subtitle,
            item->subtitle_length, item->artwork_slot, item->duration_ms,
            item->view_offset_ms, item->progress_percent) == 0) {
      return false;
    }
  }
  return multiplex_native_app_details_children_commit() != 0;
}

static MultiplexAppServicesDomainScheduleResult
schedule_queued_details(MultiplexAppServices *services) {
  const MultiplexAppServicesDetailsRequest *queued =
      multiplex_app_services_details_slot_queued(&services->content.details);
  if (queued == NULL) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesDetailsRequest requested = *queued;
  MultiplexAppServicesWorkRequest request = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_WORK_DETAILS,
      .payload.details = {.rating_key = requested.rating_key},
  };
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_PLEX) {
    const MultiplexAuthCredentials *credentials =
        multiplex_app_services_auth_credentials(services);
    if (credentials == NULL) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    request.payload.details.credentials = *credentials;
  }
  if (!multiplex_app_services_queue_work(services, &request) ||
      !multiplex_app_services_details_slot_activate(&services->content.details,
                                                    request.token)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  if (requested.purpose == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND) {
    multiplex_app_services_queue_network_activity(services, true);
  }
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

static bool request_details_work(MultiplexAppServices *services,
                                 uint32_t rating_key,
                                 MultiplexAppServicesDetailsPurpose purpose) {
  if (rating_key == 0) {
    return true;
  }
  const MultiplexAppServicesDetailsRequest request = {
      .rating_key = rating_key,
      .purpose = purpose,
  };
  const MultiplexAppServicesDetailsRequestEffect effect =
      multiplex_app_services_details_slot_request(&services->content.details,
                                                  &request);
  if (effect == MULTIPLEX_APP_SERVICES_DETAILS_REQUEST_CACHED) {
    const MultiplexGatewayDetails *details =
        multiplex_app_services_details_slot_retained_result(
            &services->content.details);
    if (details == NULL || !bind_details(details)) {
      return false;
    }
    set_prefetch_target(&services->content.details_prefetch,
                        prefetch_target(services, details));
    return true;
  }
  return true;
}

bool multiplex_app_services_details_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL &&
         (services->content.details_prefetch.kind ==
              MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED ||
          services->content.details_prefetch.kind ==
              MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED ||
          services->content.details_action.kind ==
              MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED ||
          multiplex_app_services_details_slot_queued(
              &services->content.details) != NULL);
}

static bool apply_children_action(MultiplexAppServices *services,
                                  uint32_t rating_key, uint16_t start) {
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY) {
    return true;
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL || rating_key == 0) {
    return false;
  }
  MultiplexGatewayChildrenPage page;
  if (!multiplex_plex_load_children(credentials, rating_key, start, &page)) {
    memset(&page, 0, sizeof(page));
    page.version = 1;
    page.start = start;
  }
  return bind_children(rating_key, &page);
}

static bool apply_mark_watched_action(MultiplexAppServices *services,
                                      uint32_t rating_key) {
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  const bool marked = MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
                          MULTIPLEX_APP_SERVICES_BACKEND_PLEX &&
                      credentials != NULL && rating_key != 0 &&
                      multiplex_plex_mark_watched(credentials, rating_key);
  return multiplex_native_app_mark_watched_commit(marked ? 1u : 0u) != 0 &&
         multiplex_app_services_queue_refresh(services, true);
}

static MultiplexAppServicesDomainScheduleResult
schedule_details_action(MultiplexAppServices *services) {
  MultiplexAppServicesDetailsActionSlot *slot =
      &services->content.details_action;
  if (slot->kind != MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesDetailsAction action = slot->state.queued.action;
  slot->kind = MULTIPLEX_APP_SERVICES_DETAILS_ACTION_IDLE;
  bool applied = false;
  switch (action.kind) {
  case MULTIPLEX_APP_SERVICES_DETAILS_ACTION_CHILDREN:
    applied =
        apply_children_action(services, action.payload.children.rating_key,
                              action.payload.children.start);
    break;
  case MULTIPLEX_APP_SERVICES_DETAILS_ACTION_MARK_WATCHED:
    applied = apply_mark_watched_action(services,
                                        action.payload.mark_watched.rating_key);
    break;
  }
  return applied ? MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED
                 : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
}

static MultiplexAppServicesDomainScheduleResult
schedule_prefetch(MultiplexAppServices *services) {
  MultiplexAppServicesDetailsPrefetch *prefetch =
      &services->content.details_prefetch;
  const uint32_t token = multiplex_app_services_next_token(services);
  if (prefetch->kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED) {
    const MultiplexAppServicesDetailsPrefetchRequest requested =
        prefetch->state.retain_queued.prefetch;
    const MultiplexAuthCredentials *credentials =
        multiplex_app_services_auth_credentials(services);
    if (credentials == NULL) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    const MultiplexAppServicesPlaybackEffect effect = {
        .token = token,
        .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RETAIN_HLS,
        .payload.hls_prefetch =
            {
                .credentials = *credentials,
                .rating_key = requested.rating_key,
                .offset_ms = requested.offset_ms,
                .burn_subtitles = requested.burn_subtitles,
                .subtitle_stream_index = requested.subtitle_stream_index,
            },
    };
    if (!multiplex_app_services_queue_playback(services, &effect)) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINING;
    prefetch->state.retaining.token = token;
    prefetch->state.retaining.active = requested;
    prefetch->state.retaining.desired =
        (MultiplexAppServicesDetailsPrefetchTarget){
            .kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT,
            .value.prefetch = requested,
        };
    return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
  }
  if (prefetch->kind ==
      MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED) {
    const MultiplexAppServicesDetailsPrefetchTarget desired =
        prefetch->state.release_queued.desired;
    const MultiplexAppServicesPlaybackEffect effect = {
        .token = token,
        .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_PREFETCH_RELEASE_HLS,
    };
    if (!multiplex_app_services_queue_playback(services, &effect)) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASING;
    prefetch->state.releasing.token = token;
    prefetch->state.releasing.desired = desired;
    return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
  }
  return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_details_schedule_queued(MultiplexAppServices *services) {
  if (services->content.details_prefetch.kind ==
          MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED ||
      services->content.details_prefetch.kind ==
          MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED) {
    return schedule_prefetch(services);
  }
  if (services->content.details_action.kind ==
      MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED) {
    return schedule_details_action(services);
  }
  return multiplex_app_services_details_slot_queued(
             &services->content.details) != NULL
             ? schedule_queued_details(services)
             : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
}

bool multiplex_app_services_details_request_details(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsPayload *request) {
  return request_details_work(services, request->rating_key,
                              MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND);
}

bool multiplex_app_services_details_request_children(
    MultiplexAppServices *services,
    const MultiplexAppServicesDetailsChildrenPayload *request) {
  services->content.details_action.kind =
      MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED;
  services->content.details_action.state.queued.action =
      (MultiplexAppServicesDetailsAction){
          .kind = MULTIPLEX_APP_SERVICES_DETAILS_ACTION_CHILDREN,
          .payload.children =
              {
                  .rating_key = request->rating_key,
                  .start = request->start,
              },
      };
  return true;
}

bool multiplex_app_services_details_request_mark_watched(
    MultiplexAppServices *services,
    const MultiplexAppServicesMarkWatchedPayload *request) {
  services->content.details_action.kind =
      MULTIPLEX_APP_SERVICES_DETAILS_ACTION_QUEUED;
  services->content.details_action.state.queued.action =
      (MultiplexAppServicesDetailsAction){
          .kind = MULTIPLEX_APP_SERVICES_DETAILS_ACTION_MARK_WATCHED,
          .payload.mark_watched = {.rating_key = request->rating_key},
      };
  return true;
}

bool multiplex_app_services_details_focus(
    MultiplexAppServices *services,
    const MultiplexAppServicesFocusView *focus) {
  const uint32_t rating_key = focus->rating_key;
  if (focus->screen != MULTIPLEX_APP_SERVICES_SCREEN_DETAILS) {
    services->content.details.prefetch_candidate_key = 0;
    services->content.details.prefetch_at_ms = 0;
    set_prefetch_target(&services->content.details_prefetch,
                        no_prefetch_target());
    return true;
  }
  if (rating_key != services->content.details.prefetch_candidate_key) {
    set_prefetch_target(&services->content.details_prefetch,
                        no_prefetch_target());
    services->content.details.prefetch_candidate_key = rating_key;
    services->content.details.prefetch_at_ms =
        rating_key == 0 ? 0 : focus->now_ms + DETAILS_PREFETCH_DELAY_MS;
  }
  const MultiplexGatewayDetails *details =
      multiplex_app_services_details_slot_retained_result(
          &services->content.details);
  if (details != NULL && details->rating_key == rating_key) {
    set_prefetch_target(&services->content.details_prefetch,
                        prefetch_target(services, details));
    return true;
  }
  const bool playback_prefetch_active =
      services->content.playback.kind ==
          MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN &&
      services->content.playback.value.view.prefetch_active;
  if (playback_prefetch_active ||
      MULTIPLEX_APP_SERVICES_COMPILED_BACKEND !=
          MULTIPLEX_APP_SERVICES_BACKEND_PLEX ||
      rating_key == 0 ||
      (details != NULL && details->rating_key == rating_key) ||
      services->content.details.prefetch_at_ms == 0 ||
      focus->now_ms < services->content.details.prefetch_at_ms) {
    return true;
  }
  services->content.details.prefetch_at_ms = 0;
  return request_details_work(services, rating_key,
                              MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH);
}

bool multiplex_app_services_details_apply_work(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  if (result->kind != MULTIPLEX_APP_SERVICES_WORK_DETAILS) {
    return false;
  }
  MultiplexAppServicesDetailsRequest completed = {0};
  const MultiplexAppServicesSlotSettlement settlement =
      multiplex_app_services_details_slot_settle(
          &services->content.details, result->token,
          result->succeeded ? result->payload.details.details : NULL,
          &completed);
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_IGNORED) {
    return true;
  }
  const bool foreground =
      completed.purpose == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND;
  const bool focused =
      services->focus.kind == MULTIPLEX_APP_SERVICES_FOCUS_PRESENT &&
      services->focus.value.view.screen ==
          MULTIPLEX_APP_SERVICES_SCREEN_DETAILS &&
      services->focus.value.view.rating_key == completed.rating_key;
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS);
  if (settlement == MULTIPLEX_APP_SERVICES_SLOT_SUPERSEDED) {
    const MultiplexAppServicesDetailsRequest *queued =
        multiplex_app_services_details_slot_queued(&services->content.details);
    return !foreground || queued == NULL ||
           queued->purpose == MULTIPLEX_APP_SERVICES_DETAILS_FOREGROUND ||
           multiplex_app_services_queue_network_activity(services, false);
  }
  if (foreground && !focused) {
    return multiplex_app_services_queue_network_activity(services, false);
  }
  if (!result->succeeded || result->payload.details.details == NULL) {
    return (!foreground || multiplex_native_app_details_fail() != 0) &&
           (!foreground ||
            multiplex_app_services_queue_network_activity(services, false)) &&
           (!foreground ||
            multiplex_app_services_queue_refresh(services, true));
  }
  const MultiplexGatewayDetails *details =
      multiplex_app_services_details_slot_retained_result(
          &services->content.details);
  if (details == NULL) {
    return false;
  }
  bool applied = true;
  if (foreground) {
    applied = bind_details(details) &&
              multiplex_app_services_queue_network_activity(services, false) &&
              multiplex_app_services_queue_refresh(services, true);
  }
  if (applied &&
      ((foreground && focused) ||
       (!foreground && services->content.details.prefetch_candidate_key ==
                           details->rating_key))) {
    set_prefetch_target(&services->content.details_prefetch,
                        prefetch_target(services, details));
  }
  return applied;
}

bool multiplex_app_services_details_apply_prefetch_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPrefetchResult *result) {
  MultiplexAppServicesDetailsPrefetch *prefetch =
      &services->content.details_prefetch;
  if (prefetch->kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINING) {
    if (result->token != prefetch->state.retaining.token ||
        (result->kind != MULTIPLEX_APP_SERVICES_PREFETCH_READY &&
         result->kind != MULTIPLEX_APP_SERVICES_PREFETCH_FAILED)) {
      return true;
    }
    const MultiplexAppServicesDetailsPrefetchRequest active =
        prefetch->state.retaining.active;
    const MultiplexAppServicesDetailsPrefetchTarget desired =
        prefetch->state.retaining.desired;
    if (result->kind == MULTIPLEX_APP_SERVICES_PREFETCH_READY) {
      if (desired.kind ==
              MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT &&
          same_prefetch(&active, &desired.value.prefetch)) {
        prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAINED;
        prefetch->state.retained.active = active;
      } else {
        prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASE_QUEUED;
        prefetch->state.release_queued.desired = desired;
      }
    } else if (desired.kind ==
                   MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT &&
               !same_prefetch(&active, &desired.value.prefetch)) {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED;
      prefetch->state.retain_queued.prefetch = desired.value.prefetch;
    } else {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE;
    }
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS);
    return true;
  }
  if (prefetch->kind == MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RELEASING) {
    if (result->token != prefetch->state.releasing.token ||
        (result->kind != MULTIPLEX_APP_SERVICES_PREFETCH_RELEASED &&
         result->kind != MULTIPLEX_APP_SERVICES_PREFETCH_FAILED)) {
      return true;
    }
    const MultiplexAppServicesDetailsPrefetchTarget desired =
        prefetch->state.releasing.desired;
    if (desired.kind ==
        MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_TARGET_PRESENT) {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_RETAIN_QUEUED;
      prefetch->state.retain_queued.prefetch = desired.value.prefetch;
    } else {
      prefetch->kind = MULTIPLEX_APP_SERVICES_DETAILS_PREFETCH_IDLE;
    }
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_DETAILS);
  }
  return true;
}
