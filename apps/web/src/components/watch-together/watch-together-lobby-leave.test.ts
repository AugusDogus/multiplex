import { describe, expect, test } from "bun:test";
import {
  Idle,
  lobby,
  playing,
  type PlayingItem,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import {
  isSessionForRoom,
  resolveLobbyLeaveTarget,
} from "./watch-together-lobby-leave";

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

describe("resolveLobbyLeaveTarget", () => {
  test("leaves and deletes the URL room when it matches the session", () => {
    expect(
      resolveLobbyLeaveTarget(playing({ room: room("A"), item }), "A"),
    ).toEqual({ roomId: "A", leaveSession: true });
    expect(resolveLobbyLeaveTarget(lobby({ room: room("A") }), "A")).toEqual({
      roomId: "A",
      leaveSession: true,
    });
  });

  test("after rotation, Leave on the stale lobby targets the live room", () => {
    expect(
      resolveLobbyLeaveTarget(playing({ room: room("B"), item }), "A"),
    ).toEqual({ roomId: "B", leaveSession: true });
  });

  test("Idle only deletes the URL room", () => {
    expect(resolveLobbyLeaveTarget(Idle, "A")).toEqual({
      roomId: "A",
      leaveSession: false,
    });
  });

  test("viewing another lobby while Lobby elsewhere does not tear that session down", () => {
    expect(resolveLobbyLeaveTarget(lobby({ room: room("B") }), "A")).toEqual({
      roomId: "A",
      leaveSession: false,
    });
  });
});
