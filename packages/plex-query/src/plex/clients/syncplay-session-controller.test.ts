import { describe, expect, test } from "bun:test";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import {
  encodeSyncplayUser,
  type SyncplayRemoteAction,
  type SyncplayParticipantState,
  type SyncplayWebSocketLike,
} from "./syncplay-client";
import { SyncplaySessionController, type SyncplayPlayerState } from "./syncplay-session-controller";
import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";

const ROOM = {
  id: "room123",
  syncplayHost: "syncplay.example.test",
  syncplayPort: 443,
  sourceUri: "server://server123/com.plexapp.plugins.library/library/metadata/456",
} satisfies Pick<WatchTogetherRoom, "id" | "syncplayHost" | "syncplayPort" | "sourceUri">;

const LOCAL_USER = {
  id: 1,
  deviceIdentifier: "local-device",
  deviceName: "Local Device",
};
const REMOTE_USER = {
  id: 2,
  deviceIdentifier: "remote-device",
  deviceName: "Remote Device",
};

type SyncplayFrameValue =
  | boolean
  | number
  | string
  | null
  | SyncplayFrameValue[]
  | { [key: string]: SyncplayFrameValue };

interface SyncplayFrameFixture {
  [key: string]: SyncplayFrameValue;
}

interface FakeWebSocketListeners {
  open: Array<() => void>;
  message: Array<(event: MessageEvent<string>) => void>;
  close: Array<() => void>;
  error: Array<(event: Event) => void>;
}

interface OutgoingStatePayload {
  playstate?: {
    paused: boolean;
    position: number;
    doSeek?: boolean;
    setBy?: string | null;
  };
  ignoringOnTheFly?: { client: number; server: number };
}

class FakeWebSocket implements SyncplayWebSocketLike {
  readyState = 0;
  closeCount = 0;
  sent: unknown[] = [];
  private readonly listeners: FakeWebSocketListeners = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = 3;
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: (event: Event) => void): void;
  addEventListener(
    type: keyof FakeWebSocket["listeners"],
    listener: (() => void) | ((event: MessageEvent<string>) => void) | ((event: Event) => void),
  ): void {
    this.listeners[type].push(fromAny(listener));
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.open) listener();
  }

  message(frame: SyncplayFrameFixture): void {
    const event = fromPartial<MessageEvent<string>>({
      data: JSON.stringify(frame),
    });
    for (const listener of this.listeners.message) listener(event);
  }

  closeFromServer(): void {
    this.readyState = 3;
    for (const listener of this.listeners.close) listener();
  }
}

interface PlayerCalls {
  play: number;
  pause: number;
  seeks: number[];
  playbackRates?: number[];
}

function createController(options: {
  sockets: FakeWebSocket[];
  state: SyncplayPlayerState;
  calls: PlayerCalls;
  actions?: SyncplayRemoteAction[];
  participants?: SyncplayParticipantState[];
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
  onFatalError?: (error: Error) => void;
  remoteStartupGraceMs?: number;
  canInitiateStartupPlayback?: boolean;
}) {
  const controller = new SyncplaySessionController({
    room: ROOM,
    user: LOCAL_USER,
    onFatalError: options.onFatalError,
    onRemoteAction: (action) => options.actions?.push(action),
    onParticipant: (participant) => options.participants?.push(participant),
    // Tests exercise steady-state arbitration; disable the startup grace unless
    // a test opts in.
    remoteStartupGraceMs: options.remoteStartupGraceMs ?? 0,
    canInitiateStartupPlayback: options.canInitiateStartupPlayback,
    player: {
      getState: () => options.state,
      play: () => {
        options.calls.play += 1;
        options.state.isPlaying = true;
        return true;
      },
      pause: () => {
        options.calls.pause += 1;
        options.state.isPlaying = false;
      },
      seek: (positionSeconds) => {
        options.calls.seeks.push(positionSeconds);
        options.state.currentTime = positionSeconds;
        return "direct";
      },
      setPlaybackRate: (rate) => {
        options.calls.playbackRates?.push(rate);
      },
    },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      options.sockets.push(socket);
      return socket;
    },
    now: options.now ?? (() => 1000),
    setTimeout:
      options.setTimeout ??
      ((callback) => {
        callback();
        return fromAny(0);
      }),
    clearTimeout: options.clearTimeout ?? (() => undefined),
  });
  return controller;
}

function makeState(overrides: Partial<SyncplayPlayerState> = {}): SyncplayPlayerState {
  return {
    isPlaying: true,
    currentTime: 30,
    duration: 120,
    canPlay: true,
    isLoading: false,
    seekRequiresReload: false,
    error: null,
    ...overrides,
  };
}

function lastState(socket: FakeWebSocket | undefined): OutgoingStatePayload | undefined {
  const frame: { State?: OutgoingStatePayload } | undefined = fromAny(socket?.sent.at(-1));
  return frame?.State;
}

describe("SyncplaySessionController", () => {
  test("applies a remote pause to the local player", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.pause).toBe(1);
    expect(state.isPlaying).toBe(false);
  });

  test("ignores Plex's anonymous empty-room reset during a handoff", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({
      isPlaying: true,
      currentTime: 80,
      duration: 120,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(false);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: null,
        },
      },
    });

    expect(calls.pause).toBe(0);
    expect(calls.seeks).toEqual([]);
    expect(state).toMatchObject({ isPlaying: true, currentTime: 80 });
  });

  test("ignores a remote pause during the startup grace (so auto-start can begin)", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 0 });
    // Clock stays within the grace window; the stale lobby "paused" must not
    // pause our freshly-autoplaying player.
    const controller = createController({
      sockets,
      state,
      calls,
      now: () => 1000,
      remoteStartupGraceMs: 5000,
    });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.pause).toBe(0);
    expect(state.isPlaying).toBe(true);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: false, position: 0 },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("does not claim a mechanical pause before initial playback begins", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: false, currentTime: 0 });
    const controller = createController({
      sockets,
      state,
      calls,
      now: () => 1000,
      remoteStartupGraceMs: 5000,
    });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(true);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 0,
    });
  });

  test("keeps startup grace through local play until the room acknowledges it", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 1 });
    const controller = createController({
      sockets,
      state,
      calls,
      now: () => 1000,
      remoteStartupGraceMs: 5000,
    });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(false);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.pause).toBe(0);
    expect(state.isPlaying).toBe(true);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 1,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 1,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    expect(calls.pause).toBe(1);
    expect(state.isPlaying).toBe(false);
  });

  test("does not let a non-leader claim startup playback", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 1 });
    const controller = createController({
      sockets,
      state,
      calls,
      now: () => 1000,
      remoteStartupGraceMs: 5000,
      canInitiateStartupPlayback: false,
    });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.pause).toBe(0);
    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: true, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("applies a remote seek to the local player", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({
      isPlaying: false,
      currentTime: 0,
      duration: 120,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 50,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([50]);
    expect(calls.play).toBe(1);
  });

  test("claims a local pause on the next server ping", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: false, currentTime: 30 }); // user just paused
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(true);
    sockets[0]?.sent.splice(0);

    // Peer still playing; server relays it.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 35,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    // We don't get dragged back to playing, and we claim our pause.
    expect(calls.play).toBe(0);
    expect(lastState(sockets[0])).toMatchObject({
      playstate: {
        paused: true,
        position: 30,
        setBy: null,
      },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("does not let a duplicate local play claim override a newer remote pause", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    // Establish and acknowledge playing as the stable room state.
    controller.handleLocalPlaybackChange(false);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    // A duplicate media `play` event from transport churn must not become a
    // fresh local claim that can conflict with the next participant command.
    controller.handleLocalPlaybackChange(false);
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.pause).toBe(1);
    expect(lastState(sockets[0])).toMatchObject({
      // Normal driver heartbeats report the actual local playhead after
      // adopting the remote pause. The room's position was one second ahead.
      playstate: { paused: true, position: 30, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("claims a rapid local resume after a remote resume and local pause", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    // Establish playing, then let a remote pause and resume drive the player.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    // The local user immediately pauses. Syncplay accepts that pause, but the
    // old remote-resume suppression is still within its time window.
    controller.handleLocalPlaybackChange(true);
    state.isPlaying = false;
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 32,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 32,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    // A subsequent local resume must become a new claim. It is not the media
    // event from the earlier remote resume and must not be suppressed as one.
    controller.handleLocalPlaybackChange(false);
    state.isPlaying = true;
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 32,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(calls.pause).toBe(1);
    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: false, position: 32, setBy: null },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("does not re-broadcast a pause it applied itself", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    // Remote pause -> controller pauses the player (and arms suppression).
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(calls.pause).toBe(1);

    // The player emits its pause event; the controller must NOT treat that as a
    // fresh user pause (which would claim/echo it back).
    sockets[0]?.sent.splice(0);
    controller.handleLocalPlaybackChange(true);

    // No new claimed State (no setBy=self / client counter) was produced.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastState(sockets[0])).toMatchObject({
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("claims a user seek to a different position than a recent remote-applied seek", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 0, duration: 120 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    // Remote seek to 50 -> arms suppression for ~position 50.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 50,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // The player's resulting 'seeked' at ~50 is suppressed (our own apply).
    controller.handleLocalSeeked(50);

    // A genuine user seek to a different position must still be claimed.
    sockets[0]?.sent.splice(0);
    controller.handleLocalSeeked(200);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 50,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])).toMatchObject({
      ignoringOnTheFly: { client: 1 },
    });
  });

  test("reconnects after an unexpected socket close", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const controller = createController({ sockets, state: makeState(), calls });
    controller.connect();
    sockets[0]?.closeFromServer();
    expect(sockets).toHaveLength(2);
  });

  test("reconciles a peer missing from the first List after reconnect", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const participants: SyncplayParticipantState[] = [];
    const controller = createController({
      sockets,
      state: makeState(),
      calls,
      participants,
    });
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      List: {
        [ROOM.id]: {
          [encodeSyncplayUser(LOCAL_USER)]: { position: 30 },
          [encodeSyncplayUser(REMOTE_USER)]: { position: 30 },
        },
      },
    });

    sockets[0]?.closeFromServer();
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    sockets[1]?.message({
      List: {
        [ROOM.id]: {
          [encodeSyncplayUser(LOCAL_USER)]: { position: 30 },
        },
      },
    });

    expect(participants).toContainEqual({
      user: REMOTE_USER,
      isPresent: false,
    });
  });

  test("aligns and applies pause immediately on reconnect", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 35 });
    const controller = createController({
      sockets,
      state,
      calls,
      remoteStartupGraceMs: 5000,
    });

    controller.connect();
    sockets[0]?.open();
    controller.disconnect();
    controller.connect();
    sockets[1]?.open();
    sockets[1]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([30]);
    expect(calls.pause).toBe(1);
    expect(state.isPlaying).toBe(false);
  });

  test("does not reconnect after a fatal protocol error", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    let fatal: Error | null = null;
    const controller = createController({
      sockets,
      state: makeState(),
      calls,
      onFatalError: (error) => {
        fatal = error;
      },
    });
    controller.connect();
    sockets[0]?.open();
    sockets[0]?.message({ Error: { message: "boom" } });
    sockets[0]?.closeFromServer();

    expect(fatal).not.toBeNull();
    expect(sockets).toHaveLength(1); // no reconnect attempt
  });

  test("disconnect closes the socket", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const controller = createController({ sockets, state: makeState(), calls });
    controller.connect();
    sockets[0]?.open();
    controller.disconnect();
    expect(sockets[0]?.closeCount).toBeGreaterThanOrEqual(1);
  });

  test("forwards remote action edges from the protocol to onRemoteAction", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const actions: SyncplayRemoteAction[] = [];
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls, actions });
    controller.connect();
    sockets[0]?.open();

    // Baseline frame (no edge yet), then a remote pause edge and a seek frame.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 90,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(actions).toEqual([
      { type: "pause", user: REMOTE_USER, positionSeconds: 31 },
      { type: "seek", user: REMOTE_USER, positionSeconds: 90 },
    ]);
  });

  test("a silent drift-correction seek is not a remote action (no doSeek edge)", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const actions: SyncplayRemoteAction[] = [];
    // Player is far behind the room, so the threshold seek kicks in without an
    // explicit doSeek from a user.
    const state = makeState({
      isPlaying: true,
      currentTime: 10,
      duration: 120,
    });
    const controller = createController({ sockets, state, calls, actions });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 60,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([60]); // the drift fix still happens
    expect(actions).toEqual([]); // ...but silently
  });

  test("rate-corrects ordinary drift instead of replacing a reload-only stream", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = {
      play: 0,
      pause: 0,
      seeks: [],
      playbackRates: [],
    };
    const state = makeState({
      isPlaying: true,
      currentTime: 10,
      duration: 120,
      seekRequiresReload: true,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 12,
          doSeek: false,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([]);
    expect(calls.playbackRates).toEqual([1.05]);
  });

  test("does not replace a reload-only stream again while it catches up after a seek", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = {
      play: 0,
      pause: 0,
      seeks: [],
      playbackRates: [],
    };
    const state = makeState({
      isPlaying: true,
      currentTime: 10,
      duration: 120,
      seekRequiresReload: true,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 60,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    state.currentTime = 60.1;
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 62,
          doSeek: false,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([60]);
    expect(calls.playbackRates).toEqual([1, 1.05]);
  });

  test("keeps rate correction active until drift crosses a narrow reset boundary", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = {
      play: 0,
      pause: 0,
      seeks: [],
      playbackRates: [],
    };
    const state = makeState({
      isPlaying: true,
      currentTime: 10.6,
      duration: 120,
      seekRequiresReload: true,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    for (const currentTime of [10.6, 10.3, 10.05]) {
      state.currentTime = currentTime;
      sockets[0]?.message({
        State: {
          playstate: {
            paused: false,
            position: 10,
            doSeek: false,
            setBy: encodeSyncplayUser(REMOTE_USER),
          },
        },
      });
    }

    expect(calls.seeks).toEqual([]);
    expect(calls.playbackRates).toEqual([0.95, 0.95, 1]);
  });

  test("does not replace a loading transcode for advancing room heartbeats", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({
      isPlaying: false,
      currentTime: 50,
      duration: 120,
      canPlay: false,
      isLoading: true,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    for (const position of [52, 54, 58, 63]) {
      sockets[0]?.message({
        State: {
          playstate: {
            paused: false,
            position,
            setBy: encodeSyncplayUser(REMOTE_USER),
          },
        },
      });
    }

    expect(calls.seeks).toEqual([]);
  });

  test("a deliberate remote seek supersedes a loading transcode", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({
      isPlaying: false,
      currentTime: 50,
      duration: 120,
      canPlay: false,
      isLoading: true,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 80,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(calls.seeks).toEqual([80]);
  });

  test("claims explicit playback intent while the stream is (re)loading", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    // UI intent remains authoritative while a transcoded seek reloads the
    // stream. Mechanical media events never call this controller boundary.
    const state = makeState({
      isPlaying: false,
      isLoading: true,
      currentTime: 50,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(true);
    sockets[0]?.sent.splice(0);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 50,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: true },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("reports the last stable playstate while the stream reloads (no phantom pause)", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({
      isPlaying: true,
      currentTime: 30,
      duration: 7200,
    });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    // Stable playback: the user is playing (stable state recorded).
    controller.handleLocalPlaybackChange(false);

    // The user seeks a transcoded stream: it reloads (isLoading, not playing).
    state.isPlaying = false;
    state.isLoading = true;
    state.currentTime = 5000;
    controller.handleLocalSeeked(5000);
    sockets[0]?.sent.splice(0);

    // Next ping: the claimed seek must report the playing intent, not the
    // transient "not playing" of the reloading element (official client
    // behavior: doSeek with paused=false).
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastState(sockets[0])).toMatchObject({
      playstate: { doSeek: true, paused: false, position: 5000 },
    });
  });

  test("claims a resume after the room paused an already-paused replacement", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    controller.handleLocalPlaybackChange(false);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    // Source replacement paused the element before the peer's room pause
    // arrived, so applying the accepted state does not need to call pause().
    state.isPlaying = false;
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(calls.pause).toBe(0);

    state.isPlaying = true;
    controller.handleLocalPlaybackChange(false);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: false, position: 30 },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("does not pause the room when the local media transport fails", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    state.isPlaying = false;
    state.error = "Plex transcode failed";
    sockets[0]?.sent.splice(0);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: false },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("does not publish an unclaimed unload pause", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: true, currentTime: 30 });
    const controller = createController({ sockets, state, calls });
    controller.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 30,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    state.isPlaying = false;
    sockets[0]?.sent.splice(0);
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 31,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: false },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });
});
