import { describe, expect, test } from "bun:test";
import type { SyncplayUser, WatchTogetherUser } from "@multiplex/plex-query";

import { createWatchTogetherSessionToasts } from "./watch-together-session-toasts";

const LOCAL_USER: SyncplayUser = {
  id: 1,
  deviceIdentifier: "local-device",
  deviceName: "Multiplex Web",
};

const REMOTE_USER: SyncplayUser = {
  id: 2,
  deviceIdentifier: "remote-device",
  deviceName: "Multiplex Web",
};

const ROOM_USERS: WatchTogetherUser[] = [
  { id: 1, title: "Augie", username: "augusdogus", thumb: null },
  { id: 2, title: "multiplextest", username: "multiplextest", thumb: null },
];

/** Deterministic clock harness around the notifier's test seams. */
function createHarness(
  options: {
    initialCohortDeviceIds?: ReadonlySet<string>;
    shouldSuppressNotifications?: () => boolean;
  } = {},
) {
  let currentTime = 100_000;
  const shown: string[] = [];

  const notifier = createWatchTogetherSessionToasts({
    room: { users: ROOM_USERS },
    localUser: LOCAL_USER,
    initialCohortDeviceIds: options.initialCohortDeviceIds,
    shouldSuppressNotifications: options.shouldSuppressNotifications,
    showToast: (_user, name, text) => shown.push(`${name} ${text}`),
    now: () => currentTime,
  });

  const advance = (ms: number) => {
    currentTime += ms;
  };

  // Most tests want steady mid-session behavior: the local player has started
  // and the starting-cohort window (measured from creation) has passed.
  const settle = () => {
    notifier.noteLocalStarted();
    advance(6_000);
  };

  const remoteWatching = () => {
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: true,
    });
  };

  return { notifier, shown, advance, settle, remoteWatching };
}

describe("createWatchTogetherSessionToasts", () => {
  test("remote pause/resume/seek toast immediately", () => {
    const { notifier, shown, settle, remoteWatching } = createHarness();
    remoteWatching();
    settle();

    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    notifier.handleRemoteAction({
      type: "resume",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    notifier.handleRemoteAction({
      type: "seek",
      user: REMOTE_USER,
      positionSeconds: 90,
    });
    expect(shown).toEqual([
      "multiplextest paused playback",
      "multiplextest resumed playback",
      "multiplextest jumped to 1:30",
    ]);
  });

  test("ready flaps while connected (buffering after a seek) never toast leave/join", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.handleParticipant({ user: REMOTE_USER, isReady: false });
    advance(20_000);
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    advance(20_000);
    expect(shown).toEqual([]);
  });

  test("a starting-cohort member's slow load never toasts a join", () => {
    const { notifier, shown, advance, settle } = createHarness();
    // Present in the room while we're connecting (their player still loading).
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: false,
    });
    settle();
    // The lobby->player socket handoff blips their presence before they're
    // ever ready; that must not turn their eventual ready-up into a "join".
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: false });
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: true });
    // Their transcode takes 40s; becoming ready is the session starting.
    advance(40_000);
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    expect(shown).toEqual([]);
  });

  test("playstate edges before the local player starts are silent spin-up", () => {
    const { notifier, shown, advance, remoteWatching } = createHarness();
    remoteWatching();
    advance(20_000); // well past any settle window, but we never started
    notifier.handleRemoteAction({
      type: "resume",
      user: REMOTE_USER,
      positionSeconds: 0,
    });
    expect(shown).toEqual([]);

    notifier.noteLocalStarted();
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 10,
    });
    expect(shown).toEqual(["multiplextest paused playback"]);
  });

  test("roster at connect is silent; later joins and rejoins toast", () => {
    const { notifier, shown, advance, settle } = createHarness();
    // Reported during the starting-cohort window -> existing roster.
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: true,
    });
    expect(shown).toEqual([]);
    settle();

    // Real leave (connection lost) toasts immediately...
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: false });
    expect(shown).toEqual(["multiplextest left the session"]);

    // ...their lobby reconnect stays silent (present but not watching)...
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: true });
    advance(10_000);
    expect(shown).toEqual(["multiplextest left the session"]);

    // ...and pressing Start again (ready) is a genuine rejoin.
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    expect(shown).toEqual([
      "multiplextest left the session",
      "multiplextest joined the session",
    ]);
  });

  test("a genuine late joiner toasts once they start watching", () => {
    const { notifier, shown, advance, settle } = createHarness();
    settle();
    advance(60_000);
    // First seen long after connect: a real newcomer, not starting roster.
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: false,
    });
    expect(shown).toEqual([]); // in the lobby, not watching yet
    advance(20_000);
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    expect(shown).toEqual(["multiplextest joined the session"]);
  });

  test("a peer first seen after the connect window but before local start is cohort", () => {
    const { notifier, shown, advance } = createHarness();
    // Local player still loading; peer's Syncplay driver appears late.
    advance(30_000);
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: false,
    });
    notifier.noteLocalStarted();
    advance(40_000);
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    expect(shown).toEqual([]);
  });

  test("seeded lobby cohort never toasts a join even after a slow driver handoff", () => {
    const { notifier, shown, advance } = createHarness({
      initialCohortDeviceIds: new Set([REMOTE_USER.deviceIdentifier]),
    });
    notifier.noteLocalStarted();
    advance(60_000);
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: true,
    });
    expect(shown).toEqual([]);
  });

  test("suppressed notifications stay silent for leave and playstate edges", () => {
    let suppressed = true;
    const { notifier, shown, advance } = createHarness({
      shouldSuppressNotifications: () => suppressed,
    });
    notifier.noteLocalStarted();
    advance(6_000);
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: true,
    });
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: false });
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 10,
    });
    expect(shown).toEqual([]);

    suppressed = false;
    notifier.handleParticipant({
      user: REMOTE_USER,
      isPresent: true,
      isReady: true,
    });
    expect(shown).toEqual(["multiplextest joined the session"]);
  });

  test("local user's own events never toast", () => {
    const { notifier, shown, advance, settle } = createHarness();
    settle();
    notifier.handleParticipant({
      user: LOCAL_USER,
      isPresent: true,
      isReady: true,
    });
    notifier.handleParticipant({ user: LOCAL_USER, isPresent: false });
    advance(10_000);
    expect(shown).toEqual([]);
  });

  test("nothing toasts after dispose", () => {
    const { notifier, shown, settle, remoteWatching } = createHarness();
    remoteWatching();
    settle();
    notifier.dispose();
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: false });
    expect(shown).toEqual([]);
  });
});
