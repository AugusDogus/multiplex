#include "trpc_client.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void parses_empty_rooms(void) {
  static const char response[] = "{\"result\":{\"data\":{\"json\":[]}}}";
  MultiplexTrpcRoomList list;
  assert(multiplex_trpc_parse_watch_together_rooms(
      response, sizeof(response) - 1u, &list));
  assert(list.room_count == 0);
}

static void parses_bounded_room_summaries(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":["
      "{\"id\":\"Room123\",\"sourceUri\":\"plex://movie\","
      "\"title\":\"Friday Night\",\"type\":\"video\","
      "\"syncplayHost\":\"sync.example.test\",\"syncplayPort\":443,"
      "\"users\":[{\"id\":1,\"title\":\"Host\"},{\"id\":2}]},"
      "{\"id\":\"Room456\",\"title\":\"Second Room\","
      "\"sourceUri\":\"plex://episode\","
      "\"syncplayHost\":\"other.example.test\",\"syncplayPort\":32400,"
      "\"users\":[]}"
      "],\"meta\":{\"values\":{\"0.startsAt\":[\"Date\"]}}}}}";
  MultiplexTrpcRoomList list;
  assert(multiplex_trpc_parse_watch_together_rooms(
      response, sizeof(response) - 1u, &list));
  assert(list.room_count == 2);
  assert(strcmp(list.rooms[0].id, "Room123") == 0);
  assert(strcmp(list.rooms[0].title, "Friday Night") == 0);
  assert(strcmp(list.rooms[0].source_uri, "plex://movie") == 0);
  assert(strcmp(list.rooms[0].syncplay_host, "sync.example.test") == 0);
  assert(list.rooms[0].syncplay_port == 443);
  assert(list.rooms[0].user_count == 2);
  assert(list.rooms[0].user_ids[0] == 1);
  assert(list.rooms[0].user_ids[1] == 2);
  assert(strcmp(list.rooms[1].id, "Room456") == 0);
  assert(list.rooms[1].syncplay_port == 32400);
  assert(list.rooms[1].user_count == 0);
}

static void compares_exact_room_parties(void) {
  const MultiplexTrpcRoom first = {
      .user_count = 2,
      .user_ids = {10u, 20u},
  };
  const MultiplexTrpcRoom same_reordered = {
      .user_count = 2,
      .user_ids = {20u, 10u},
  };
  const MultiplexTrpcRoom same_count_wrong_party = {
      .user_count = 2,
      .user_ids = {10u, 30u},
  };
  assert(multiplex_trpc_rooms_have_same_users(&first, &same_reordered));
  assert(
      !multiplex_trpc_rooms_have_same_users(&first, &same_count_wrong_party));
}

static void parses_created_room(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":{"
      "\"id\":\"Created123\",\"sourceUri\":\"server://abc/item/42\","
      "\"title\":\"A \\\"Quoted\\\" Movie\",\"type\":\"video\","
      "\"syncplayHost\":\"sync.example.test\",\"syncplayPort\":443,"
      "\"users\":[{\"id\":1}]}}}}";
  MultiplexTrpcRoom room;
  assert(multiplex_trpc_parse_watch_together_room(
      response, sizeof(response) - 1u, &room));
  assert(strcmp(room.id, "Created123") == 0);
  assert(strcmp(room.title, "A \"Quoted\" Movie") == 0);
  assert(strcmp(room.source_uri, "server://abc/item/42") == 0);
  assert(room.user_count == 1);
}

static void parses_plex_user_id(void) {
  static const char response[] =
      "{\"result\":{\"data\":{\"json\":{\"id\":12345,"
      "\"username\":\"viewer\"}}}}";
  uint32_t user_id = 0;
  assert(
      multiplex_trpc_parse_user_id(response, sizeof(response) - 1u, &user_id));
  assert(user_id == 12345);

  static const char missing[] =
      "{\"result\":{\"data\":{\"json\":{\"username\":\"viewer\"}}}}";
  assert(
      !multiplex_trpc_parse_user_id(missing, sizeof(missing) - 1u, &user_id));
}

static void parses_watch_together_invitees(void) {
  static const char response[] = "{\"result\":{\"data\":{\"json\":["
                                 "{\"id\":12345,\"title\":\"Friendly viewer\","
                                 "\"username\":\"viewer\"},"
                                 "{\"id\":67890,\"username\":\"second-viewer\"}"
                                 "]}}}";
  MultiplexTrpcInviteeList list;
  assert(multiplex_trpc_parse_watch_together_invitees(
      response, sizeof(response) - 1u, &list));
  assert(list.invitee_count == 2);
  assert(list.invitees[0].user_id == 12345);
  assert(strcmp(list.invitees[0].name, "Friendly viewer") == 0);
  assert(list.invitees[1].user_id == 67890);
  assert(strcmp(list.invitees[1].name, "second-viewer") == 0);

  static const char malformed[] = "{\"result\":{\"data\":{\"json\":[{\"id\":0,"
                                  "\"username\":\"viewer\"}]}}}";
  assert(!multiplex_trpc_parse_watch_together_invitees(
      malformed, sizeof(malformed) - 1u, &list));

  static const char twelve_invitees[] =
      "{\"result\":{\"data\":{\"json\":["
      "{\"id\":1,\"username\":\"one\"},"
      "{\"id\":2,\"username\":\"two\"},"
      "{\"id\":3,\"username\":\"three\"},"
      "{\"id\":4,\"username\":\"four\"},"
      "{\"id\":5,\"username\":\"five\"},"
      "{\"id\":6,\"username\":\"six\"},"
      "{\"id\":7,\"username\":\"seven\"},"
      "{\"id\":8,\"username\":\"eight\"},"
      "{\"id\":9,\"username\":\"nine\"},"
      "{\"id\":10,\"username\":\"ten\"},"
      "{\"id\":11,\"username\":\"eleven\"},"
      "{\"id\":12,\"username\":\"twelve\"}]}}}";
  assert(multiplex_trpc_parse_watch_together_invitees(
      twelve_invitees, sizeof(twelve_invitees) - 1u, &list));
  assert(list.invitee_count == 12u);
  assert(list.invitees[11].user_id == 12u);
  assert(strcmp(list.invitees[11].name, "twelve") == 0);
}

static void rejects_malformed_or_oversized_fields(void) {
  static const char malformed[] =
      "{\"result\":{\"data\":{\"json\":[{\"id\":\"Room123\","
      "\"title\":\"Missing transport\",\"users\":[]}]}}}";
  static const char oversized_port[] =
      "{\"result\":{\"data\":{\"json\":[{\"id\":\"Room123\","
      "\"title\":\"Bad port\",\"syncplayHost\":\"host\","
      "\"syncplayPort\":65536,\"users\":[]}]}}}";
  MultiplexTrpcRoomList list;
  assert(!multiplex_trpc_parse_watch_together_rooms(
      malformed, sizeof(malformed) - 1u, &list));
  assert(!multiplex_trpc_parse_watch_together_rooms(
      oversized_port, sizeof(oversized_port) - 1u, &list));
}

int main(void) {
  parses_empty_rooms();
  parses_bounded_room_summaries();
  parses_created_room();
  parses_plex_user_id();
  parses_watch_together_invitees();
  compares_exact_room_parties();
  rejects_malformed_or_oversized_fields();
  puts("GameCube tRPC Watch Together parser tests passed.");
  return 0;
}
