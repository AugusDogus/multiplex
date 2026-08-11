#include "app_services_internal.h"
#include "app_services_playback_resolution.h"

#include "media-source.h"
#include "native_ui.h"

#include <stdio.h>

bool multiplex_app_services_content_open_hls(
    MultiplexAppServices *services, uint32_t rating_key,
    uint32_t requested_offset, uint32_t subtitle_selection,
    const MultiplexAppServicesPlaybackView *current, bool from_watch,
    uint32_t *token) {
#if MULTIPLEX_PAIRING_ENABLED
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL || current == NULL || token == NULL ||
      rating_key == 0) {
    return false;
  }
  MultiplexAppServicesHlsPreparation preparation;
  if (!multiplex_app_services_playback_resolution_prepare_hls(
          services, credentials, rating_key, subtitle_selection, current,
          &preparation)) {
    return from_watch ? false : multiplex_native_app_playback_fail() != 0;
  }
  const uint32_t playback_token = multiplex_app_services_next_token(services);
  const MultiplexAppServicesPlaybackEffect playback = {
      .token = playback_token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_HLS,
      .payload.hls_open =
          {
              .credentials = *credentials,
              .rating_key = rating_key,
              .offset_ms = requested_offset < preparation.duration_ms
                               ? requested_offset
                               : 0,
              .duration_ms = preparation.duration_ms,
              .resume_current_session = current->rating_key == rating_key,
              .burn_subtitles = preparation.burn_subtitles,
              .subtitle_stream_index = preparation.subtitle_stream_index,
          },
  };
  if (!multiplex_app_services_queue_playback(services, &playback)) {
    return false;
  }
  *token = playback_token;
  return true;
#else
  (void)services;
  (void)rating_key;
  (void)requested_offset;
  (void)subtitle_selection;
  (void)current;
  (void)from_watch;
  (void)token;
  return false;
#endif
}

static bool
queue_playback_command(MultiplexAppServices *services,
                       const MultiplexAppServicesPlaybackCommand *command) {
  MultiplexAppServicesPlaybackCommandSlot *slot =
      &services->content.playback_command;
  if (slot->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_ACTIVE) {
    return false;
  }
  slot->kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_QUEUED;
  slot->state.queued.command = *command;
  return true;
}

static MultiplexAppServicesDomainScheduleResult
queue_gateway_command_open(MultiplexAppServices *services,
                           const MultiplexAppServicesPlaybackPayload *request,
                           uint32_t *token) {
  MultiplexAppServicesPlaybackEffect playback = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_OPEN_GATEWAY,
      .payload.gateway =
          {
              .rating_key = request->rating_key,
              .offset_ms = request->offset_ms,
          },
  };
  snprintf(playback.payload.gateway.gateway_url,
           sizeof(playback.payload.gateway.gateway_url), "%s",
           MULTIPLEX_GATEWAY_URL);
  if (!multiplex_app_services_queue_playback(services, &playback)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  *token = playback.token;
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

static MultiplexAppServicesDomainScheduleResult
queue_hls_command_open(MultiplexAppServices *services, uint32_t rating_key,
                       uint32_t offset_ms, uint32_t subtitle_selection,
                       const MultiplexAppServicesPlaybackView *source,
                       uint32_t *token) {
  *token = 0;
  if (!multiplex_app_services_content_open_hls(services, rating_key, offset_ms,
                                               subtitle_selection, source,
                                               false, token)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  return *token == 0 ? MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED
                     : MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

static MultiplexAppServicesDomainScheduleResult
queue_command_open(MultiplexAppServices *services,
                   const MultiplexAppServicesPlaybackPayload *request,
                   uint32_t *token) {
  if (!multiplex_app_services_queue_blocking_activity(services, true)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  MultiplexAppServicesDomainScheduleResult result =
      MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
      MULTIPLEX_APP_SERVICES_BACKEND_GATEWAY) {
    result = queue_gateway_command_open(services, request, token);
  } else if (services->content.playback.kind ==
             MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN) {
    const MultiplexAppServicesPlaybackView *source =
        &services->content.playback.value.view;
    result = queue_hls_command_open(services, request->rating_key,
                                    request->offset_ms,
                                    source->subtitle_selection, source, token);
  }
  if (result != MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED &&
      !multiplex_app_services_queue_blocking_activity(services, false)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  return result;
}

bool multiplex_app_services_playback_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL && services->content.playback_command.kind ==
                                 MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_QUEUED;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_playback_schedule_queued(
    MultiplexAppServices *services) {
  MultiplexAppServicesPlaybackCommandSlot *slot =
      &services->content.playback_command;
  if (slot->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_QUEUED) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  const MultiplexAppServicesPlaybackCommand command =
      slot->state.queued.command;
  uint32_t token = 0;
  switch (command.kind) {
  case MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_OPEN: {
    const MultiplexAppServicesDomainScheduleResult result =
        queue_command_open(services, &command.payload.open, &token);
    if (result != MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED) {
      slot->kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE;
      if (result == MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED) {
        return result;
      }
      return multiplex_native_app_playback_fail() != 0
                 ? MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED
                 : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    break;
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_NAVIGATE:
  case MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_AUTOPLAY: {
    const MultiplexAppServicesPlaybackEffect stop = {
        .token = multiplex_app_services_next_token(services),
        .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_STOP,
    };
    if (!multiplex_app_services_queue_playback(services, &stop)) {
      return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
    }
    token = stop.token;
    break;
  }
  default:
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  slot->kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_ACTIVE;
  slot->state.active.token = token;
  slot->state.active.command = command;
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

bool multiplex_app_services_playback_request(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request) {
  if (request->rating_key == 0 || (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND ==
                                       MULTIPLEX_APP_SERVICES_BACKEND_PLEX &&
                                   services->content.playback.kind !=
                                       MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN)) {
    return false;
  }
  const MultiplexAppServicesPlaybackCommand command = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_OPEN,
      .payload.open = *request,
  };
  return queue_playback_command(services, &command);
}

bool multiplex_app_services_playback_request_navigation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackNavigationPayload *request) {
  if (MULTIPLEX_APP_SERVICES_COMPILED_BACKEND !=
          MULTIPLEX_APP_SERVICES_BACKEND_PLEX ||
      request->direction == 0 ||
      services->content.playback.kind !=
          MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN ||
      services->content.playback.value.view.rating_key == 0) {
    return multiplex_native_app_playback_navigation_clear() != 0;
  }
  const MultiplexAppServicesPlaybackCommand command = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_NAVIGATE,
      .payload.navigate =
          {
              .direction = request->direction,
              .source = services->content.playback.value.view,
          },
  };
  return queue_playback_command(services, &command);
}

static bool finish_playback_command(MultiplexAppServices *services,
                                    bool applied) {
  services->content.playback_command.kind =
      MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_IDLE;
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_PLAYBACK);
  return applied;
}

static bool
queue_continuation_open(MultiplexAppServices *services, uint32_t rating_key,
                        const MultiplexAppServicesPlaybackView *source,
                        uint64_t now_ms, bool autoplay) {
  uint32_t token = 0;
  if (!multiplex_app_services_queue_blocking_activity(services, true)) {
    return false;
  }
  const MultiplexAppServicesDomainScheduleResult scheduled =
      queue_hls_command_open(services, rating_key, 0,
                             autoplay
                                 ? multiplex_native_app_subtitle_selection()
                                 : source->subtitle_selection,
                             source, &token);
  if (scheduled != MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED) {
    multiplex_app_services_queue_blocking_activity(services, false);
    return finish_playback_command(
        services, scheduled == MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED ||
                      multiplex_native_app_playback_fail() != 0);
  }
  services->content.playback_command.state.active.token = token;
  if (autoplay &&
      !multiplex_app_services_queue_controls_active(services, now_ms)) {
    return false;
  }
  return multiplex_app_services_queue_refresh(services, false);
}

static bool
continue_target(MultiplexAppServices *services,
                const MultiplexAppServicesPlaybackCommand *command) {
  const MultiplexAppServicesPlaybackTarget target =
      command->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_NAVIGATE
          ? multiplex_app_services_playback_resolution_navigate(services,
                                                                command)
          : multiplex_app_services_playback_resolution_autoplay(services,
                                                                command);
  if (target.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_COMPLETE) {
    return finish_playback_command(
        services, !target.state.complete.refresh ||
                      multiplex_app_services_queue_refresh(services, false));
  }
  if (target.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_TARGET_FAILED) {
    return finish_playback_command(services, false);
  }
  const bool autoplay =
      command->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_AUTOPLAY;
  const MultiplexAppServicesPlaybackView *source =
      autoplay ? &command->payload.autoplay.completed
               : &command->payload.navigate.source;
  return queue_continuation_open(
      services, target.state.ready.rating_key, source,
      autoplay ? command->payload.autoplay.now_ms : 0, autoplay);
}

bool multiplex_app_services_playback_apply_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result) {
  MultiplexAppServicesPlaybackCommandSlot *slot =
      &services->content.playback_command;
  if (slot->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_ACTIVE ||
      slot->state.active.token != result->token) {
    return true;
  }
  const MultiplexAppServicesPlaybackCommand command =
      slot->state.active.command;
  switch (result->kind) {
  case MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED:
    if (command.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_NAVIGATE ||
        command.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_AUTOPLAY) {
      return continue_target(services, &command);
    }
    return finish_playback_command(
        services,
        multiplex_app_services_queue_blocking_activity(services, false) &&
            multiplex_native_app_playback_fail() != 0);
  case MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_FAILED: {
    const bool applied =
        multiplex_app_services_queue_blocking_activity(services, false) &&
        multiplex_native_app_playback_fail() != 0;
    return finish_playback_command(services, applied);
  }
  case MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED: {
    const bool applied =
        multiplex_app_services_queue_blocking_activity(services, false) &&
        multiplex_native_app_playback_commit() != 0 &&
        multiplex_app_services_queue_refresh(services, false);
    return finish_playback_command(services, applied);
  }
  }
  return false;
}

bool multiplex_app_services_playback_apply_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event) {
#if MULTIPLEX_PAIRING_ENABLED
  if (event->kind == MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE ||
      multiplex_app_services_watch_has_session(services)) {
    return true;
  }
  if (event->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE) {
    return false;
  }
  if (multiplex_native_app_playback_position(event->playback.duration_ms) ==
      0) {
    return false;
  }
  const MultiplexAppServicesPlaybackCommand command = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_COMMAND_AUTOPLAY,
      .payload.autoplay =
          {
              .completed = event->playback,
              .now_ms = event->now_ms,
          },
  };
  return queue_playback_command(services, &command);
#else
  return services != NULL && event != NULL;
#endif
}
