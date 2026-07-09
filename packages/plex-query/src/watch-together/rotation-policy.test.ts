import { describe, expect, it } from "bun:test";
import type { SyncplayParticipantState, SyncplayUser } from "../plex/clients/syncplay-client";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";
import {
  ADVANCE_LEAD_SECONDS,
  CREATE_BASE_DELAY_MS,
  CREATE_STAGGER_MS,
  createRoomDelayMs,
  decideRotation,
  END_THRESHOLD_SECONDS,
  EVERYONE_JOINED_GRACE_MS,
  findNextEpisodeRoom,
  getAutoAdvanceRank,
  getMultiplexParticipants,
  haveMultiplexParticipantsJoined,
  isAtEnd,
  isInLeadWindow,
  mergeParticipantState,
  MIN_PLAYBACK_SECONDS,
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
} from "./rotation-policy";
import { RotationArmed, RotationNone, rotationGathering, rotationRoomKnown } from "./session-state";

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
    sourceUri: "server://server-1/com.plexapp.plugins.library/library/metadata/200",
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

const currentRoom = {
  id: "room-current",
  users: [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
};

const baseDecide = {
  durationSeconds: 1200,
  currentTimeSeconds: 1160,
  timeRemainingSeconds: 40,
  rank: 0,
  visibleRooms: [] as WatchTogetherRoom[],
  everyoneJoined: false,
  graceElapsed: false,
  autoPlayEnabled: true,
  serverId: "server-1",
  nextRatingKey: "200",
  currentRoom,
  now: NOW,
};

describe("getMultiplexParticipants / getAutoAdvanceRank", () => {
  it("orders Multiplex participants deterministically by user id then device", () => {
    const a = multiplexUser(2, "bbb");
    const b = multiplexUser(2, "aaa");
    const c = multiplexUser(1);
    const participants = {
      [a.deviceIdentifier]: present(a),
      [b.deviceIdentifier]: present(b),
      [c.deviceIdentifier]: present(c),
    };

    const ordered = getMultiplexParticipants(participants, a);
    expect(ordered.map((user) => user.deviceIdentifier)).toEqual(["device-1", "aaa", "bbb"]);
    expect(getAutoAdvanceRank(participants, c)).toBe(0);
    expect(getAutoAdvanceRank(participants, b)).toBe(1);
    expect(getAutoAdvanceRank(participants, a)).toBe(2);
  });

  it("ignores official Plex clients and absent participants", () => {
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

  it("counts the local user as present even without a participant frame", () => {
    const local = multiplexUser(1);
    expect(getMultiplexParticipants({}, local)).toEqual([local]);
  });
});

describe("findNextEpisodeRoom", () => {
  const input = {
    serverId: "server-1",
    nextRatingKey: "200",
    currentRoom,
    now: NOW,
  };

  it("finds the room pointing at the next episode with the whole party invited", () => {
    const match = room({ id: "room-next" });
    expect(findNextEpisodeRoom({ ...input, rooms: [match] })).toEqual(match);
  });

  it("rejects the current room, wrong items, and rooms missing party members", () => {
    const wrongEpisode = room({
      id: "room-wrong",
      sourceUri: "server://server-1/com.plexapp.plugins.library/library/metadata/999",
    });
    const wrongServer = room({
      id: "room-server",
      sourceUri: "server://server-2/com.plexapp.plugins.library/library/metadata/200",
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

  it("rejects stale rooms from an earlier watch party", () => {
    const stale = room({
      id: "room-stale",
      updatedAt: Math.floor(NOW / 1000) - 60 * 60,
    });
    expect(findNextEpisodeRoom({ ...input, rooms: [stale] })).toBeNull();
  });

  it("resolves duplicates deterministically (newest, then highest id)", () => {
    const older = room({
      id: "room-z",
      updatedAt: Math.floor(NOW / 1000) - 60,
    });
    const newer = room({ id: "room-a" });
    expect(findNextEpisodeRoom({ ...input, rooms: [older, newer] })?.id).toBe("room-a");

    const tieA = room({ id: "room-a" });
    const tieB = room({ id: "room-b" });
    expect(findNextEpisodeRoom({ ...input, rooms: [tieB, tieA] })?.id).toBe("room-b");
  });

  it("accepts millisecond timestamps", () => {
    const msRoom = room({ id: "room-ms", updatedAt: NOW - 5_000 });
    expect(findNextEpisodeRoom({ ...input, rooms: [msRoom] })?.id).toBe("room-ms");
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

  it("waits for remote Multiplex participants, not official clients or self", () => {
    expect(haveMultiplexParticipantsJoined(sessionParticipants, {}, local)).toBe(false);

    expect(
      haveMultiplexParticipantsJoined(
        sessionParticipants,
        { [remote.deviceIdentifier]: present(remote) },
        local,
      ),
    ).toBe(true);
  });

  it("a participant who left the next room doesn't count as joined", () => {
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

  it("partial updates keep previously learned fields", () => {
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

  it("a leave replaces the entry so stale readiness doesn't survive", () => {
    const joined = mergeParticipantState({}, { user, isPresent: true, isReady: true });
    const left = mergeParticipantState(joined, { user, isPresent: false });
    expect(left[user.deviceIdentifier]).toEqual({ user, isPresent: false });
  });
});

describe("lead window / end helpers and create delay", () => {
  it("encodes the lead-window and min-playback guards", () => {
    expect(ADVANCE_LEAD_SECONDS).toBe(45);
    expect(MIN_PLAYBACK_SECONDS).toBe(5);
    expect(END_THRESHOLD_SECONDS).toBe(0.5);
    expect(EVERYONE_JOINED_GRACE_MS).toBe(10_000);

    expect(
      isInLeadWindow({
        durationSeconds: 1200,
        currentTimeSeconds: 1160,
        timeRemainingSeconds: 40,
      }),
    ).toBe(true);
    expect(
      isInLeadWindow({
        durationSeconds: 1200,
        currentTimeSeconds: 3,
        timeRemainingSeconds: 40,
      }),
    ).toBe(false);
    expect(
      isInLeadWindow({
        durationSeconds: 1200,
        currentTimeSeconds: 1000,
        timeRemainingSeconds: 200,
      }),
    ).toBe(false);
    expect(isAtEnd({ durationSeconds: 1200, timeRemainingSeconds: 0.4 })).toBe(true);
    expect(isAtEnd({ durationSeconds: 1200, timeRemainingSeconds: 1 })).toBe(false);
  });

  it("staggers create delay by rank", () => {
    expect(createRoomDelayMs(0)).toBe(CREATE_BASE_DELAY_MS);
    expect(createRoomDelayMs(1)).toBe(CREATE_BASE_DELAY_MS + CREATE_STAGGER_MS);
    expect(createRoomDelayMs(2)).toBe(CREATE_BASE_DELAY_MS + 2 * CREATE_STAGGER_MS);
    expect(CREATE_BASE_DELAY_MS).toBe(1_500);
    expect(CREATE_STAGGER_MS).toBe(8_000);
  });
});

describe("decideRotation", () => {
  it("returns disabled when autoplay is opted out", () => {
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationNone,
        autoPlayEnabled: false,
      }),
    ).toEqual({ kind: "disabled" });

    // Opt-out wins even mid-gathering.
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(room({ id: "next" })),
        autoPlayEnabled: false,
        timeRemainingSeconds: 0,
        everyoneJoined: true,
      }),
    ).toEqual({ kind: "disabled" });
  });

  it("arms when entering the lead window from None", () => {
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationNone,
        timeRemainingSeconds: 40,
        currentTimeSeconds: 1160,
      }),
    ).toEqual({ kind: "arm" });
  });

  it("waits in None outside the lead window (including early playback)", () => {
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationNone,
        timeRemainingSeconds: 200,
        currentTimeSeconds: 1000,
      }),
    ).toEqual({ kind: "wait" });

    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationNone,
        durationSeconds: 1200,
        currentTimeSeconds: 3,
        timeRemainingSeconds: 40,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("arm is latched: seeking back out of the lead window does not disarm", () => {
    // Once Armed, leaving the lead window must not return to None / wait-to-rearm.
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        timeRemainingSeconds: 200,
        currentTimeSeconds: 1000,
        rank: 0,
      }),
    ).toEqual({
      kind: "create_room",
      afterMs: CREATE_BASE_DELAY_MS,
    });

    const known = rotationRoomKnown(room({ id: "next" }));
    expect(
      decideRotation({
        ...baseDecide,
        phase: known,
        timeRemainingSeconds: 200,
        currentTimeSeconds: 1000,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("staggers create_room by rank while Armed with no discovered room", () => {
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: 0,
        visibleRooms: [],
      }),
    ).toEqual({ kind: "create_room", afterMs: CREATE_BASE_DELAY_MS });

    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: 1,
        visibleRooms: [],
      }),
    ).toEqual({
      kind: "create_room",
      afterMs: CREATE_BASE_DELAY_MS + CREATE_STAGGER_MS,
    });

    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: 2,
        visibleRooms: [],
      }),
    ).toEqual({
      kind: "create_room",
      afterMs: CREATE_BASE_DELAY_MS + 2 * CREATE_STAGGER_MS,
    });
  });

  it("waits instead of creating when already attempted or rank is invalid", () => {
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: 0,
        hasAttemptedCreate: true,
      }),
    ).toEqual({ kind: "wait" });

    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: -1,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("adopts a discovered room while Armed (discovery beats create)", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: RotationArmed,
        rank: 0,
        visibleRooms: [match],
      }),
    ).toEqual({ kind: "adopt_room", room: match });
  });

  it("adopts a different deterministic winner while RoomKnown (replace convergence)", () => {
    const older = room({
      id: "room-old",
      updatedAt: Math.floor(NOW / 1000) - 60,
    });
    const newer = room({ id: "room-new" });

    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationRoomKnown(older),
        visibleRooms: [older, newer],
        timeRemainingSeconds: 40,
      }),
    ).toEqual({ kind: "adopt_room", room: newer });
  });

  it("does not re-adopt the same known room", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationRoomKnown(match),
        visibleRooms: [match],
        timeRemainingSeconds: 40,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("begins gathering only at end once a room is known", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationRoomKnown(match),
        visibleRooms: [match],
        timeRemainingSeconds: 40,
      }),
    ).toEqual({ kind: "wait" });

    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationRoomKnown(match),
        visibleRooms: [match],
        timeRemainingSeconds: 0.4,
        currentTimeSeconds: 1199.6,
      }),
    ).toEqual({ kind: "begin_gathering" });
  });

  it("swaps via everyoneJoined while Gathering at end", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(match),
        visibleRooms: [match],
        timeRemainingSeconds: 0,
        currentTimeSeconds: 1200,
        everyoneJoined: true,
        graceElapsed: false,
      }),
    ).toEqual({ kind: "swap" });
  });

  it("swaps via graceElapsed while Gathering at end", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(match),
        visibleRooms: [match],
        timeRemainingSeconds: 0,
        currentTimeSeconds: 1200,
        everyoneJoined: false,
        graceElapsed: true,
      }),
    ).toEqual({ kind: "swap" });
  });

  it("waits while Gathering until everyone joined or grace", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(match),
        visibleRooms: [match],
        timeRemainingSeconds: 0,
        currentTimeSeconds: 1200,
        everyoneJoined: false,
        graceElapsed: false,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("does not swap while Gathering if playback is not at end", () => {
    const match = room({ id: "room-next" });
    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(match),
        visibleRooms: [match],
        timeRemainingSeconds: 10,
        currentTimeSeconds: 1190,
        everyoneJoined: true,
        graceElapsed: true,
      }),
    ).toEqual({ kind: "wait" });
  });

  it("replaces the gathering room when a better duplicate wins", () => {
    const older = room({
      id: "room-old",
      updatedAt: Math.floor(NOW / 1000) - 60,
    });
    const newer = room({ id: "room-new" });

    expect(
      decideRotation({
        ...baseDecide,
        phase: rotationGathering(older, new Set(["device-2"])),
        visibleRooms: [older, newer],
        timeRemainingSeconds: 0,
        everyoneJoined: true,
      }),
    ).toEqual({ kind: "adopt_room", room: newer });
  });
});
