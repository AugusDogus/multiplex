#include "app_services_internal.h"

#include "native_ui.h"

#include <assert.h>
#include <stdint.h>
#include <string.h>

typedef enum {
  ROTATION_PLAN_FAILED = 0,
  ROTATION_PLAN_NO_NEXT = 1,
  ROTATION_PLAN_NO_ROOM = 2,
  ROTATION_PLAN_READY = 3,
} RotationPlan;

static MultiplexAuthCredentials credentials;
static bool credentials_available;
static bool refresh_succeeds;
static uint32_t next_token;
static MultiplexAppServicesPlaybackEffect queued_playback;
static unsigned queued_playback_count;
static MultiplexSyncplaySession *destroyed[4];
static unsigned destroyed_count;
static unsigned finished_watch_count;
static RotationPlan rotation_plan;
static uint32_t rotation_rating_key;
static bool open_hls_succeeds;
static unsigned syncplay_connect_count;
static unsigned local_seek_mark_count;

static MultiplexSyncplaySession *fake_syncplay(uintptr_t value) {
  return (MultiplexSyncplaySession *)value;
}

uint32_t multiplex_app_services_next_token(MultiplexAppServices *services) {
  (void)services;
  next_token += 1u;
  return next_token;
}

bool multiplex_app_services_queue(MultiplexAppServices *services,
                                  const MultiplexAppServicesEffect *effect) {
  (void)services;
  if (effect->kind == MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK) {
    queued_playback = effect->payload.playback;
    queued_playback_count += 1u;
  }
  return true;
}

bool multiplex_app_services_queue_presentation(
    MultiplexAppServices *services,
    const MultiplexAppServicesPresentationEffect *effect) {
  (void)services;
  (void)effect;
  return true;
}

bool multiplex_app_services_queue_playback(
    MultiplexAppServices *services,
    const MultiplexAppServicesPlaybackEffect *effect) {
  const MultiplexAppServicesEffect queued = {
      .kind = MULTIPLEX_APP_SERVICES_EFFECT_PLAYBACK,
      .payload.playback = *effect,
  };
  return multiplex_app_services_queue(services, &queued);
}

bool multiplex_app_services_queue_refresh(MultiplexAppServices *services,
                                          bool asynchronous) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_REFRESH,
      .payload.refresh = {.asynchronous = asynchronous},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}

bool multiplex_app_services_queue_blocking_activity(
    MultiplexAppServices *services, bool visible) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_BLOCKING_ACTIVITY,
      .payload.activity = {.visible = visible},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}

bool multiplex_app_services_queue_controls_active(
    MultiplexAppServices *services, uint64_t now_ms) {
  const MultiplexAppServicesPresentationEffect effect = {
      .kind = MULTIPLEX_APP_SERVICES_PRESENTATION_CONTROLS_ACTIVE,
      .payload.controls_active = {.now_ms = now_ms},
  };
  return multiplex_app_services_queue_presentation(services, &effect);
}

const MultiplexAuthCredentials *
multiplex_app_services_auth_credentials(const MultiplexAppServices *services) {
  (void)services;
  return credentials_available ? &credentials : NULL;
}

bool multiplex_app_services_content_open_hls(
    MultiplexAppServices *services, uint32_t rating_key,
    uint32_t requested_offset, uint32_t subtitle_selection,
    const MultiplexAppServicesPlaybackView *current, bool from_watch,
    uint32_t *token) {
  (void)services;
  (void)rating_key;
  (void)requested_offset;
  (void)subtitle_selection;
  (void)current;
  (void)from_watch;
  if (!open_hls_succeeds) {
    return false;
  }
  *token = multiplex_app_services_next_token(services);
  return true;
}

void multiplex_app_services_scheduler_finish_foreground(
    MultiplexAppServices *services,
    MultiplexAppServicesForegroundDomain domain) {
  assert(services != NULL);
  assert(domain == MULTIPLEX_APP_SERVICES_FOREGROUND_WATCH);
  finished_watch_count += 1u;
}

void multiplex_syncplay_session_destroy(MultiplexSyncplaySession *session) {
  if (session == NULL) {
    return;
  }
  for (unsigned index = 0; index < destroyed_count; ++index) {
    assert(destroyed[index] != session);
  }
  assert(destroyed_count < sizeof(destroyed) / sizeof(destroyed[0]));
  destroyed[destroyed_count++] = session;
}

MultiplexSyncplaySession *
multiplex_syncplay_session_connect(const MultiplexTrpcRoom *room,
                                   const char *device_identifier,
                                   uint32_t user_id, bool observer) {
  (void)room;
  (void)device_identifier;
  (void)user_id;
  (void)observer;
  syncplay_connect_count += 1u;
  return NULL;
}

void multiplex_syncplay_session_set_playback(MultiplexSyncplaySession *session,
                                             bool paused,
                                             uint32_t position_ms) {
  (void)session;
  (void)paused;
  (void)position_ms;
}

void multiplex_syncplay_session_adopt_playback(
    MultiplexSyncplaySession *session, bool paused, uint32_t position_ms) {
  (void)session;
  (void)paused;
  (void)position_ms;
}

void multiplex_syncplay_session_mark_local_seek(
    MultiplexSyncplaySession *session) {
  assert(session != NULL);
  local_seek_mark_count += 1u;
}

bool multiplex_syncplay_session_has_web_participant(
    const MultiplexSyncplaySession *session) {
  (void)session;
  return false;
}

bool multiplex_app_services_watch_directory_bind_rooms(
    const MultiplexTrpcRoomList *rooms, bool available) {
  (void)rooms;
  (void)available;
  return true;
}

bool multiplex_app_services_watch_directory_bind_invitees(
    const MultiplexTrpcInviteeList *invitees, bool available) {
  (void)invitees;
  (void)available;
  return true;
}

uint32_t multiplex_app_services_watch_directory_rating_key(
    const MultiplexTrpcRoom *room) {
  (void)room;
  return rotation_rating_key;
}

bool multiplex_app_services_watch_directory_refresh(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory) {
  (void)directory;
  return multiplex_app_services_auth_credentials(services) != NULL &&
         refresh_succeeds;
}

bool multiplex_app_services_watch_directory_create(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesWatchCreatePayload *request) {
  (void)services;
  (void)directory;
  (void)request;
  return true;
}

bool multiplex_app_services_watch_directory_delete_hosted(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory, uint32_t room_index,
    bool *deleted) {
  (void)services;
  (void)directory;
  (void)room_index;
  *deleted = false;
  return true;
}

bool multiplex_app_services_watch_directory_plan_rotation(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesPlaybackView *completed,
    uint32_t joined_room_index, bool wait_for_web_creator,
    MultiplexAppServicesWatchRotation *rotation) {
  (void)directory;
  (void)completed;
  (void)joined_room_index;
  (void)wait_for_web_creator;
  if (multiplex_app_services_auth_credentials(services) == NULL ||
      rotation_plan == ROTATION_PLAN_FAILED) {
    return false;
  }
  rotation->kind = rotation_plan == ROTATION_PLAN_READY
                       ? MULTIPLEX_APP_SERVICES_WATCH_ROTATION_READY
                       : MULTIPLEX_APP_SERVICES_WATCH_ROTATION_COMPLETE;
  rotation->room_index = 0;
  rotation->created = false;
  rotation->previous_room_id[0] = '\0';
  return true;
}

uint32_t multiplex_native_app_watch_together_join_commit(uint32_t connected) {
  (void)connected;
  return 1u;
}

uint32_t
multiplex_native_app_watch_together_presence(uint32_t connected,
                                             uint32_t participant_count) {
  (void)connected;
  (void)participant_count;
  return 1u;
}

uint32_t multiplex_native_app_watch_together_host(uint32_t host) {
  (void)host;
  return 1u;
}

uint32_t multiplex_native_app_watch_together_playback(
    uint32_t room_index, uint32_t rating_key, const uint8_t *title,
    uint32_t title_length, uint32_t duration_ms, uint32_t offset_ms) {
  (void)room_index;
  (void)rating_key;
  (void)title;
  (void)title_length;
  (void)duration_ms;
  (void)offset_ms;
  return 1u;
}

uint32_t multiplex_native_app_watch_together_leave_commit(void) { return 1u; }

uint32_t multiplex_native_app_watch_together_disband_commit(uint32_t deleted) {
  (void)deleted;
  return 1u;
}

uint32_t multiplex_native_app_playback_set_paused(uint32_t paused) {
  (void)paused;
  return 1u;
}

uint32_t multiplex_native_app_playback_commit(void) { return 1u; }

uint32_t multiplex_native_app_playback_position(uint32_t position_ms) {
  (void)position_ms;
  return 1u;
}

uint32_t multiplex_native_app_playback_complete(void) { return 1u; }

bool multiplex_trpc_delete_watch_together_room(const char *base_url,
                                               const char *session_token,
                                               const char *room_id) {
  (void)base_url;
  (void)session_token;
  (void)room_id;
  return true;
}

static void reset_observations(void) {
  credentials_available = true;
  refresh_succeeds = true;
  next_token = 40u;
  queued_playback = (MultiplexAppServicesPlaybackEffect){0};
  queued_playback_count = 0;
  memset(destroyed, 0, sizeof(destroyed));
  destroyed_count = 0;
  finished_watch_count = 0;
  rotation_plan = ROTATION_PLAN_FAILED;
  rotation_rating_key = 0;
  open_hls_succeeds = false;
  syncplay_connect_count = 0;
  local_seek_mark_count = 0;
}

static MultiplexAppServices
active_services(MultiplexSyncplaySession *syncplay) {
  MultiplexAppServices services = {0};
  services.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services.watch.state.available.directory.rooms.room_count = 1u;
  services.watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE,
      .state.active = {.joined_room_index = 0u, .syncplay = syncplay},
  };
  return services;
}

static MultiplexAppServices lobby_services(MultiplexSyncplaySession *syncplay) {
  MultiplexAppServices services = {0};
  services.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services.watch.state.available.directory.rooms.room_count = 1u;
  services.watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY,
      .state.lobby = {.joined_room_index = 0u, .syncplay = syncplay},
  };
  return services;
}

static MultiplexAppServicesPlaybackResult stopped_result(void) {
  assert(queued_playback_count == 1u);
  assert(queued_playback.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_STOP);
  return (MultiplexAppServicesPlaybackResult){
      .token = queued_playback.token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_STOPPED,
  };
}

static void schedule_exit(MultiplexAppServices *services, bool disband) {
  const MultiplexAppServicesWatchExitPayload request = {.disband = disband};
  assert(multiplex_app_services_watch_request_exit(services, &request));
  assert(queued_playback_count == 0u);
  assert(multiplex_app_services_watch_schedule_queued(services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED);
}

static void schedule_rotation(MultiplexAppServices *services) {
  const MultiplexAppServicesPlaybackEvent event = {
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_EVENT_HLS_COMPLETE,
      .now_ms = 9000u,
      .playback = {.rating_key = 55u, .duration_ms = 60000u},
  };
  assert(multiplex_app_services_watch_apply_playback_event(services, &event));
  assert(queued_playback_count == 0u);
  assert(multiplex_app_services_watch_schedule_queued(services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED);
}

static void assert_destroyed_once_after_service_destroy(
    MultiplexAppServices *services, MultiplexSyncplaySession *syncplay) {
  assert(destroyed_count == 1u);
  assert(destroyed[0] == syncplay);
  multiplex_app_services_watch_destroy(services);
  assert(destroyed_count == 1u);
  assert(services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE);
}

static void lobby_leave_queues_exit_and_stop(void) {
  reset_observations();
  MultiplexSyncplaySession *syncplay = fake_syncplay(8u);
  MultiplexAppServices services = lobby_services(syncplay);

  assert(multiplex_app_services_watch_request_lobby_leave(&services));
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND);
  const MultiplexAppServicesWatchQueuedCommand *command =
      &services.watch.state.available.phase.state.queued_command;
  assert(command->kind == MULTIPLEX_APP_SERVICES_WATCH_COMMAND_EXIT);
  assert(!command->payload.exit.disband);
  assert(command->payload.exit.room_index == 0u);
  assert(command->payload.exit.syncplay == syncplay);
  assert(destroyed_count == 0u);
  assert(queued_playback_count == 0u);

  assert(multiplex_app_services_watch_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED);
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP);
  assert(services.watch.state.available.phase.state.wait_stop.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_STOP_EXIT);
  assert(services.watch.state.available.phase.state.wait_stop.syncplay ==
         syncplay);
  assert(queued_playback_count == 1u);
  assert(queued_playback.kind == MULTIPLEX_APP_SERVICES_PLAYBACK_STOP);

  const MultiplexAppServicesPlaybackResult stopped = stopped_result();
  assert(
      multiplex_app_services_watch_apply_playback_result(&services, &stopped));
  assert_destroyed_once_after_service_destroy(&services, syncplay);
}

static void assert_lobby_leave_noop(MultiplexAppServices *services,
                                    MultiplexSyncplaySession *syncplay) {
  const MultiplexAppServicesWatchState before = services->watch;
  assert(multiplex_app_services_watch_request_lobby_leave(services));
  assert(memcmp(&services->watch, &before, sizeof(before)) == 0);
  assert(queued_playback_count == 0u);
  assert(destroyed_count == 0u);
  multiplex_app_services_watch_destroy(services);
  assert(destroyed_count == (syncplay == NULL ? 0u : 1u));
  if (syncplay != NULL) {
    assert(destroyed[0] == syncplay);
  }
}

static void active_lobby_leave_is_noop(void) {
  reset_observations();
  MultiplexSyncplaySession *syncplay = fake_syncplay(9u);
  MultiplexAppServices services = active_services(syncplay);
  assert_lobby_leave_noop(&services, syncplay);
}

static void room_list_lobby_leave_is_noop(void) {
  reset_observations();
  MultiplexAppServices services = {0};
  services.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services.watch.state.available.phase.kind =
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST;
  assert_lobby_leave_noop(&services, NULL);
}

static void other_lobby_leave_phases_are_noops(void) {
  reset_observations();
  MultiplexAppServices reconnect = {0};
  reconnect.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  reconnect.watch.state.available.phase.kind =
      MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT;
  assert_lobby_leave_noop(&reconnect, NULL);

  reset_observations();
  MultiplexSyncplaySession *queued_syncplay = fake_syncplay(10u);
  MultiplexAppServices queued = {0};
  queued.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  queued.watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK,
      .state.queued_playback = {.syncplay = queued_syncplay},
  };
  assert_lobby_leave_noop(&queued, queued_syncplay);

  reset_observations();
  MultiplexSyncplaySession *waiting_syncplay = fake_syncplay(11u);
  MultiplexAppServices waiting = {0};
  waiting.watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  waiting.watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP,
      .state.wait_stop = {.syncplay = waiting_syncplay},
  };
  assert_lobby_leave_noop(&waiting, waiting_syncplay);

  reset_observations();
  MultiplexAppServices unavailable = {0};
  assert_lobby_leave_noop(&unavailable, NULL);
}

static void exit_success_destroys_once(void) {
  reset_observations();
  MultiplexSyncplaySession *syncplay = fake_syncplay(1u);
  MultiplexAppServices services = active_services(syncplay);
  schedule_exit(&services, false);
  const MultiplexAppServicesPlaybackResult stopped = stopped_result();
  assert(
      multiplex_app_services_watch_apply_playback_result(&services, &stopped));
  assert(finished_watch_count == 1u);
  assert_destroyed_once_after_service_destroy(&services, syncplay);
}

static void reset_after_stop_destroys_without_another_stop(void) {
  reset_observations();
  MultiplexSyncplaySession *syncplay = fake_syncplay(12u);
  MultiplexAppServices services = active_services(syncplay);

  assert(multiplex_app_services_watch_reset(&services));
  assert(queued_playback_count == 0u);
  assert(destroyed_count == 1u);
  assert(destroyed[0] == syncplay);
  assert(services.watch.kind == MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE);

  multiplex_app_services_watch_destroy(&services);
  assert(destroyed_count == 1u);
}

static void remote_seek_retains_syncplay_until_replacement_is_ready(void) {
  reset_observations();
  open_hls_succeeds = true;
  rotation_rating_key = 386827u;
  MultiplexSyncplaySession *syncplay = fake_syncplay(13u);
  MultiplexAppServices services = active_services(syncplay);
  const MultiplexAppServicesPlaybackView current = {
      .rating_key = 386827u,
      .duration_ms = 1433600u,
      .position_ms = 143000u,
      .segment_start_ms = 143000u,
      .playing = true,
  };
  const MultiplexAppServicesWatchPlaybackContext context = {
      .purpose = MULTIPLEX_APP_SERVICES_WATCH_START_REMOTE_SEEK,
      .value.remote_seek = {.paused = false},
  };

  assert(multiplex_app_services_watch_begin_playback(
      &services, services.watch.state.available.directory, 0u, 860160u,
      &current, context));
  assert(multiplex_app_services_watch_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED);
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK);
  assert(
      services.watch.state.available.phase.state.starting_playback.syncplay ==
      syncplay);
  assert(destroyed_count == 0u);
  assert(syncplay_connect_count == 0u);

  const MultiplexAppServicesPlaybackResult opened = {
      .token = services.watch.state.available.phase.state.starting_playback
                   .playback_token,
      .kind = MULTIPLEX_APP_SERVICES_PLAYBACK_RESULT_OPENED,
      .playback =
          {
              .rating_key = 386827u,
              .duration_ms = 1433600u,
              .position_ms = 860160u,
              .segment_start_ms = 860160u,
              .playing = true,
          },
  };
  assert(
      multiplex_app_services_watch_apply_playback_result(&services, &opened));
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE);
  assert(services.watch.state.available.phase.state.active.syncplay ==
         syncplay);
  assert(syncplay_connect_count == 0u);
  assert(destroyed_count == 0u);

  multiplex_app_services_watch_destroy(&services);
  assert(destroyed_count == 1u);
  assert(destroyed[0] == syncplay);
}

static void local_seek_claims_before_replacement_is_ready(void) {
  reset_observations();
  rotation_rating_key = 386827u;
  MultiplexSyncplaySession *syncplay = fake_syncplay(14u);
  MultiplexAppServices services = active_services(syncplay);
  services.content.playback.kind = MULTIPLEX_APP_SERVICES_PLAYBACK_KNOWN;
  services.content.playback.value.view = (MultiplexAppServicesPlaybackView){
      .rating_key = 386827u,
      .duration_ms = 1433600u,
      .position_ms = 143000u,
      .segment_start_ms = 143000u,
      .playing = true,
  };
  const MultiplexAppServicesPlaybackPayload request = {
      .rating_key = 386827u,
      .offset_ms = 860160u,
  };

  assert(multiplex_app_services_watch_request_playback(&services, &request));
  assert(local_seek_mark_count == 0u);
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK);
  open_hls_succeeds = true;
  assert(multiplex_app_services_watch_schedule_queued(&services) ==
         MULTIPLEX_APP_SERVICES_SCHEDULE_STARTED);
  assert(local_seek_mark_count == 1u);
  assert(services.watch.state.available.phase.kind ==
         MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK);

  multiplex_app_services_watch_destroy(&services);
  assert(destroyed_count == 1u);
  assert(destroyed[0] == syncplay);
}

static void exit_missing_credentials_destroys_once(void) {
  reset_observations();
  credentials_available = false;
  MultiplexSyncplaySession *syncplay = fake_syncplay(2u);
  MultiplexAppServices services = active_services(syncplay);
  schedule_exit(&services, false);
  const MultiplexAppServicesPlaybackResult stopped = stopped_result();
  assert(
      !multiplex_app_services_watch_apply_playback_result(&services, &stopped));
  assert(finished_watch_count == 1u);
  assert_destroyed_once_after_service_destroy(&services, syncplay);
}

static void rotation_terminal_destroys_once(RotationPlan plan,
                                            bool credentials_present,
                                            uint32_t rating_key,
                                            uintptr_t pointer_value) {
  reset_observations();
  rotation_plan = plan;
  credentials_available = credentials_present;
  rotation_rating_key = rating_key;
  MultiplexSyncplaySession *syncplay = fake_syncplay(pointer_value);
  MultiplexAppServices services = active_services(syncplay);
  schedule_rotation(&services);
  const MultiplexAppServicesPlaybackResult stopped = stopped_result();
  (void)multiplex_app_services_watch_apply_playback_result(&services, &stopped);
  assert(finished_watch_count == 1u);
  assert_destroyed_once_after_service_destroy(&services, syncplay);
}

int main(void) {
  lobby_leave_queues_exit_and_stop();
  active_lobby_leave_is_noop();
  room_list_lobby_leave_is_noop();
  other_lobby_leave_phases_are_noops();
  reset_after_stop_destroys_without_another_stop();
  remote_seek_retains_syncplay_until_replacement_is_ready();
  local_seek_claims_before_replacement_is_ready();
  exit_success_destroys_once();
  exit_missing_credentials_destroys_once();
  rotation_terminal_destroys_once(ROTATION_PLAN_FAILED, true, 0u, 3u);
  rotation_terminal_destroys_once(ROTATION_PLAN_FAILED, false, 0u, 4u);
  rotation_terminal_destroys_once(ROTATION_PLAN_NO_NEXT, true, 0u, 5u);
  rotation_terminal_destroys_once(ROTATION_PLAN_NO_ROOM, true, 0u, 6u);
  rotation_terminal_destroys_once(ROTATION_PLAN_READY, true, 0u, 7u);
  return 0;
}
