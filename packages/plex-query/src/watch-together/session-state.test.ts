import { describe, expect, it } from "bun:test";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";
import {
  AllInvitedPresent,
  Idle,
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

describe("SessionState constructors", () => {
  it("builds Idle / Lobby / Playing with defaults", () => {
    expect(Idle).toEqual({ _tag: "Idle" });

    const lobbyState = lobby({ room: room("lobby") });
    expect(lobbyState).toMatchObject({
      _tag: "Lobby",
      participants: {},
      roomPositionSeconds: null,
      everyonePresentSticky: false,
      startPolicy: AllInvitedPresent,
    });

    const playingState = playing({ room: room("play"), item: itemA });
    expect(playingState._tag).toBe("Playing");
    expect(playingState.rotation).toEqual(RotationNone);
    expect(playingState.startPolicy).toEqual(AllInvitedPresent);
  });

  it("builds rotation phases and exposes next-room lookup", () => {
    const next = room("next");
    expect(RotationNone._tag).toBe("None");
    expect(RotationArmed._tag).toBe("Armed");

    const known = rotationRoomKnown(next);
    expect(known._tag).toBe("RoomKnown");
    expect(rotationNextRoom(known)).toEqual(next);

    const gathering = rotationGathering(next, new Set(["device-1"]));
    expect(gathering._tag).toBe("Gathering");
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
      startPolicy: AllInvitedPresent,
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
