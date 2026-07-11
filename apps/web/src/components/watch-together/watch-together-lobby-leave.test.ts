import { describe, expect, test } from "bun:test";
import {
  Idle,
  lobby,
  playing,
  type PlayingItem,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import { isSessionForRoom } from "./watch-together-lobby-leave";

const room = (id: string): WatchTogetherRoom => ({
  id,
  sourceUri: `server://srv/com.plexapp.plugins.library/library/metadata/${id}`,
  title: `Room ${id}`,
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [],
});

const item: PlayingItem = {
  serverId: "srv",
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Item 100",
  type: "episode",
};

describe("isSessionForRoom", () => {
  test("rejects a delayed room-A callback after room-B entry", () => {
    expect(isSessionForRoom(lobby({ room: room("B") }), "A")).toBe(false);
  });

  test("accepts the initiating lobby or playback session only", () => {
    expect(isSessionForRoom(lobby({ room: room("A") }), "A")).toBe(true);
    expect(isSessionForRoom(playing({ room: room("A"), item }), "A")).toBe(
      true,
    );
    expect(isSessionForRoom(Idle, "A")).toBe(false);
  });
});
