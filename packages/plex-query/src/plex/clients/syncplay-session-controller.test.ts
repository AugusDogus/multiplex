import { describe, expect, test } from "bun:test";
import { encodeSyncplayUser, type SyncplayWebSocketLike } from "./syncplay-client";
import { SyncplaySessionController, type SyncplayPlayerState } from "./syncplay-session-controller";
import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";

const ROOM = {
  id: "room123",
  syncplayHost: "syncplay.example.test",
  syncplayPort: 443,
  sourceUri: "server://server123/com.plexapp.plugins.library/library/metadata/456",
} satisfies Pick<WatchTogetherRoom, "id" | "syncplayHost" | "syncplayPort" | "sourceUri">;

const LOCAL_USER = { id: 1, deviceIdentifier: "local-device", deviceName: "Local Device" };
const REMOTE_USER = { id: 2, deviceIdentifier: "remote-device", deviceName: "Remote Device" };

class FakeWebSocket implements SyncplayWebSocketLike {
  readyState = 0;
  closeCount = 0;
  sent: unknown[] = [];
  private readonly listeners = {
    open: [] as (() => void)[],
    message: [] as ((event: MessageEvent<string>) => void)[],
    close: [] as (() => void)[],
    error: [] as ((event: Event) => void)[],
  };

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
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
    this.listeners[type].push(listener as never);
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.open) listener();
  }

  message(frame: unknown): void {
    const event = { data: JSON.stringify(frame) } as MessageEvent<string>;
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
}

function createController(options: {
  sockets: FakeWebSocket[];
  state: SyncplayPlayerState;
  calls: PlayerCalls;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
  onFatalError?: (error: Error) => void;
}) {
  const controller = new SyncplaySessionController({
    room: ROOM,
    user: LOCAL_USER,
    onFatalError: options.onFatalError,
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
        return 0 as unknown as ReturnType<typeof setTimeout>;
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
    error: null,
    ...overrides,
  };
}

function lastState(socket: FakeWebSocket | undefined) {
  return (socket?.sent.at(-1) as { State?: { playstate?: unknown; ignoringOnTheFly?: unknown } })
    ?.State;
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
        playstate: { paused: true, position: 30, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });

    expect(calls.pause).toBe(1);
    expect(state.isPlaying).toBe(false);
  });

  test("applies a remote seek to the local player", () => {
    const sockets: FakeWebSocket[] = [];
    const calls: PlayerCalls = { play: 0, pause: 0, seeks: [] };
    const state = makeState({ isPlaying: false, currentTime: 0, duration: 120 });
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
        playstate: { paused: false, position: 35, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });

    // We don't get dragged back to playing, and we claim our pause.
    expect(calls.play).toBe(0);
    expect(lastState(sockets[0])).toMatchObject({
      playstate: { paused: true, position: 30, setBy: encodeSyncplayUser(LOCAL_USER) },
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
        playstate: { paused: true, position: 30, setBy: encodeSyncplayUser(REMOTE_USER) },
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
        playstate: { paused: true, position: 30, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    expect(lastState(sockets[0])).toMatchObject({
      ignoringOnTheFly: { client: 0, server: 0 },
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
});
