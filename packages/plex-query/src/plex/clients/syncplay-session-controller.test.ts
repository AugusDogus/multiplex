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

class FakeWebSocket implements SyncplayWebSocketLike {
  readyState = 0;
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
    for (const listener of this.listeners.open) {
      listener();
    }
  }

  message(frame: unknown): void {
    const event = { data: JSON.stringify(frame) } as MessageEvent<string>;
    for (const listener of this.listeners.message) {
      listener(event);
    }
  }
}

function createController(options: {
  sockets: FakeWebSocket[];
  state: SyncplayPlayerState;
  play?: () => boolean | Promise<boolean>;
}) {
  return new SyncplaySessionController({
    room: ROOM,
    user: LOCAL_USER,
    player: {
      getState: () => options.state,
      play: options.play ?? (() => true),
      pause: () => {
        options.state.isPlaying = false;
      },
      seek: (positionSeconds) => {
        options.state.currentTime = positionSeconds;
        return "direct";
      },
    },
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      options.sockets.push(socket);
      return socket;
    },
    now: () => 1234,
    setTimeout: (callback) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  });
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("SyncplaySessionController", () => {
  test("sends local playback changes through the syncplay client", () => {
    const sockets: FakeWebSocket[] = [];
    const controller = createController({
      sockets,
      state: {
        isPlaying: true,
        currentTime: 12,
        duration: 120,
        canPlay: true,
        isLoading: false,
        error: null,
      },
    });

    controller.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    controller.handleLocalPlaybackChange(false);

    expect(sockets[0]?.sent).toEqual([
      {
        State: {
          ping: {
            clientLatencyCalculation: 1.234,
            clientRtt: 0,
            serverRtt: 0,
            latencyCalculation: 0,
          },
          playstate: {
            doSeek: false,
            paused: false,
            position: 12,
            setBy: null,
          },
          ignoringOnTheFly: {
            client: 0,
            server: 0,
          },
        },
      },
    ]);
  });

  test("replies with current local state when remote play fails", async () => {
    const sockets: FakeWebSocket[] = [];
    const state: SyncplayPlayerState = {
      isPlaying: false,
      currentTime: 12,
      duration: 120,
      canPlay: true,
      isLoading: false,
      error: null,
    };
    const controller = createController({
      sockets,
      state,
      play: () => {
        state.error = "play failed";
        return false;
      },
    });

    controller.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 99,
          doSeek: false,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    await flushPromises();

    expect(sockets[0]?.sent).toEqual([
      {
        State: {
          ping: {
            clientLatencyCalculation: 1.234,
            clientRtt: 0,
            serverRtt: 0,
            latencyCalculation: 0,
          },
          playstate: {
            doSeek: false,
            paused: true,
            position: 99,
            setBy: null,
          },
          ignoringOnTheFly: {
            client: 0,
            server: 0,
          },
        },
      },
    ]);
  });
});
