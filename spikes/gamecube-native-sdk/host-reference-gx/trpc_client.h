#ifndef MULTIPLEX_TRPC_CLIENT_H
#define MULTIPLEX_TRPC_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define MULTIPLEX_TRPC_MAX_ROOMS 4u
#define MULTIPLEX_TRPC_ROOM_ID_CAPACITY 64u
#define MULTIPLEX_TRPC_ROOM_TITLE_CAPACITY 96u
#define MULTIPLEX_TRPC_SOURCE_URI_CAPACITY 256u
#define MULTIPLEX_TRPC_SYNCPLAY_HOST_CAPACITY 256u
#define MULTIPLEX_TRPC_MAX_INVITEES 8u
#define MULTIPLEX_TRPC_INVITEE_NAME_CAPACITY 64u

typedef struct {
  char id[MULTIPLEX_TRPC_ROOM_ID_CAPACITY];
  char title[MULTIPLEX_TRPC_ROOM_TITLE_CAPACITY];
  char source_uri[MULTIPLEX_TRPC_SOURCE_URI_CAPACITY];
  char syncplay_host[MULTIPLEX_TRPC_SYNCPLAY_HOST_CAPACITY];
  uint16_t syncplay_port;
  uint8_t user_count;
} MultiplexTrpcRoom;

typedef struct {
  uint8_t room_count;
  MultiplexTrpcRoom rooms[MULTIPLEX_TRPC_MAX_ROOMS];
} MultiplexTrpcRoomList;

typedef struct {
  uint32_t user_id;
  char name[MULTIPLEX_TRPC_INVITEE_NAME_CAPACITY];
} MultiplexTrpcInvitee;

typedef struct {
  uint8_t invitee_count;
  MultiplexTrpcInvitee invitees[MULTIPLEX_TRPC_MAX_INVITEES];
} MultiplexTrpcInviteeList;

bool multiplex_trpc_parse_watch_together_rooms(const char *json, size_t size,
                                                MultiplexTrpcRoomList *list);
bool multiplex_trpc_parse_watch_together_room(const char *json, size_t size,
                                              MultiplexTrpcRoom *room);
bool multiplex_trpc_parse_user_id(const char *json, size_t size,
                                  uint32_t *user_id);
bool multiplex_trpc_parse_watch_together_invitees(
    const char *json, size_t size, MultiplexTrpcInviteeList *list);
bool multiplex_trpc_load_watch_together_rooms(const char *base_url,
                                               const char *bearer_token,
                                               MultiplexTrpcRoomList *list);
bool multiplex_trpc_load_user_id(const char *base_url,
                                 const char *bearer_token,
                                 uint32_t *user_id);
bool multiplex_trpc_load_watch_together_invitees(
    const char *base_url, const char *bearer_token,
    MultiplexTrpcInviteeList *list);
bool multiplex_trpc_create_watch_together_room(
    const char *base_url, const char *bearer_token, const char *server_id,
    uint32_t rating_key, const char *title, uint32_t invitee_user_id,
    MultiplexTrpcRoom *room);

#endif
