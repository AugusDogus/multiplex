#include "app_services_internal.h"

#include "native_ui.h"

#include <limits.h>

#if MULTIPLEX_PAIRING_ENABLED

#define WATCH_TOGETHER_AUTO_START_DELAY_MS 1200u
#define WATCH_TOGETHER_RECONNECT_DELAY_MS 1000u

static bool enter_reconnect_wait(MultiplexAppServices *services,
                                 MultiplexAppServicesWatchDirectory directory,
                                 uint32_t room_index, uint64_t now_ms) {
  multiplex_syncplay_session_destroy(
      multiplex_app_services_watch_take_current_syncplay(&services->watch));
  MultiplexAppServicesRetry retry;
  multiplex_app_services_retry_initialize(&retry,
                                          WATCH_TOGETHER_RECONNECT_DELAY_MS,
                                          WATCH_TOGETHER_RECONNECT_DELAY_MS);
  multiplex_app_services_retry_schedule(&retry, now_ms);
  services->watch.kind = MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE;
  services->watch.state.available = (MultiplexAppServicesWatchAvailable){
      .directory = directory,
      .phase =
          {
              .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT,
              .state.reconnect_wait =
                  {
                      .joined_room_index = room_index,
                      .retry = retry,
                  },
          },
  };
  return multiplex_native_app_watch_together_presence(0, 0) != 0;
}

bool multiplex_app_services_watch_request_reconnect(
    MultiplexAppServices *services,
    const MultiplexAppServicesWatchReconnectPayload *request) {
  if (services == NULL || request == NULL ||
      services->watch.kind != MULTIPLEX_APP_SERVICES_WATCH_AVAILABLE) {
    return services != NULL && request != NULL;
  }
  MultiplexAppServicesWatchPhase *phase =
      &services->watch.state.available.phase;
  if (phase->kind == MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE) {
    const MultiplexAppServicesWatchDirectory directory =
        services->watch.state.available.directory;
    const uint32_t room_index = phase->state.active.joined_room_index;
    if (!enter_reconnect_wait(services, directory, room_index,
                              request->now_ms)) {
      return false;
    }
    services->watch.state.available.phase.state.reconnect_wait.retry.at_ms =
        request->now_ms;
  } else if (phase->kind == MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT) {
    phase->state.reconnect_wait.retry.at_ms = request->now_ms;
  } else {
    return true;
  }
  return multiplex_native_app_watch_together_reconnect_commit() != 0;
}

static bool tick_lobby(MultiplexAppServices *services, uint64_t now_ms,
                       const MultiplexAppServicesPlaybackView *playback) {
  MultiplexAppServicesWatchLobby *lobby =
      &services->watch.state.available.phase.state.lobby;
  MultiplexAppServicesWatchDirectory *directory =
      &services->watch.state.available.directory;
  if (!multiplex_syncplay_session_poll(lobby->syncplay)) {
    const MultiplexAppServicesWatchDirectory saved = *directory;
    multiplex_app_services_watch_enter_room_list(services, saved);
    return multiplex_native_app_watch_together_presence(0, 0) != 0 &&
           multiplex_native_app_watch_together_join_commit(0) != 0 &&
           multiplex_app_services_queue_refresh(services, false);
  }
  if (lobby->joined_room_index >= directory->rooms.room_count) {
    return false;
  }
  const unsigned present_value =
      multiplex_syncplay_session_participant_count(lobby->syncplay);
  const uint8_t present =
      present_value > UINT8_MAX ? UINT8_MAX : (uint8_t)present_value;
  if (multiplex_native_app_watch_together_presence(1, present) == 0) {
    return false;
  }
  const uint8_t expected =
      directory->rooms.rooms[lobby->joined_room_index].user_count;
  if (!multiplex_app_services_presence_step(expected, present, now_ms,
                                            WATCH_TOGETHER_AUTO_START_DELAY_MS,
                                            &lobby->all_present_since_ms)) {
    return true;
  }
  uint32_t position_ms = 0;
  bool paused = true;
  multiplex_syncplay_session_room_position(lobby->syncplay, &position_ms,
                                           &paused);
  const MultiplexAppServicesWatchDirectory saved = *directory;
  const uint32_t room_index = lobby->joined_room_index;
  const MultiplexAppServicesWatchPlaybackContext context = {
      .purpose = MULTIPLEX_APP_SERVICES_WATCH_START_LOBBY,
  };
  return multiplex_app_services_watch_begin_playback(
      services, saved, room_index, position_ms, playback, context);
}

static bool tick_active(MultiplexAppServices *services, uint64_t now_ms,
                        const MultiplexAppServicesPlaybackView *playback) {
  MultiplexAppServicesWatchActive *active =
      &services->watch.state.available.phase.state.active;
  const MultiplexAppServicesWatchDirectory directory =
      services->watch.state.available.directory;
  multiplex_syncplay_session_set_playback(active->syncplay, !playback->playing,
                                          playback->position_ms);
  if (!multiplex_syncplay_session_poll(active->syncplay)) {
    const uint32_t room_index = active->joined_room_index;
    return enter_reconnect_wait(services, directory, room_index, now_ms);
  }
  const unsigned present =
      multiplex_syncplay_session_participant_count(active->syncplay);
  if (multiplex_native_app_watch_together_presence(1, present) == 0) {
    return false;
  }
  bool remote_paused = false;
  bool remote_seek = false;
  uint32_t remote_position_ms = 0;
  if (!multiplex_syncplay_session_take_remote_playback(
          active->syncplay, &remote_paused, &remote_position_ms,
          &remote_seek)) {
    return true;
  }
  if (remote_seek) {
    const uint32_t room_index = active->joined_room_index;
    const MultiplexAppServicesWatchPlaybackContext context = {
        .purpose = MULTIPLEX_APP_SERVICES_WATCH_START_REMOTE_SEEK,
        .value.remote_seek.paused = remote_paused,
    };
    return multiplex_app_services_watch_begin_playback(
        services, directory, room_index, remote_position_ms, playback, context);
  }
  if (multiplex_native_app_playback_set_paused(remote_paused ? 1u : 0u) == 0) {
    return false;
  }
  multiplex_syncplay_session_adopt_playback(active->syncplay, remote_paused,
                                            remote_position_ms);
  return multiplex_app_services_queue_refresh(services, false);
}

static bool tick_reconnect(MultiplexAppServices *services, uint64_t now_ms,
                           const MultiplexAppServicesPlaybackView *playback) {
  MultiplexAppServicesWatchReconnectWait *waiting =
      &services->watch.state.available.phase.state.reconnect_wait;
  MultiplexAppServicesWatchDirectory *directory =
      &services->watch.state.available.directory;
  if (!multiplex_app_services_retry_due(&waiting->retry, now_ms)) {
    return true;
  }
  if (waiting->joined_room_index >= directory->rooms.room_count) {
    return false;
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return false;
  }
  MultiplexSyncplaySession *syncplay = multiplex_syncplay_session_connect(
      &directory->rooms.rooms[waiting->joined_room_index],
      credentials->plex_client_id, directory->plex_user_id, false);
  if (syncplay == NULL) {
    multiplex_app_services_retry_schedule(&waiting->retry, now_ms);
    return true;
  }
  multiplex_syncplay_session_adopt_playback(syncplay, !playback->playing,
                                            playback->position_ms);
  const uint32_t room_index = waiting->joined_room_index;
  services->watch.state.available.phase = (MultiplexAppServicesWatchPhase){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE,
      .state.active =
          {
              .joined_room_index = room_index,
              .syncplay = syncplay,
          },
  };
  return multiplex_native_app_watch_together_presence(1, 1) != 0;
}

bool multiplex_app_services_watch_tick(
    MultiplexAppServices *services, uint64_t now_ms,
    const MultiplexAppServicesPlaybackView *playback) {
  if (services == NULL || playback == NULL) {
    return false;
  }
  if (services->watch.kind == MULTIPLEX_APP_SERVICES_WATCH_UNAVAILABLE) {
    return true;
  }
  switch (services->watch.state.available.phase.kind) {
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_LOBBY:
    return tick_lobby(services, now_ms, playback);
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ACTIVE:
    return tick_active(services, now_ms, playback);
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_RECONNECT_WAIT:
    return tick_reconnect(services, now_ms, playback);
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_ROOM_LIST:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_COMMAND:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_QUEUED_PLAYBACK:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_STARTING_PLAYBACK:
  case MULTIPLEX_APP_SERVICES_WATCH_PHASE_WAIT_STOP:
    return true;
  }
  return false;
}

#endif
