import { describe, expect, it } from "bun:test";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";
import {
  Idle,
  isIdle,
  isLobby,
  isPlaying,
  isRotationArmed,
  isRotationGathering,
  isRotationNone,
  isRotationRoomKnown,
  lobby,
  playing,
  RotationArmed,
  RotationNone,
  rotationGathering,
  rotationNextRoom,
  rotationRoomKnown,
  swapPlayingRoom,
  type PlayingItem,
} from "./session-state";

function room(id: string): WatchTogetherRoom {
  return {
    id,
    sourceUri: `server://server-1/com.plexapp.plugins.library/library/metadata/${id}`,
    title: `Room ${id}`,
    type: "video",
    syncplayHost: "syncplay.example.com",
    syncplayPort: 443,
    users: [{ id: 1, title: "Host", username: "host", thumb: null }],
  };
}

const itemA: PlayingItem = {
  serverId: "server-1",
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Episode 1",
  type: "episode",
  durationSeconds: 1200,
};

const itemB: PlayingItem = {
  serverId: "server-1",
  ratingKey: "200",
  key: "/library/metadata/200",
  title: "Episode 2",
  type: "episode",
  durationSeconds: 1300,
};

describe("SessionState constructors and guards", () => {
  it("builds Idle / Lobby / Playing with defaults", () => {
    expect(Idle).toEqual({ _tag: "Idle" });
    expect(isIdle(Idle)).toBe(true);

    const lobbyState = lobby({ room: room("lobby") });
    expect(lobbyState).toMatchObject({
      _tag: "Lobby",
      participants: {},
      roomPositionSeconds: null,
    });
    expect(isLobby(lobbyState)).toBe(true);
    expect(isPlaying(lobbyState)).toBe(false);

    const playingState = playing({ room: room("play"), item: itemA });
    expect(playingState.rotation).toEqual(RotationNone);
    expect(isPlaying(playingState)).toBe(true);
    expect(isIdle(playingState)).toBe(false);
  });

  it("builds rotation phases and exposes next-room lookup", () => {
    const next = room("next");
    expect(isRotationNone(RotationNone)).toBe(true);
    expect(isRotationArmed(RotationArmed)).toBe(true);

    const known = rotationRoomKnown(next);
    expect(isRotationRoomKnown(known)).toBe(true);
    expect(rotationNextRoom(known)).toEqual(next);

    const gathering = rotationGathering(next, new Set(["device-1"]));
    expect(isRotationGathering(gathering)).toBe(true);
    expect(rotationNextRoom(gathering)).toEqual(next);
    expect(rotationNextRoom(RotationNone)).toBeNull();
    expect(rotationNextRoom(RotationArmed)).toBeNull();
  });

  it("swapPlayingRoom atomically pairs next room with next item and clears rotation", () => {
    const roomA = room("room-a");
    const roomB = room("room-b");
    const before = playing({
      room: roomA,
      item: itemA,
      participants: {
        "device-1": {
          user: { id: 1, deviceIdentifier: "device-1", deviceName: "Multiplex Web" },
          isPresent: true,
        },
      },
      rotation: rotationGathering(roomB, new Set(["device-2"])),
    });

    const after = swapPlayingRoom(before, roomB, itemB);

    expect(after).toEqual({
      _tag: "Playing",
      room: roomB,
      item: itemB,
      participants: {},
      rotation: RotationNone,
    });
    // Invariant: room and item always move together — no intermediate
    // Playing(roomB, itemA) or Playing(roomA, itemB) is produced.
    expect(after.room.id).toBe(roomB.id);
    expect(after.item.ratingKey).toBe(itemB.ratingKey);
    expect(after.rotation._tag).toBe("None");
  });

  it("preserves optional participant map on swap when provided", () => {
    const before = playing({ room: room("a"), item: itemA });
    const participants = {
      d1: {
        user: { id: 1, deviceIdentifier: "d1", deviceName: "Multiplex Web" },
        isPresent: true,
      },
    };
    const after = swapPlayingRoom(before, room("b"), itemB, participants);
    expect(after.participants).toEqual(participants);
  });
});
