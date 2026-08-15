#include "app_services_internal.h"

#include "media-source.h"
#include "native_ui.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

#if defined(HW_DOL) || defined(HW_RVL)
#include <gccore.h>
#define WATCH_REPORT(...) SYS_Report(__VA_ARGS__)
#else
#define WATCH_REPORT(...) ((void)sizeof(printf(__VA_ARGS__)))
#endif

#if MULTIPLEX_PAIRING_ENABLED

static bool continue_rotation(MultiplexAppServices *services,
                              const MultiplexAppServicesPlaybackView *completed,
                              uint64_t now_ms, uint32_t joined_room_index,
                              MultiplexSyncplaySession *syncplay);

static MultiplexAppServicesWatchDirectory *
watch_directory(MultiplexAppServicesWatchState *watch) {
  return watch->kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE
             ? &watch->state.available.directory
             : NULL;
}

static const MultiplexAppServicesWatchDirectory *
watch_directory_const(const MultiplexAppServicesWatchState *watch) {
  return watch->kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE
             ? &watch->state.available.directory
             : NULL;
}

MultiplexSyncplaySession *multiplex_app_services_watch_take_current_syncplay(
    MultiplexAppServicesWatchState *watch) {
  if (watch == NULL || watch->kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return NULL;
  }
  MultiplexAppServicesWatchPhase *phase = &watch->state.available.phase;
  MultiplexSyncplaySession **owner = NULL;
  switch (phase->kind) {
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY:
    owner = &phase->state.lobby.syncplay;
    break;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE:
    owner = &phase->state.active.syncplay;
    break;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND:
    if (phase->state.queued_command.kind ==
        MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT) {
      owner = &phase->state.queued_command.payload.exit.syncplay;
    } else if (phase->state.queued_command.kind ==
               MULTIPLEX_APP_SERVICES_WATCH_COMMAND_ROTATION) {
      owner = &phase->state.queued_command.payload.rotation.syncplay;
    }
    break;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK:
    owner = &phase->state.queued_playback.syncplay;
    break;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP:
    owner = &phase->state.wait_stop.syncplay;
    break;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK:
    break;
  }
  if (owner == NULL) {
    return NULL;
  }
  MultiplexSyncplaySession *syncplay = *owner;
  *owner = NULL;
  return syncplay;
}

void multiplex_app_services_watch_enter_room_list(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory directory) {
  const unsigned phase =
      services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE
          ? (unsigned)services->watch.state.available.phase.kind
          : UINT_MAX;
  const unsigned stop_kind =
      phase == MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP
          ? (unsigned)services->watch.state.available.phase.state.wait_stop.kind
          : UINT_MAX;
  WATCH_REPORT("REFERENCE GX: Syncplay entering room list watch-kind=%u "
               "phase=%u stop-kind=%u\n",
               (unsigned)services->watch.kind, phase, stop_kind);
  multiplex_syncplay_session_destroy(
      multiplex_app_services_watch_take_current_syncplay(&services->watch));
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available.directory = directory;
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST,
  };
}

bool multiplex_app_services_watch_begin_playback(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory directory, uint32_t room_index,
    uint32_t position_ms, const MultiplexAppServicesPlaybackView *current,
    MultiplexAppServicesWatchPlaybackContext context) {
  if (room_index >= directory.rooms.room_count || current == NULL) {
    return false;
  }
  const uint32_t rating_key = multiplex_app_services_watch_directory_rating_key(
      &directory.rooms.rooms[room_index]);
  if (rating_key == 0) {
    return false;
  }
  MultiplexAppServicesWatchQueuedPlayback queued = {
      .joined_room_index = room_index,
      .position_ms = position_ms,
      .current = *current,
      .syncplay =
          multiplex_app_services_watch_take_current_syncplay(&services->watch),
      .context = context,
  };
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available.directory = directory;
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK,
      .state.queued_playback = queued,
  };
  return true;
}

void multiplex_app_services_watch_initialize(MultiplexAppServices *services) {
  memset(&services->watch, 0, sizeof(services->watch));
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE;
}

void multiplex_app_services_watch_destroy(MultiplexAppServices *services) {
  if (services == NULL) {
    return;
  }
  multiplex_syncplay_session_destroy(
      multiplex_app_services_watch_take_current_syncplay(&services->watch));
  memset(&services->watch, 0, sizeof(services->watch));
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE;
}

bool multiplex_app_services_watch_reset(MultiplexAppServices *services) {
  if (services == NULL) {
    return false;
  }
  multiplex_app_services_watch_destroy(services);
  const MultiplexTrpcRoomList rooms = {0};
  const MultiplexTrpcInviteeList invitees = {0};
  return multiplex_app_services_watch_directory_bind_rooms(&rooms, false) &&
         multiplex_app_services_watch_directory_bind_invitees(&invitees,
                                                              false) &&
         multiplex_native_app_watch_together_presence(0, 0) != 0 &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_watch_apply_startup(
    MultiplexAppServices *services,
    const MultiplexAppServicesWorkResultView *result) {
  if (services == NULL || result == NULL ||
      result->kind != MULTIPLEX_APP_SERVICES_WORK_STARTUP_DATA ||
      services->content.startup_data.kind !=
          MULTIPLEX_APP_SERVICES_LOAD_LOADING ||
      services->content.startup_data.token != result->token) {
    return true;
  }
  MultiplexAppServicesWatchDirectory directory = {0};
  if (result->payload.startup_data.user.kind ==
      MULTIPLEX_APP_SERVICES_STARTUP_USER_PRESENT) {
    directory.plex_user_id = result->payload.startup_data.user.value.id;
  }
  if (result->payload.startup_data.rooms != NULL) {
    directory.rooms = *result->payload.startup_data.rooms;
  }
  if (result->payload.startup_data.invitees != NULL) {
    directory.invitees = *result->payload.startup_data.invitees;
  }
  multiplex_app_services_watch_enter_room_list(services, directory);
  return multiplex_app_services_watch_directory_bind_rooms(
             &directory.rooms, result->payload.startup_data.rooms != NULL) &&
         multiplex_app_services_watch_directory_bind_invitees(
             &directory.invitees,
             result->payload.startup_data.invitees != NULL) &&
         multiplex_app_services_queue_refresh(services, false);
}

static bool create_room(MultiplexAppServices *services,
                        const MultiplexAppServicesWatchCreatePayload *request) {
  MultiplexAppServicesWatchDirectory *directory =
      watch_directory(&services->watch);
  if (directory == NULL) {
    return false;
  }
  return multiplex_app_services_watch_directory_create(services, directory,
                                                       request) &&
         multiplex_app_services_queue_refresh(services, false);
}

static bool join_room(MultiplexAppServices *services,
                      const MultiplexAppServicesWatchJoinPayload *request) {
  const MultiplexAppServicesWatchDirectory *current =
      watch_directory_const(&services->watch);
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (current == NULL || credentials == NULL) {
    return false;
  }
  const MultiplexAppServicesWatchDirectory directory = *current;
  const uint32_t index = request->room_index;
  multiplex_syncplay_session_destroy(
      multiplex_app_services_watch_take_current_syncplay(&services->watch));
  if (index >= directory.rooms.room_count || directory.plex_user_id == 0 ||
      multiplex_app_services_watch_directory_rating_key(
          &directory.rooms.rooms[index]) == 0) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_native_app_watch_together_join_commit(0) != 0;
  }
  MultiplexSyncplaySession *syncplay = multiplex_syncplay_session_connect(
      &directory.rooms.rooms[index], credentials->plex_client_id,
      directory.plex_user_id, true);
  if (syncplay == NULL) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_native_app_watch_together_join_commit(0) != 0;
  }
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available = (MultiplexAppServicesWatchAvailable){
      .directory = directory,
      .phase =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY,
              .state.lobby =
                  {
                      .joined_room_index = index,
                      .syncplay = syncplay,
                  },
          },
  };
  const bool hosted =
      directory.hosted.kind == MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT &&
      strcmp(directory.rooms.rooms[index].id, directory.hosted.id) == 0;
  return multiplex_native_app_watch_together_join_commit(1) != 0 &&
         multiplex_native_app_watch_together_host(hosted ? 1u : 0u) != 0 &&
         multiplex_native_app_watch_together_presence(1, 1) != 0 &&
         multiplex_app_services_queue_refresh(services, false);
}

static uint32_t joined_room_index(const MultiplexAppServicesWatchState *watch) {
  if (watch->kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return UINT32_MAX;
  }
  const MultiplexAppServicesWatchPhase *phase = &watch->state.available.phase;
  switch (phase->kind) {
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY:
    return phase->state.lobby.joined_room_index;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE:
    return phase->state.active.joined_room_index;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT:
    return phase->state.reconnect_wait.joined_room_index;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND:
    if (phase->state.queued_command.kind ==
        MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT) {
      return phase->state.queued_command.payload.exit.room_index;
    }
    if (phase->state.queued_command.kind ==
        MULTIPLEX_APP_SERVICES_WATCH_COMMAND_ROTATION) {
      return phase->state.queued_command.payload.rotation.room_index;
    }
    return UINT32_MAX;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK:
    return phase->state.queued_playback.joined_room_index;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK:
    return phase->state.starting_playback.joined_room_index;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP:
    return phase->state.wait_stop.kind == MULTIPLEX_APP_SERVICES_WATCH_STOP_EXIT
               ? phase->state.wait_stop.continuation.exit.room_index
               : UINT32_MAX;
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST:
    return UINT32_MAX;
  }
  return UINT32_MAX;
}

static bool queue_exit_command(MultiplexAppServices *services, bool disband) {
  if (services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE ||
      services->watch.state.available.phase.kind ==
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST ||
      services->watch.state.available.phase.kind ==
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP ||
      services->watch.state.available.phase.kind ==
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK ||
      services->watch.state.available.phase.kind ==
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND) {
    return true;
  }
  const uint32_t index = joined_room_index(&services->watch);
  MultiplexSyncplaySession *syncplay =
      multiplex_app_services_watch_take_current_syncplay(&services->watch);
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND,
      .state.queued_command =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT,
              .payload.exit =
                  {
                      .disband = disband,
                      .room_index = index,
                      .syncplay = syncplay,
                  },
          },
  };
  return true;
}

static bool complete_exit(MultiplexAppServices *services, bool disband,
                          uint32_t index, MultiplexSyncplaySession *syncplay) {
  MultiplexAppServicesWatchDirectory directory =
      services->watch.state.available.directory;
  multiplex_syncplay_session_destroy(syncplay);
  bool deleted = false;
  if (disband && !multiplex_app_services_watch_directory_delete_hosted(
                     services, &directory, index, &deleted)) {
    return false;
  }
  const bool committed =
      disband ? multiplex_native_app_watch_together_disband_commit(
                    deleted ? 1u : 0u) != 0
              : multiplex_native_app_watch_together_leave_commit() != 0;
  const bool refreshed =
      multiplex_app_services_watch_directory_refresh(services, &directory);
  multiplex_app_services_watch_enter_room_list(services, directory);
  return committed && refreshed &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_watch_has_session(
    const MultiplexAppServices *services) {
  return services != NULL &&
         services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE &&
         services->watch.state.available.phase.kind !=
             MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST;
}

bool multiplex_app_services_watch_request_create(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchCreatePayload *request) {
  if (services == NULL || request == NULL ||
      services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return false;
  }
  if (services->watch.state.available.phase.kind !=
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST) {
    return true;
  }
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND,
      .state.queued_command =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_COMMAND_CREATE,
              .payload.create = *request,
          },
  };
  return true;
}

bool multiplex_app_services_watch_request_join(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchJoinPayload *request) {
  if (services == NULL || request == NULL ||
      services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return false;
  }
  if (services->watch.state.available.phase.kind !=
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST) {
    return true;
  }
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND,
      .state.queued_command =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_COMMAND_JOIN,
              .payload.join = *request,
          },
  };
  return true;
}

bool multiplex_app_services_watch_request_exit(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchExitPayload *request) {
  return services != NULL && request != NULL &&
         queue_exit_command(services, request->disband);
}

bool multiplex_app_services_watch_request_lobby_leave(
    MultiplexAppServices *services) {
  if (services == NULL) {
    return false;
  }
  if (services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE ||
      services->watch.state.available.phase.kind !=
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY) {
    return true;
  }
  return queue_exit_command(services, false);
}

bool multiplex_app_services_watch_request_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackPayload *request) {
  if (services == NULL || request == NULL ||
      services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE ||
      services->watch.state.available.phase.kind !=
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE ||
      services->content.playback.kind !=
          MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN) {
    return true;
  }
  const MultiplexAppServicesPlaybackView *current =
      &services->content.playback.value.view;
  if (request->rating_key != current->rating_key ||
      request->offset_ms == current->segment_start_ms) {
    return true;
  }
  const MultiplexAppServicesWatchPlaybackContext context = {
      .purpose = MULTIPLEX_APP_SERVICES_WATCH_START_LOCAL_SEEK,
  };
  return multiplex_app_services_watch_begin_playback(
      services, services->watch.state.available.directory,
      services->watch.state.available.phase.state.active.joined_room_index,
      request->offset_ms, current, context);
}

bool multiplex_app_services_watch_has_queued(
    const MultiplexAppServices *services) {
  return services != NULL &&
         services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE &&
         (services->watch.state.available.phase.kind ==
              MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND ||
          services->watch.state.available.phase.kind ==
              MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK);
}

static MultiplexAppServicesDomainScheduleResult
schedule_queued_command(MultiplexAppServices *services) {
  const MultiplexAppServicesWatchQueuedCommand command =
      services->watch.state.available.phase.state.queued_command;
  switch (command.kind) {
  case MULTIPLEX_APP_SERVICES_WATCH_COMMAND_CREATE:
    services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
        .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST,
    };
    return create_room(services, &command.payload.create)
               ? MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED
               : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  case MULTIPLEX_APP_SERVICES_WATCH_COMMAND_JOIN:
    return join_room(services, &command.payload.join)
               ? MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED
               : MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  case MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT:
  case MULTIPLEX_APP_SERVICES_WATCH_COMMAND_ROTATION:
    break;
  }
  const MultiplexAppServicesPlaybackEffect stop = {
      .token = multiplex_app_services_next_token(services),
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_STOP,
  };
  if (!multiplex_app_services_queue_playback(services, &stop)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  MultiplexSyncplaySession *syncplay =
      multiplex_app_services_watch_take_current_syncplay(&services->watch);
  MultiplexAppServicesWatchWaitStop waiting = {
      .stop_token = stop.token,
      .syncplay = syncplay,
  };
  if (command.kind == MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT) {
    waiting.kind = MULTIPLEX_APP_SERVICES_WATCH_STOP_EXIT;
    waiting.continuation.exit.disband = command.payload.exit.disband;
    waiting.continuation.exit.room_index = command.payload.exit.room_index;
  } else {
    waiting.kind = MULTIPLEX_APP_SERVICES_WATCH_STOP_ROTATION;
    waiting.continuation.rotation.completed =
        command.payload.rotation.completed;
    waiting.continuation.rotation.now_ms = command.payload.rotation.now_ms;
    waiting.continuation.rotation.room_index =
        command.payload.rotation.room_index;
  }
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP,
      .state.wait_stop = waiting,
  };
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

MultiplexAppServicesDomainScheduleResult
multiplex_app_services_watch_schedule_queued(MultiplexAppServices *services) {
  if (!multiplex_app_services_watch_has_queued(services)) {
    return services == NULL ? MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED
                            : MULTIPLEX_APP_SERVICES_SCHEDULE_HANDLED;
  }
  if (services->watch.state.available.phase.kind ==
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND) {
    return schedule_queued_command(services);
  }
  const MultiplexAppServicesWatchQueuedPlayback queued =
      services->watch.state.available.phase.state.queued_playback;
  const MultiplexAppServicesWatchDirectory directory =
      services->watch.state.available.directory;
  if (queued.joined_room_index >= directory.rooms.room_count) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  const uint32_t rating_key = multiplex_app_services_watch_directory_rating_key(
      &directory.rooms.rooms[queued.joined_room_index]);
  uint32_t token = 0;
  if (rating_key == 0 ||
      !multiplex_app_services_queue_blocking_activity(services, true)) {
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  if (!multiplex_app_services_content_open_hls(
          services, rating_key, queued.position_ms,
          queued.current.subtitle_selection, &queued.current, true, &token)) {
    multiplex_app_services_queue_blocking_activity(services, false);
    return MULTIPLEX_APP_SERVICES_SCHEDULE_FAILED;
  }
  WATCH_REPORT("REFERENCE GX: Syncplay playback scheduled token=%u purpose=%u "
               "offset=%u\n",
               token, (unsigned)queued.context.purpose, queued.position_ms);
  MultiplexSyncplaySession *syncplay =
      multiplex_app_services_watch_take_current_syncplay(&services->watch);
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK,
      .state.starting_playback =
          {
              .joined_room_index = queued.joined_room_index,
              .playback_token = token,
              .context = queued.context,
          },
  };
  multiplex_syncplay_session_destroy(syncplay);
  return MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED;
}

static bool
settle_started_playback(MultiplexAppServices *services,
                        const MultiplexAppServicesPlaybackResult *result) {
  WATCH_REPORT("REFERENCE GX: Syncplay playback result token=%u kind=%u "
               "watch-kind=%u phase=%u expected=%u\n",
               result->token, (unsigned)result->kind,
               (unsigned)services->watch.kind,
               services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE
                   ? (unsigned)services->watch.state.available.phase.kind
                   : UINT_MAX,
               services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE &&
                       services->watch.state.available.phase.kind ==
                           MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK
                   ? services->watch.state.available.phase.state
                         .starting_playback.playback_token
                   : 0u);
  if (services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE ||
      services->watch.state.available.phase.kind !=
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK ||
      services->watch.state.available.phase.state.starting_playback
              .playback_token != result->token) {
    WATCH_REPORT("REFERENCE GX: Syncplay playback result ignored token=%u "
                 "watch-kind=%u phase=%u\n",
                 result->token, (unsigned)services->watch.kind,
                 services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE
                     ? (unsigned)services->watch.state.available.phase.kind
                     : UINT_MAX);
    return true;
  }
  const MultiplexAppServicesWatchStartingPlayback starting =
      services->watch.state.available.phase.state.starting_playback;
  MultiplexAppServicesWatchDirectory directory =
      services->watch.state.available.directory;
  multiplex_app_services_scheduler_finish_foreground(
      services, MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH);
  if (!multiplex_app_services_queue_blocking_activity(services, false)) {
    return false;
  }
  if (result->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED ||
      starting.joined_room_index >= directory.rooms.room_count) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_native_app_watch_together_join_commit(0) != 0 &&
           multiplex_app_services_queue_refresh(services, false);
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return false;
  }
  const MultiplexTrpcRoom *room =
      &directory.rooms.rooms[starting.joined_room_index];
  WATCH_REPORT(
      "REFERENCE GX: Syncplay playback reconnect token=%u purpose=%u\n",
      result->token, (unsigned)starting.context.purpose);
  MultiplexSyncplaySession *syncplay = multiplex_syncplay_session_connect(
      room, credentials->plex_client_id, directory.plex_user_id, false);
  if (syncplay == NULL) {
    const MultiplexAppServicesPlaybackEffect stop = {
        .token = multiplex_app_services_next_token(services),
        .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_STOP,
    };
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_app_services_queue_playback(services, &stop) &&
           multiplex_native_app_watch_together_join_commit(0) != 0 &&
           multiplex_app_services_queue_refresh(services, false);
  }
  bool paused = !result->playback.playing;
  if (starting.context.purpose ==
      MULTIPLEX_APP_SERVICES_WATCH_START_LOCAL_SEEK) {
    if (multiplex_native_app_playback_commit() == 0) {
      multiplex_syncplay_session_destroy(syncplay);
      multiplex_app_services_watch_enter_room_list(services, directory);
      return false;
    }
    paused = false;
  }
  if (starting.context.purpose ==
      MULTIPLEX_APP_SERVICES_WATCH_START_REMOTE_SEEK) {
    paused = starting.context.value.remote_seek.paused;
    if (multiplex_native_app_playback_set_paused(paused ? 1u : 0u) == 0) {
      multiplex_syncplay_session_destroy(syncplay);
      multiplex_app_services_watch_enter_room_list(services, directory);
      return false;
    }
    multiplex_syncplay_session_adopt_playback(
        syncplay, paused, result->playback.segment_start_ms);
  } else {
    multiplex_syncplay_session_set_playback(syncplay, paused,
                                            result->playback.segment_start_ms);
  }
  if (starting.context.purpose ==
      MULTIPLEX_APP_SERVICES_WATCH_START_LOCAL_SEEK) {
    multiplex_syncplay_session_mark_local_seek(syncplay);
  } else if ((starting.context.purpose ==
                  MULTIPLEX_APP_SERVICES_WATCH_START_LOBBY ||
              starting.context.purpose ==
                  MULTIPLEX_APP_SERVICES_WATCH_START_ROTATION) &&
             multiplex_native_app_watch_together_playback(
                 starting.joined_room_index, result->playback.rating_key,
                 (const uint8_t *)room->title, strlen(room->title),
                 result->playback.duration_ms,
                 result->playback.segment_start_ms) == 0) {
    multiplex_syncplay_session_destroy(syncplay);
    multiplex_app_services_watch_enter_room_list(services, directory);
    return false;
  }
  if (starting.context.purpose == MULTIPLEX_APP_SERVICES_WATCH_START_ROTATION) {
    multiplex_native_app_watch_together_host(
        starting.context.value.rotation.created ? 1u : 0u);
    if (!starting.context.value.rotation.created) {
      directory.hosted = (MultiplexAppServicesHostedRoom){0};
    }
    multiplex_trpc_delete_watch_together_room(
        MULTIPLEX_BASE_URL, credentials->session_token,
        starting.context.value.rotation.previous_room_id);
  }
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available = (MultiplexAppServicesWatchAvailable){
      .directory = directory,
      .phase =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE,
              .state.active =
                  {
                      .joined_room_index = starting.joined_room_index,
                      .syncplay = syncplay,
                  },
          },
  };
  WATCH_REPORT("REFERENCE GX: Syncplay playback active token=%u purpose=%u\n",
               result->token, (unsigned)starting.context.purpose);
  return multiplex_native_app_watch_together_presence(1, 1) != 0 &&
         multiplex_app_services_queue_refresh(services, false);
}

bool multiplex_app_services_watch_apply_playback_result(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackResult *result) {
  if (services == NULL || result == NULL) {
    return false;
  }
  if (services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE &&
      services->watch.state.available.phase.kind ==
          MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP) {
    const MultiplexAppServicesWatchWaitStop waiting =
        services->watch.state.available.phase.state.wait_stop;
    if (waiting.stop_token == 0 || waiting.stop_token != result->token ||
        result->kind != MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED) {
      return true;
    }
    MultiplexSyncplaySession *syncplay =
        multiplex_app_services_watch_take_current_syncplay(&services->watch);
    bool accepted = false;
    switch (waiting.kind) {
    case MULTIPLEX_APP_SERVICES_WATCH_STOP_EXIT:
      accepted = complete_exit(services, waiting.continuation.exit.disband,
                               waiting.continuation.exit.room_index, syncplay);
      break;
    case MULTIPLEX_APP_SERVICES_WATCH_STOP_ROTATION:
      accepted =
          continue_rotation(services, &waiting.continuation.rotation.completed,
                            waiting.continuation.rotation.now_ms,
                            waiting.continuation.rotation.room_index, syncplay);
      break;
    }
    multiplex_app_services_scheduler_finish_foreground(
        services, MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH);
    return accepted;
  }
  return settle_started_playback(services, result);
}

static bool
queue_rotation_command(MultiplexAppServices *services,
                       const MultiplexAppServicesPlaybackEvent *event) {
  if (services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return true;
  }
  const MultiplexAppServicesWatchPhase *phase =
      &services->watch.state.available.phase;
  uint32_t joined_room_index = UINT32_MAX;
  if (phase->kind == MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE) {
    joined_room_index = phase->state.active.joined_room_index;
  } else if (phase->kind == MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT) {
    joined_room_index = phase->state.reconnect_wait.joined_room_index;
  } else {
    return true;
  }
  if (joined_room_index >=
      services->watch.state.available.directory.rooms.room_count) {
    return false;
  }
  if (multiplex_native_app_playback_position(event->playback.duration_ms) ==
      0) {
    return false;
  }
  MultiplexSyncplaySession *syncplay =
      multiplex_app_services_watch_take_current_syncplay(&services->watch);
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND,
      .state.queued_command =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_COMMAND_ROTATION,
              .payload.rotation =
                  {
                      .completed = event->playback,
                      .now_ms = event->now_ms,
                      .room_index = joined_room_index,
                      .syncplay = syncplay,
                  },
          },
  };
  return true;
}

static bool continue_rotation(MultiplexAppServices *services,
                              const MultiplexAppServicesPlaybackView *completed,
                              uint64_t now_ms, uint32_t joined_room_index,
                              MultiplexSyncplaySession *syncplay) {
  MultiplexAppServicesWatchDirectory directory =
      services->watch.state.available.directory;
  multiplex_syncplay_session_destroy(syncplay);
  MultiplexAppServicesWatchRotation rotation;
  if (!multiplex_app_services_watch_directory_plan_rotation(
          services, &directory, completed, joined_room_index, &rotation)) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return false;
  }
  if (rotation.kind == MULTIPLEX_APP_SERVICES_WATCH_ROTATION_COMPLETE) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_native_app_playback_complete() != 0 &&
           multiplex_app_services_queue_refresh(services, false);
  }
  MultiplexAppServicesWatchPlaybackContext context = {
      .purpose = MULTIPLEX_APP_SERVICES_WATCH_START_ROTATION,
      .value.rotation.created = rotation.created,
  };
  snprintf(context.value.rotation.previous_room_id,
           sizeof(context.value.rotation.previous_room_id), "%s",
           rotation.previous_room_id);
  if (!multiplex_app_services_watch_begin_playback(
          services, directory, rotation.room_index, 0, completed, context)) {
    multiplex_app_services_watch_enter_room_list(services, directory);
    return multiplex_native_app_playback_complete() != 0 &&
           multiplex_app_services_queue_refresh(services, false);
  }
  return multiplex_app_services_queue_controls_active(services, now_ms);
}

bool multiplex_app_services_watch_apply_playback_event(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEvent *event) {
  if (services == NULL || event == NULL) {
    return false;
  }
  switch (event->kind) {
  case MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE:
    return queue_rotation_command(services, event);
  case MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_LOCAL_STATE:
    return true;
  }
  return false;
}

#endif
