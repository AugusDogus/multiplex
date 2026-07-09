import { describe, expect, test } from "bun:test";
import type { SyncplayParticipantState } from "../plex/clients/syncplay-client";
import type { WatchTogetherRoom } from "../plex/schemas/watch-together-schemas";

import {
  AUTO_START_DELAY_MS,
  allInvitedPresent,
  decideLobbyAutoStart,
  getLobbyHint,
  getParticipantStatus,
  isSomeoneElseWatching,
  isSoloRoom,
  type DecideLobbyAutoStartInput,
} from "./lobby-policy";
import type { ParticipantMap } from "./session-state";

const room = (users: WatchTogetherRoom["users"]): Pick<WatchTogetherRoom, "users"> => ({ users });

const participant = (
  id: number,
  partial: Partial<SyncplayParticipantState> = {},
): SyncplayParticipantState => ({
  user: {
    id,
    deviceIdentifier: `device-${id}`,
    deviceName: "Multiplex Web",
  },
  ...partial,
});

const baseDecide = (
  overrides: Partial<DecideLobbyAutoStartInput> = {},
): DecideLobbyAutoStartInput => ({
  room: room([
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ]),
  participants: {
    "device-2": participant(2, { isPresent: true }),
  },
  localUserId: 1,
  presentStableMs: AUTO_START_DELAY_MS,
  everyonePresentSticky: true,
  autoStartSuppressed: false,
  canStart: true,
  leaving: false,
  hasAutoStarted: false,
  roomPositionSeconds: null,
  ...overrides,
});

const hintBase = {
  everyonePresent: false,
  everyonePresentNow: false,
  canStart: false,
  autoStartSuppressed: false,
  someoneElseWatching: false,
  isSoloRoom: false,
};

describe("getLobbyHint", () => {
  test("a one-person room points at Invite, never Start", () => {
    const hint = getLobbyHint({
      ...hintBase,
      isSoloRoom: true,
      everyonePresent: true,
      everyonePresentNow: true,
      canStart: true,
    });
    expect(hint).toBe("Invite a friend to start watching together.");
    expect(hint).not.toContain("Start");
  });

  test("promises playback only when auto-start will actually fire", () => {
    expect(
      getLobbyHint({
        ...hintBase,
        everyonePresent: true,
        everyonePresentNow: true,
        canStart: true,
      }),
    ).toBe("Everyone's here — starting playback…");
  });

  test("a suppressed viewer alone in the room is told to press Start, not lied to", () => {
    const hint = getLobbyHint({
      ...hintBase,
      everyonePresent: true,
      everyonePresentNow: true,
      canStart: true,
      autoStartSuppressed: true,
    });
    expect(hint).toBe("Press Start when you're ready to watch.");
    expect(hint).not.toContain("starting playback");
  });

  test("someone else already watching invites a suppressed viewer to join", () => {
    expect(
      getLobbyHint({
        ...hintBase,
        everyonePresent: true,
        everyonePresentNow: true,
        canStart: true,
        autoStartSuppressed: true,
        someoneElseWatching: true,
      }),
    ).toBe("Someone already started watching — press Join.");
  });

  test("everyone present but media still loading shows a preparing state", () => {
    expect(
      getLobbyHint({
        ...hintBase,
        everyonePresent: true,
        everyonePresentNow: true,
      }),
    ).toBe("Getting the stream ready…");
  });

  test("never tells the user to press Start while it is disabled (media not ready)", () => {
    const hint = getLobbyHint({
      ...hintBase,
      everyonePresent: true,
      everyonePresentNow: true,
      autoStartSuppressed: true,
      someoneElseWatching: true,
      canStart: false,
    });
    expect(hint).toBe("Getting the stream ready…");
    expect(hint).not.toContain("Start");
  });

  test("waits for missing invitees", () => {
    expect(getLobbyHint(hintBase)).toBe("Waiting for everyone to join…");
  });
});

describe("getParticipantStatus", () => {
  test("ready means watching", () => {
    expect(getParticipantStatus(participant(1, { isReady: true }), false)).toBe("watching");
  });

  test("present means in lobby", () => {
    expect(getParticipantStatus(participant(1, { isPresent: true }), false)).toBe("inLobby");
  });

  test("local user counts as in lobby without a presence frame", () => {
    expect(getParticipantStatus(undefined, true)).toBe("inLobby");
  });

  test("absent remote is invited", () => {
    expect(getParticipantStatus(undefined, false)).toBe("invited");
  });
});

describe("allInvitedPresent / isSomeoneElseWatching / isSoloRoom", () => {
  test("local user counts as present", () => {
    expect(
      allInvitedPresent(
        room([
          { id: 1, title: "Host", username: "host", thumb: null },
          { id: 2, title: "Guest", username: "guest", thumb: null },
        ]),
        { "device-2": participant(2, { isPresent: true }) },
        1,
      ),
    ).toBe(true);
  });

  test("missing invitee is not present", () => {
    expect(
      allInvitedPresent(
        room([
          { id: 1, title: "Host", username: "host", thumb: null },
          { id: 2, title: "Guest", username: "guest", thumb: null },
        ]),
        {},
        1,
      ),
    ).toBe(false);
  });

  test("detects someone else watching via isReady", () => {
    const participants: ParticipantMap = {
      "device-2": participant(2, { isPresent: true, isReady: true }),
    };
    expect(
      isSomeoneElseWatching(
        room([
          { id: 1, title: "Host", username: "host", thumb: null },
          { id: 2, title: "Guest", username: "guest", thumb: null },
        ]),
        participants,
        1,
      ),
    ).toBe(true);
  });

  test("solo room is users.length <= 1", () => {
    expect(isSoloRoom(room([{ id: 1, title: "Host", username: "host", thumb: null }]))).toBe(true);
    expect(
      isSoloRoom(
        room([
          { id: 1, title: "Host", username: "host", thumb: null },
          { id: 2, title: "Guest", username: "guest", thumb: null },
        ]),
      ),
    ).toBe(false);
  });
});

describe("decideLobbyAutoStart", () => {
  test("starts a fresh gathering at null position once stable", () => {
    expect(decideLobbyAutoStart(baseDecide())).toEqual({
      kind: "start",
      startPositionSeconds: null,
    });
  });

  test("waits until presentStableMs reaches AUTO_START_DELAY_MS", () => {
    expect(decideLobbyAutoStart(baseDecide({ presentStableMs: AUTO_START_DELAY_MS - 1 }))).toEqual({
      kind: "wait",
    });
  });

  test("rearms when sticky everyone-present drops", () => {
    expect(decideLobbyAutoStart(baseDecide({ everyonePresentSticky: false }))).toEqual({
      kind: "rearm",
    });
  });

  test("waits when not everyone is present right now (grace linger)", () => {
    expect(
      decideLobbyAutoStart(
        baseDecide({
          participants: {},
        }),
      ),
    ).toEqual({ kind: "wait" });
  });

  test("respects suppression", () => {
    expect(decideLobbyAutoStart(baseDecide({ autoStartSuppressed: true }))).toEqual({
      kind: "wait",
    });
  });

  test("respects solo room", () => {
    expect(
      decideLobbyAutoStart(
        baseDecide({
          room: room([{ id: 1, title: "Host", username: "host", thumb: null }]),
          participants: {},
        }),
      ),
    ).toEqual({ kind: "wait" });
  });

  test("respects leaving and canStart and hasAutoStarted", () => {
    expect(decideLobbyAutoStart(baseDecide({ leaving: true }))).toEqual({
      kind: "wait",
    });
    expect(decideLobbyAutoStart(baseDecide({ canStart: false }))).toEqual({
      kind: "wait",
    });
    expect(decideLobbyAutoStart(baseDecide({ hasAutoStarted: true }))).toEqual({
      kind: "wait",
    });
  });

  test("join-in-progress waits for known room position", () => {
    const watching: ParticipantMap = {
      "device-2": participant(2, { isPresent: true, isReady: true }),
    };
    expect(
      decideLobbyAutoStart(
        baseDecide({
          participants: watching,
          roomPositionSeconds: null,
        }),
      ),
    ).toEqual({ kind: "wait" });

    expect(
      decideLobbyAutoStart(
        baseDecide({
          participants: watching,
          roomPositionSeconds: 42.5,
        }),
      ),
    ).toEqual({
      kind: "start",
      startPositionSeconds: 42.5,
    });
  });
});
