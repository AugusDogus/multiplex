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
  assert(strcmp(list.rooms[1].id, "Room456") == 0);
  assert(list.rooms[1].syncplay_port == 32400);
  assert(list.rooms[1].user_count == 0);
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
  assert(multiplex_trpc_parse_user_id(response, sizeof(response) - 1u,
                                      &user_id));
  assert(user_id == 12345);

  static const char missing[] =
      "{\"result\":{\"data\":{\"json\":{\"username\":\"viewer\"}}}}";
  assert(!multiplex_trpc_parse_user_id(missing, sizeof(missing) - 1u,
                                       &user_id));
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
  rejects_malformed_or_oversized_fields();
  puts("GameCube tRPC Watch Together parser tests passed.");
  return 0;
}
