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

interface PendingTimer {
  callback: () => void;
  runAt: number;
  cleared: boolean;
}

/** Deterministic clock + timer harness around the notifier's test seams. */
function createHarness() {
  let currentTime = 100_000;
  const timers: PendingTimer[] = [];
  const shown: string[] = [];

  const notifier = createWatchTogetherSessionToasts({
    room: { users: ROOM_USERS },
    localUser: LOCAL_USER,
    showToast: (_user, name, text) => shown.push(`${name} ${text}`),
    now: () => currentTime,
    setTimeout: (callback, ms) => {
      const timer: PendingTimer = {
        callback,
        runAt: currentTime + ms,
        cleared: false,
      };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timeout) => {
      (timeout as unknown as PendingTimer).cleared = true;
    },
  });

  const advance = (ms: number) => {
    currentTime += ms;
    for (const timer of timers.splice(0)) {
      if (!timer.cleared && timer.runAt <= currentTime) {
        timer.callback();
      } else if (!timer.cleared) {
        timers.push(timer);
      }
    }
  };

  // The initial roster settle window is measured from creation; most tests
  // want steady-state behavior, so fast-forward past it.
  const settle = () => advance(6_000);

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
  test("a deliberate remote pause toasts after the hold window", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    expect(shown).toEqual([]); // held, not instant
    advance(2_000);
    expect(shown).toEqual(["multiplextest paused playback"]);
  });

  test("a pause followed by the author leaving reads as a single leave", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    notifier.handleParticipant({ user: REMOTE_USER, isPresent: false });
    advance(2_000);
    expect(shown).toEqual(["multiplextest left the session"]);
  });

  test("ready flaps while connected (buffering) never toast leave/join", () => {
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

  test("pause/resume churn is muted while a participant is buffering and briefly after", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    // Remote starts buffering (e.g. their stream reloaded) and mechanically
    // claims a pause.
    notifier.handleParticipant({ user: REMOTE_USER, isReady: false });
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    advance(30_000); // long buffer; the held pause fires into the mute
    // Finished buffering; the trailing mechanical "resumed" claim lands.
    notifier.handleParticipant({ user: REMOTE_USER, isReady: true });
    advance(1_000);
    notifier.handleRemoteAction({
      type: "resume",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    advance(10_000);
    expect(shown).toEqual([]);
  });

  test("a remote seek toasts once and mutes the surrounding pause/resume churn", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.handleRemoteAction({
      type: "seek",
      user: REMOTE_USER,
      positionSeconds: 90,
    });
    // The same State frame applies a pause (stream reload) with the seek.
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 90,
    });
    advance(2_000);
    // Re-applied identical seek within the dedupe window stays quiet.
    notifier.handleRemoteAction({
      type: "seek",
      user: REMOTE_USER,
      positionSeconds: 90,
    });
    advance(2_000);
    notifier.handleRemoteAction({
      type: "resume",
      user: REMOTE_USER,
      positionSeconds: 91,
    });
    advance(10_000);
    expect(shown).toEqual(["multiplextest jumped to 1:30"]);
  });

  test("a local seek mutes the peers' mechanical pause/resume claims", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.noteLocalSeek();
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 50,
    });
    advance(2_000);
    notifier.handleRemoteAction({
      type: "resume",
      user: REMOTE_USER,
      positionSeconds: 50,
    });
    advance(10_000);
    expect(shown).toEqual([]);
  });

  test("a deliberate pause well after churn settles still toasts", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();

    notifier.noteLocalSeek();
    advance(15_000); // churn window over
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 60,
    });
    advance(2_000);
    expect(shown).toEqual(["multiplextest paused playback"]);
  });

  test("roster at connect is silent; later joins and rejoins toast", () => {
    const { notifier, shown, advance, settle } = createHarness();
    // Reported during the initial settle window -> existing roster.
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

  test("dispose cancels held pause toasts", () => {
    const { notifier, shown, advance, settle, remoteWatching } =
      createHarness();
    remoteWatching();
    settle();
    notifier.handleRemoteAction({
      type: "pause",
      user: REMOTE_USER,
      positionSeconds: 30,
    });
    notifier.dispose();
    advance(5_000);
    expect(shown).toEqual([]);
  });
});
