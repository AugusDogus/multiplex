import { describe, expect, test } from "bun:test";
import type {
  SyncplayParticipantState,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";

import {
  findNextEpisodeRoom,
  getAutoAdvanceRank,
  getMultiplexParticipants,
  haveMultiplexParticipantsJoined,
  mergeParticipantState,
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
} from "./watch-together-auto-advance";

const NOW = 1_750_000_000_000;

function multiplexUser(id: number, device = `device-${id}`): SyncplayUser {
  return {
    id,
    deviceIdentifier: device,
    deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  };
}

function officialUser(id: number, device = `official-${id}`): SyncplayUser {
  return { id, deviceIdentifier: device, deviceName: "Plex Web" };
}

function present(user: SyncplayUser): SyncplayParticipantState {
  return { user, isPresent: true };
}

function room(
  overrides: Partial<WatchTogetherRoom> & Pick<WatchTogetherRoom, "id">,
): WatchTogetherRoom {
  return {
    sourceUri:
      "server://server-1/com.plexapp.plugins.library/library/metadata/200",
    title: "Next Episode",
    type: "video",
    syncplayHost: "syncplay.example.com",
    syncplayPort: 443,
    users: [
      { id: 1, title: "Host", username: "host", thumb: null },
      { id: 2, title: "Guest", username: "guest", thumb: null },
    ],
    updatedAt: Math.floor(NOW / 1000),
    ...overrides,
  };
}

describe("getMultiplexParticipants / getAutoAdvanceRank", () => {
  test("orders Multiplex participants deterministically by user id then device", () => {
    const a = multiplexUser(2, "bbb");
    const b = multiplexUser(2, "aaa");
    const c = multiplexUser(1);
    const participants = {
      [a.deviceIdentifier]: present(a),
      [b.deviceIdentifier]: present(b),
      [c.deviceIdentifier]: present(c),
    };

    const ordered = getMultiplexParticipants(participants, a);
    expect(ordered.map((user) => user.deviceIdentifier)).toEqual([
      "device-1",
      "aaa",
      "bbb",
    ]);
    expect(getAutoAdvanceRank(participants, c)).toBe(0);
    expect(getAutoAdvanceRank(participants, b)).toBe(1);
    expect(getAutoAdvanceRank(participants, a)).toBe(2);
  });

  test("ignores official Plex clients and absent participants", () => {
    const local = multiplexUser(5);
    const official = officialUser(1);
    const left = multiplexUser(2);
    const participants = {
      [official.deviceIdentifier]: present(official),
      [left.deviceIdentifier]: { user: left, isPresent: false },
    };

    // Only the local user remains, so it leads despite the higher user id.
    expect(getAutoAdvanceRank(participants, local)).toBe(0);
  });

  test("counts the local user as present even without a participant frame", () => {
    const local = multiplexUser(1);
    expect(getMultiplexParticipants({}, local)).toEqual([local]);
  });
});

describe("findNextEpisodeRoom", () => {
  const currentRoom = {
    id: "room-current",
    users: [
      { id: 1, title: "Host", username: "host", thumb: null },
      { id: 2, title: "Guest", username: "guest", thumb: null },
    ],
  };
  const input = {
    serverId: "server-1",
    nextRatingKey: "200",
    currentRoom,
    now: NOW,
  };

  test("finds the room pointing at the next episode with the whole party invited", () => {
    const match = room({ id: "room-next" });
    expect(findNextEpisodeRoom({ ...input, rooms: [match] })).toEqual(match);
  });

  test("rejects the current room, wrong items, and rooms missing party members", () => {
    const wrongEpisode = room({
      id: "room-wrong",
      sourceUri:
        "server://server-1/com.plexapp.plugins.library/library/metadata/999",
    });
    const wrongServer = room({
      id: "room-server",
      sourceUri:
        "server://server-2/com.plexapp.plugins.library/library/metadata/200",
    });
    const missingGuest = room({
      id: "room-partial",
      users: [{ id: 1, title: "Host", username: "host", thumb: null }],
    });
    const sameRoom = room({ id: "room-current" });

    expect(
      findNextEpisodeRoom({
        ...input,
        rooms: [wrongEpisode, wrongServer, missingGuest, sameRoom],
      }),
    ).toBeNull();
  });

  test("rejects stale rooms from an earlier watch party", () => {
    const stale = room({
      id: "room-stale",
      updatedAt: Math.floor(NOW / 1000) - 60 * 60,
    });
    expect(findNextEpisodeRoom({ ...input, rooms: [stale] })).toBeNull();
  });

  test("resolves duplicates deterministically (newest, then highest id)", () => {
    const older = room({
      id: "room-z",
      updatedAt: Math.floor(NOW / 1000) - 60,
    });
    const newer = room({ id: "room-a" });
    expect(findNextEpisodeRoom({ ...input, rooms: [older, newer] })?.id).toBe(
      "room-a",
    );

    const tieA = room({ id: "room-a" });
    const tieB = room({ id: "room-b" });
    expect(findNextEpisodeRoom({ ...input, rooms: [tieB, tieA] })?.id).toBe(
      "room-b",
    );
  });

  test("accepts millisecond timestamps", () => {
    const msRoom = room({ id: "room-ms", updatedAt: NOW - 5_000 });
    expect(findNextEpisodeRoom({ ...input, rooms: [msRoom] })?.id).toBe(
      "room-ms",
    );
  });
});

describe("haveMultiplexParticipantsJoined", () => {
  const local = multiplexUser(1);
  const remote = multiplexUser(2);
  const official = officialUser(3);
  const sessionParticipants = {
    [local.deviceIdentifier]: present(local),
    [remote.deviceIdentifier]: present(remote),
    [official.deviceIdentifier]: present(official),
  };

  test("waits for remote Multiplex participants, not official clients or self", () => {
    expect(
      haveMultiplexParticipantsJoined(sessionParticipants, {}, local),
    ).toBe(false);

    expect(
      haveMultiplexParticipantsJoined(
        sessionParticipants,
        { [remote.deviceIdentifier]: present(remote) },
        local,
      ),
    ).toBe(true);
  });

  test("a participant who left the next room doesn't count as joined", () => {
    expect(
      haveMultiplexParticipantsJoined(
        sessionParticipants,
        { [remote.deviceIdentifier]: { user: remote, isPresent: false } },
        local,
      ),
    ).toBe(false);
  });
});

describe("mergeParticipantState", () => {
  const user = multiplexUser(1);

  test("partial updates keep previously learned fields", () => {
    const afterJoin = mergeParticipantState({}, present(user));
    const afterReady = mergeParticipantState(afterJoin, {
      user,
      isReady: true,
    });
    expect(afterReady[user.deviceIdentifier]).toMatchObject({
      isPresent: true,
      isReady: true,
    });
  });

  test("a leave replaces the entry so stale readiness doesn't survive", () => {
    const joined = mergeParticipantState(
      {},
      { user, isPresent: true, isReady: true },
    );
    const left = mergeParticipantState(joined, { user, isPresent: false });
    expect(left[user.deviceIdentifier]).toEqual({ user, isPresent: false });
  });
});
