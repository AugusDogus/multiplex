import { describe, expect, test } from "bun:test";
import {
  encodeSyncplayUser,
  SyncplayClient,
  type SyncplayParticipantState,
  type SyncplayPlaybackState,
  type SyncplayRemoteAction,
  type SyncplayStateInput,
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
  observer?: boolean;
  applied?: SyncplayPlaybackState[];
  actions?: SyncplayRemoteAction[];
  getPlaybackState?: () => SyncplayStateInput | null | undefined;
}) {
  return new SyncplayClient({
    room: ROOM,
    user: LOCAL_USER,
    observer: options.observer,
    onParticipant: (participant) => options.participants?.push(participant),
    onRemoteAction: (action) => options.actions?.push(action),
    applyRemoteState: (state) => options.applied?.push(state),
    getPlaybackState: options.getPlaybackState,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      options.sockets.push(socket);
      return socket;
    },
    now: () => 1234,
  });
}

function lastPlaystate(socket: FakeWebSocket | undefined) {
  const frame = socket?.sent.at(-1) as
    | {
        State?: {
          ping?: {
            clientLatencyCalculation: number;
            clientRtt: number;
            serverRtt: number;
            latencyCalculation: number;
          };
          playstate?: { paused: boolean; position: number; doSeek: boolean; setBy: string | null };
          ignoringOnTheFly?: { client: number; server: number };
        };
      }
    | undefined;
  return frame?.State;
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

  test("applies a remote playstate and replies with the adopted state", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 12, shouldSeek: false }),
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

    expect(applied).toEqual([
      { user: REMOTE_USER, isPaused: false, positionSeconds: 99, shouldSeek: true },
    ]);
    // We adopted the remote state, so the reply reflects it (not a stale
    // pre-apply sample of the local player).
    expect(lastPlaystate(sockets[0])).toEqual({
      ping: {
        clientLatencyCalculation: 1.234,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: { doSeek: false, paused: false, position: 99, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("ignores a remote playstate that the server attributes to us", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({ isPaused: false, positionSeconds: 30, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 5,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(applied).toEqual([]); // never re-apply our own change
    // still replies (heartbeat) with our own state
    expect(lastPlaystate(sockets[0])?.playstate).toEqual({
      doSeek: false,
      paused: false,
      position: 30,
      setBy: null,
    });
  });

  test("claims a local pause and ignores an in-flight peer override", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    // Local player is now paused at 20 (the user just paused).
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 20, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    // User paused locally.
    client.markLocalPlayPause();

    // A peer is still playing and the server relays their State.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 25,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    // The peer's "playing" must NOT be applied (would clobber our pause)...
    expect(applied).toEqual([]);
    // ...and we claim the pause: own state, attributed to us, client counter raised.
    expect(lastPlaystate(sockets[0])).toEqual({
      ping: {
        clientLatencyCalculation: 1.234,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: {
        doSeek: false,
        paused: true,
        position: 20,
        setBy: encodeSyncplayUser(LOCAL_USER),
      },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("clears the in-flight flag once the server acknowledges our client counter", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 20, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();
    client.markLocalPlayPause();
    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 25, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    // in flight now (client = 1)
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({ client: 1, server: 0 });

    // Server acks our counter and reports the agreed (paused) state.
    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 20, setBy: encodeSyncplayUser(LOCAL_USER) },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({ client: 0, server: 0 });
  });

  test("defers (echoes) while the server is relaying another client's change", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({ isPaused: false, positionSeconds: 50, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    // Server signals it's mid-change for someone else (server counter > 0).
    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 70, setBy: encodeSyncplayUser(REMOTE_USER) },
        ignoringOnTheFly: { client: 0, server: 3 },
      },
    });

    // We still apply the peer's change to our player (that's how it propagates),
    // but our reply echoes the server's state rather than asserting our own.
    expect(applied).toEqual([
      { user: REMOTE_USER, isPaused: true, positionSeconds: 70, shouldSeek: false },
    ]);
    expect(lastPlaystate(sockets[0])?.playstate).toEqual({
      doSeek: false,
      paused: true,
      position: 70,
      setBy: null,
    });
  });

  test("carries a local change forward when it happens while the server is relaying a peer", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({
      sockets,
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 50, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();
    client.markLocalPlayPause();

    // Server is mid-change for someone else (server > 0): we can't claim yet, so
    // we echo — but the pending local change must NOT be dropped.
    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 70, setBy: encodeSyncplayUser(REMOTE_USER) },
        ignoringOnTheFly: { client: 0, server: 3 },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({ client: 0, server: 3 });

    // Once the server stops relaying, our still-pending change is claimed.
    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 72, setBy: encodeSyncplayUser(REMOTE_USER) },
        ignoringOnTheFly: { client: 0, server: 0 },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({ client: 1, server: 0 });
  });

  test("observer echoes every State ping (presence heartbeat), even pings attributed to us", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({ sockets, observer: true, applied });

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
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(applied).toEqual([]); // observers never drive a player
    expect(lastPlaystate(sockets[0])).toEqual({
      ping: {
        clientLatencyCalculation: 1.234,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: { doSeek: false, paused: false, position: 99, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("still replies (heartbeat) when applyRemoteState throws", () => {
    const sockets: FakeWebSocket[] = [];
    const client = new SyncplayClient({
      room: ROOM,
      user: LOCAL_USER,
      applyRemoteState: () => {
        throw new Error("player blew up");
      },
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 5, shouldSeek: false }),
      onError: () => undefined,
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      now: () => 1234,
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 99, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });

    // The throw must not abort the reply, or the socket would stop participating.
    // And since the apply failed, the reply must report our real local state
    // (paused@5) rather than echoing the remote state we never adopted (play@99).
    expect(lastPlaystate(sockets[0])?.playstate).toMatchObject({
      paused: true,
      position: 5,
    });
  });

  test("rejects a State frame with a non-numeric ignoringOnTheFly counter", () => {
    const sockets: FakeWebSocket[] = [];
    const errors: unknown[] = [];
    const client = new SyncplayClient({
      room: ROOM,
      user: LOCAL_USER,
      onError: (error) => errors.push(error),
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      now: () => 1234,
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 1 },
        ignoringOnTheFly: { server: "1" },
      },
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(sockets[0]?.sent).toEqual([]); // invalid frame -> no reply
  });

  test("reports remote pause/resume edges and doSeek frames with their author", () => {
    const sockets: FakeWebSocket[] = [];
    const actions: SyncplayRemoteAction[] = [];
    const client = createClient({
      sockets,
      actions,
      getPlaybackState: () => ({ isPaused: false, positionSeconds: 10, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();

    // First frame is a baseline (no paused edge yet), even if authored remotely.
    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 10, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    expect(actions).toEqual([]);

    // paused false -> true: a remote pause.
    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 12, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    // Repeated frame with the same paused value (sticky setBy): heartbeat, no action.
    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 12, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    // paused true -> false: a remote resume.
    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 12, setBy: encodeSyncplayUser(REMOTE_USER) },
      },
    });
    // An explicit remote seek.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 90,
          doSeek: true,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(actions).toEqual([
      { type: "pause", user: REMOTE_USER, positionSeconds: 12 },
      { type: "resume", user: REMOTE_USER, positionSeconds: 12 },
      { type: "seek", user: REMOTE_USER, positionSeconds: 90 },
    ]);
  });

  test("never reports our own actions echoed back by the server", () => {
    const sockets: FakeWebSocket[] = [];
    const actions: SyncplayRemoteAction[] = [];
    const client = createClient({
      sockets,
      actions,
      getPlaybackState: () => ({ isPaused: true, positionSeconds: 20, shouldSeek: false }),
    });
    client.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: { paused: false, position: 19, setBy: encodeSyncplayUser(LOCAL_USER) },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 20, setBy: encodeSyncplayUser(LOCAL_USER) },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 80,
          doSeek: true,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(actions).toEqual([]);
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
          playstate: { doSeek: true, paused: false, position: 30, setBy: null },
          ignoringOnTheFly: { client: 0, server: 0 },
        },
      },
    ]);
  });
});
