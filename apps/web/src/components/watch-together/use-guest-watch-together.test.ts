import { describe, expect, test } from "bun:test";
import {
  Idle,
  lobby,
  type SessionState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import {
  getGuestRotationTimeline,
  requestGuestLobbyEntry,
  shouldSwapGuestContinuation,
  type GuestLobbyEntryCommands,
} from "./use-guest-watch-together";

const room: WatchTogetherRoom = {
  id: "room-1",
  sourceUri: "server://srv/com.plexapp.plugins.library/library/metadata/100",
  title: "Room 1",
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
};

const localUser: SyncplayUser = {
  id: 2,
  deviceIdentifier: "guest-device",
  deviceName: "Multiplex Guest · Test",
};

const hostUser: SyncplayUser = {
  id: 1,
  deviceIdentifier: "host-device",
  deviceName: "Multiplex Web",
};

const entry = {
  room,
  localUser,
  startPolicy: {
    _tag: "HostControlled",
    localRole: "Guest",
    hostUserId: 1,
    guestUserId: 2,
  },
} as const;

describe("guest lobby lifecycle", () => {
  test("does not duplicate pending or active entry and recovers from Idle", async () => {
    let sessionState: SessionState = Idle;
    const enteredRoomIds: string[] = [];
    const commands: GuestLobbyEntryCommands = {
      snapshot: () => sessionState,
      enterLobby: (input) => {
        enteredRoomIds.push(input.room.id);
        return { completion: Promise.resolve() };
      },
    };
    const pendingRoomIdRef = { current: null };

    requestGuestLobbyEntry(commands, pendingRoomIdRef, entry);
    requestGuestLobbyEntry(commands, pendingRoomIdRef, entry);
    expect(enteredRoomIds).toEqual([room.id]);

    await Promise.resolve();
    sessionState = lobby({ room, startPolicy: entry.startPolicy });
    requestGuestLobbyEntry(commands, pendingRoomIdRef, entry);
    expect(enteredRoomIds).toEqual([room.id]);

    sessionState = Idle;
    requestGuestLobbyEntry(commands, pendingRoomIdRef, entry);
    requestGuestLobbyEntry(commands, pendingRoomIdRef, entry);
    expect(enteredRoomIds).toEqual([room.id, room.id]);
  });
});

describe("getGuestRotationTimeline", () => {
  test("uses present host progress and metadata duration for a stalled guest", () => {
    const sessionState: SessionState = {
      ...lobby({ room, startPolicy: entry.startPolicy }),
      _tag: "Playing",
      item: {
        serverId: "srv",
        ratingKey: "100",
        key: "/library/metadata/100",
        title: "Episode",
        type: "episode",
      },
      rotation: { _tag: "None" },
      participants: {
        [hostUser.deviceIdentifier]: {
          user: hostUser,
          isPresent: true,
          positionSeconds: 116,
        },
      },
    };

    expect(
      getGuestRotationTimeline({
        localCurrentTimeSeconds: 0,
        localDurationSeconds: 0,
        itemDurationMilliseconds: 120_000,
        sessionState,
      }),
    ).toEqual({
      currentTimeSeconds: 116,
      durationSeconds: 120,
      timeRemainingSeconds: 4,
      inLeadWindow: true,
      atEnd: false,
    });
  });

  test("treats host completion as the end even when guest playback is stuck", () => {
    const sessionState: SessionState = {
      _tag: "Playing",
      room,
      item: {
        serverId: "srv",
        ratingKey: "100",
        key: "/library/metadata/100",
        title: "Episode",
        type: "episode",
      },
      participants: {
        [hostUser.deviceIdentifier]: {
          user: hostUser,
          isPresent: true,
          positionSeconds: 120,
        },
      },
      rotation: { _tag: "None" },
      startPolicy: entry.startPolicy,
    };

    const timeline = getGuestRotationTimeline({
      localCurrentTimeSeconds: 10,
      localDurationSeconds: 120,
      sessionState,
    });

    expect(timeline.currentTimeSeconds).toBe(120);
    expect(timeline.atEnd).toBe(true);
  });

  test("ignores host progress when the host is not present", () => {
    const sessionState: SessionState = {
      _tag: "Playing",
      room,
      item: {
        serverId: "srv",
        ratingKey: "100",
        key: "/library/metadata/100",
        title: "Episode",
        type: "episode",
      },
      participants: {
        [hostUser.deviceIdentifier]: {
          user: hostUser,
          isPresent: false,
          positionSeconds: 120,
        },
      },
      rotation: { _tag: "None" },
      startPolicy: entry.startPolicy,
    };

    const timeline = getGuestRotationTimeline({
      localCurrentTimeSeconds: 10,
      localDurationSeconds: 120,
      sessionState,
    });

    expect(timeline.currentTimeSeconds).toBe(10);
    expect(timeline.inLeadWindow).toBe(false);
    expect(timeline.atEnd).toBe(false);
  });
});

describe("shouldSwapGuestContinuation", () => {
  const playingState = (
    hostPresent: boolean,
  ): Extract<SessionState, { _tag: "Playing" }> => ({
    _tag: "Playing",
    room,
    item: {
      serverId: "srv",
      ratingKey: "100",
      key: "/library/metadata/100",
      title: "Episode",
      type: "episode",
    },
    participants: {
      [hostUser.deviceIdentifier]: {
        user: hostUser,
        isPresent: hostPresent,
        positionSeconds: 40,
      },
    },
    rotation: { _tag: "None" },
    startPolicy: entry.startPolicy,
  });

  test("swaps when the host explicitly leaves before its EOF seek arrives", () => {
    expect(
      shouldSwapGuestContinuation({
        atEnd: false,
        roomId: room.id,
        hostUserId: hostUser.id,
        sessionState: playingState(false),
      }),
    ).toBe(true);
  });

  test("does not treat a present host or an empty snapshot as completion", () => {
    expect(
      shouldSwapGuestContinuation({
        atEnd: false,
        roomId: room.id,
        hostUserId: hostUser.id,
        sessionState: playingState(true),
      }),
    ).toBe(false);
    expect(
      shouldSwapGuestContinuation({
        atEnd: false,
        roomId: room.id,
        hostUserId: hostUser.id,
        sessionState: { ...playingState(true), participants: {} },
      }),
    ).toBe(false);
  });
});
