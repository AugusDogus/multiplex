#include "app_services_internal.h"

#include "media-source.h"
#include "native_ui.h"
#include "plex_catalog.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if MULTIPLEX_PAIRING_ENABLED

bool multiplex_app_services_watch_directory_bind_rooms(
    const MultiplexTrpcRoomList *rooms, bool available) {
  if (multiplex_native_app_watch_together_begin(
          available ? 1u : 0u, available ? rooms->room_count : 0u) == 0) {
    return false;
  }
  if (available) {
    for (uint8_t index = 0; index < rooms->room_count; ++index) {
      const MultiplexTrpcRoom *room = &rooms->rooms[index];
      if (multiplex_native_app_watch_together_room(
              index, (const uint8_t *)room->title, strlen(room->title),
              room->user_count) == 0) {
        return false;
      }
    }
  }
  return multiplex_native_app_watch_together_commit() != 0;
}

bool multiplex_app_services_watch_directory_bind_invitees(
    const MultiplexTrpcInviteeList *invitees, bool available) {
  if (multiplex_native_app_watch_together_invitees_begin(
          available ? 1u : 0u, available ? invitees->invitee_count : 0u) == 0) {
    return false;
  }
  if (available) {
    for (uint8_t index = 0; index < invitees->invitee_count; ++index) {
      const MultiplexTrpcInvitee *invitee = &invitees->invitees[index];
      if (multiplex_native_app_watch_together_invitee(
              index, invitee->user_id, (const uint8_t *)invitee->name,
              strlen(invitee->name)) == 0) {
        return false;
      }
    }
  }
  return multiplex_native_app_watch_together_invitees_commit() != 0;
}

uint32_t multiplex_app_services_watch_directory_rating_key(
    const MultiplexTrpcRoom *room) {
  static const char marker[] = "/metadata/";
  if (room == NULL) {
    return 0;
  }
  const char *value = strstr(room->source_uri, marker);
  if (value == NULL) {
    return 0;
  }
  value += sizeof(marker) - 1u;
  char *end = NULL;
  const unsigned long parsed = strtoul(value, &end, 10);
  return end != value && *end == '\0' && parsed != 0 && parsed <= UINT32_MAX
             ? (uint32_t)parsed
             : 0;
}

static bool retain_room(MultiplexAppServicesWatchDirectory *directory,
                        const MultiplexTrpcRoom *room) {
  uint8_t existing = directory->rooms.room_count;
  for (uint8_t index = 0; index < directory->rooms.room_count; ++index) {
    if (strcmp(directory->rooms.rooms[index].id, room->id) == 0) {
      existing = index;
      break;
    }
  }
  if (existing < directory->rooms.room_count) {
    directory->rooms.rooms[existing] = *room;
  } else {
    const uint8_t retained =
        directory->rooms.room_count < MULTIPLEX_TRPC_MAX_ROOMS
            ? directory->rooms.room_count
            : MULTIPLEX_TRPC_MAX_ROOMS - 1u;
    memmove(&directory->rooms.rooms[1], &directory->rooms.rooms[0],
            (size_t)retained * sizeof(directory->rooms.rooms[0]));
    directory->rooms.rooms[0] = *room;
    directory->rooms.room_count = retained + 1u;
  }
  return multiplex_app_services_watch_directory_bind_rooms(&directory->rooms,
                                                           true);
}

bool multiplex_app_services_watch_directory_refresh(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory) {
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return false;
  }
  MultiplexTrpcRoomList rooms = {0};
  const bool available = multiplex_trpc_load_watch_together_rooms(
      MULTIPLEX_BASE_URL, credentials->session_token, &rooms);
  if (available) {
    directory->rooms = rooms;
  }
  return multiplex_app_services_watch_directory_bind_rooms(&directory->rooms,
                                                           available);
}

bool multiplex_app_services_watch_directory_create(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesWatchCreatePayload *request) {
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return false;
  }
  MultiplexTrpcRoom created = {0};
  if (!multiplex_trpc_create_watch_together_room(
          MULTIPLEX_BASE_URL, credentials->session_token,
          credentials->plex_server_id, request->rating_key, request->title,
          request->invitee_user_id, &created)) {
    return multiplex_native_app_watch_together_create_fail() != 0;
  }
  if (!retain_room(directory, &created)) {
    return false;
  }
  directory->hosted.kind = MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT;
  directory->hosted.invitee_user_id = request->invitee_user_id;
  snprintf(directory->hosted.id, sizeof(directory->hosted.id), "%s",
           created.id);
  return true;
}

bool multiplex_app_services_watch_directory_delete_hosted(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory, uint32_t room_index,
    bool *deleted) {
  if (deleted == NULL) {
    return false;
  }
  *deleted = false;
  if (room_index >= directory->rooms.room_count ||
      directory->hosted.kind != MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT ||
      strcmp(directory->rooms.rooms[room_index].id, directory->hosted.id) !=
          0) {
    return true;
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return false;
  }
  *deleted = multiplex_trpc_delete_watch_together_room(
      MULTIPLEX_BASE_URL, credentials->session_token, directory->hosted.id);
  if (*deleted) {
    directory->hosted = (MultiplexAppServicesHostedRoom){0};
  }
  return true;
}

static uint32_t find_rotation_room(const MultiplexTrpcRoomList *rooms,
                                   const char *previous_room_id,
                                   uint32_t rating_key, uint8_t user_count) {
  for (uint32_t index = 0; index < rooms->room_count; ++index) {
    const MultiplexTrpcRoom *room = &rooms->rooms[index];
    if (strcmp(room->id, previous_room_id) != 0 &&
        room->user_count == user_count &&
        multiplex_app_services_watch_directory_rating_key(room) == rating_key) {
      return index;
    }
  }
  return UINT32_MAX;
}

bool multiplex_app_services_watch_directory_plan_rotation(
    MultiplexAppServices *services,
    MultiplexAppServicesWatchDirectory *directory,
    const MultiplexAppServicesPlaybackView *completed,
    uint32_t joined_room_index, MultiplexAppServicesWatchRotation *rotation) {
  if (joined_room_index >= directory->rooms.room_count || rotation == NULL) {
    return false;
  }
  const MultiplexAuthCredentials *credentials =
      multiplex_app_services_auth_credentials(services);
  if (credentials == NULL) {
    return false;
  }
  const MultiplexTrpcRoom previous = directory->rooms.rooms[joined_room_index];
  *rotation = (MultiplexAppServicesWatchRotation){
      .kind = MULTIPLEX_APP_SERVICES_WATCH_ROTATION_COMPLETE,
  };
  snprintf(rotation->previous_room_id, sizeof(rotation->previous_room_id), "%s",
           previous.id);
  MultiplexGatewayItem next;
  if (multiplex_plex_load_next_episode(credentials, completed->rating_key,
                                       &next) !=
      MULTIPLEX_PLEX_NEXT_EPISODE_FOUND) {
    return true;
  }
  if (!multiplex_app_services_watch_directory_refresh(services, directory)) {
    return false;
  }
  uint32_t next_index = find_rotation_room(
      &directory->rooms, previous.id, next.rating_key, previous.user_count);
  bool created = false;
  if (next_index == UINT32_MAX &&
      directory->hosted.kind == MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT &&
      directory->hosted.invitee_user_id != 0) {
    MultiplexTrpcRoom room = {0};
    created = multiplex_trpc_create_watch_together_room(
        MULTIPLEX_BASE_URL, credentials->session_token,
        credentials->plex_server_id, next.rating_key, next.title,
        directory->hosted.invitee_user_id, &room);
    if (created && retain_room(directory, &room)) {
      next_index = find_rotation_room(&directory->rooms, previous.id,
                                      next.rating_key, previous.user_count);
      directory->hosted.kind = MULTIPLEX_APP_SERVICES_HOSTED_ROOM_PRESENT;
      snprintf(directory->hosted.id, sizeof(directory->hosted.id), "%s",
               room.id);
    } else {
      created = false;
    }
  }
  if (next_index == UINT32_MAX) {
    return true;
  }
  rotation->kind = MULTIPLEX_APP_SERVICES_WATCH_ROTATION_READY;
  rotation->room_index = next_index;
  rotation->created = created;
  return true;
}

#endif
