import { describe, expect, test } from "bun:test";
import {
  encodeSyncplayUser,
  SKIP_SYNCPLAY_REPLY,
  SyncplayClient,
  type SyncplayParticipantState,
  type SyncplayWebSocketLike,
} from "./syncplay-client";
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
  readonly url: string;
  readyState = 0;
  sent: unknown[] = [];
  private readonly listeners = {
    open: [] as (() => void)[],
    message: [] as ((event: MessageEvent<string>) => void)[],
    close: [] as (() => void)[],
    error: [] as ((event: Event) => void)[],
  };

  constructor(url: string) {
    this.url = url;
  }

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

function createClient(options: {
  sockets: FakeWebSocket[];
  participants?: SyncplayParticipantState[];
  onPlaybackState?: ConstructorParameters<typeof SyncplayClient>[0]["onPlaybackState"];
  getPlaybackState?: ConstructorParameters<typeof SyncplayClient>[0]["getPlaybackState"];
}) {
  return new SyncplayClient({
    room: ROOM,
    user: LOCAL_USER,
    onParticipant: (participant) => options.participants?.push(participant),
    onPlaybackState: options.onPlaybackState,
    getPlaybackState: options.getPlaybackState,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      options.sockets.push(socket);
      return socket;
    },
    now: () => 1234,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SyncplayClient", () => {
  test("sends hello on open and announces file and readiness after server hello", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets });

    client.connect();
    client.setReady(true);

    const socket = sockets[0];
    expect(socket?.url).toBe("wss://syncplay.example.test:443/ws");
    expect(socket?.sent).toEqual([]);

    socket?.open();
    expect(socket?.sent).toEqual([
      {
        Hello: {
          room: { name: ROOM.id },
          username: encodeSyncplayUser(LOCAL_USER),
          version: "1.6.4",
        },
      },
    ]);

    socket?.message({
      Hello: { username: encodeSyncplayUser(LOCAL_USER), room: { name: ROOM.id } },
    });

    expect(socket?.sent.slice(1)).toEqual([
      { List: {} },
      {
        Set: {
          file: {
            name: JSON.stringify({
              ads: { playing: false },
              uri: ROOM.sourceUri,
            }),
          },
        },
      },
      { Set: { ready: { isReady: true } } },
    ]);
  });

  test("tracks participants and handles leave events without room names", () => {
    const participants: SyncplayParticipantState[] = [];
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets, participants });
    client.connect();
    sockets[0]?.open();

    const encodedRemoteUser = encodeSyncplayUser(REMOTE_USER);
    sockets[0]?.message({
      List: {
        [ROOM.id]: {
          [encodedRemoteUser]: { isReady: true, position: 42 },
        },
      },
    });
    sockets[0]?.message({
      Set: {
        user: {
          [encodedRemoteUser]: { event: { left: true } },
        },
      },
    });

    expect(participants).toEqual([
      {
        user: REMOTE_USER,
        isPresent: true,
        isReady: true,
        positionSeconds: 42,
      },
      {
        user: REMOTE_USER,
        isPresent: false,
      },
    ]);
  });

  test("replies with current local state when playback handler rejects", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({
      sockets,
      onPlaybackState: () => {
        throw new Error("apply failed");
      },
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 12,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 99,
          doSeek: true,
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

  test("does not reply when playback handler returns skip reply", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({
      sockets,
      onPlaybackState: () => SKIP_SYNCPLAY_REPLY,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 12,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 99,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    await flushPromises();

    expect(sockets[0]?.sent).toEqual([]);
  });

  test("with no playback handlers, replies to State by echoing the room playstate (presence heartbeat)", async () => {
    // The lobby presence connection has no player to drive, so it must keep the
    // membership alive by replying to the server's ~1Hz State pings — but it
    // echoes the server's own playstate so it can never move a watcher's
    // position/pause. (Mirrors Plex's client when its player isn't foreground.)
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets });

    client.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      Hello: { username: encodeSyncplayUser(LOCAL_USER), room: { name: ROOM.id } },
    });
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 99,
          doSeek: true,
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
            paused: false,
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

  test("buffers outbound playback state while connecting", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets });
    client.connect();

    client.sendState({ isPaused: false, positionSeconds: 30, shouldSeek: true });
    expect(sockets[0]?.sent).toEqual([]);

    sockets[0]?.open();

    expect(sockets[0]?.sent).toEqual([
      {
        Hello: {
          room: { name: ROOM.id },
          username: encodeSyncplayUser(LOCAL_USER),
          version: "1.6.4",
        },
      },
      {
        State: {
          ping: {
            clientLatencyCalculation: 1.234,
            clientRtt: 0,
            serverRtt: 0,
            latencyCalculation: 0,
          },
          playstate: {
            doSeek: true,
            paused: false,
            position: 30,
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
