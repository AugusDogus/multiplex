import { describe, expect, test } from "bun:test";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import {
  encodeSyncplayUser,
  SyncplayClient,
  type SyncplayParticipantState,
  type SyncplayPlaybackState,
  type SyncplayRemoteAction,
  type SyncplayRemoteStateApplyResult,
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
const NOW_EPOCH_MILLISECONDS = 1_800_000_000_123;
const NOW_EPOCH_SECONDS = NOW_EPOCH_MILLISECONDS / 1000;

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
  ping?: {
    clientLatencyCalculation: number;
    clientRtt: number;
    serverRtt: number;
    latencyCalculation: number;
  };
  playstate?: {
    paused: boolean;
    position: number;
    doSeek: boolean;
    setBy: string | null;
  };
  ignoringOnTheFly?: { client: number; server: number };
}

interface OutgoingStateFrame {
  State?: OutgoingStatePayload;
}

class FakeWebSocket implements SyncplayWebSocketLike {
  readonly url: string;
  readyState = 0;
  sent: unknown[] = [];
  private readonly listeners: FakeWebSocketListeners = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
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
    this.listeners[type].push(fromAny(listener));
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.open) {
      listener();
    }
  }

  message(frame: SyncplayFrameFixture): void {
    const event = fromPartial<MessageEvent<string>>({
      data: JSON.stringify(frame),
    });
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
  applyRemoteState?: (state: SyncplayPlaybackState) => SyncplayRemoteStateApplyResult;
}) {
  return new SyncplayClient({
    room: ROOM,
    user: LOCAL_USER,
    observer: options.observer,
    onParticipant: (participant) => options.participants?.push(participant),
    onRemoteAction: (action) => options.actions?.push(action),
    applyRemoteState: (state) => {
      options.applied?.push(state);
      return options.applyRemoteState?.(state) ?? "applied";
    },
    getPlaybackState: options.getPlaybackState,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      options.sockets.push(socket);
      return socket;
    },
    now: () => NOW_EPOCH_MILLISECONDS,
  });
}

function lastPlaystate(socket: FakeWebSocket | undefined): OutgoingStatePayload | undefined {
  const frame: OutgoingStateFrame | undefined = fromAny(socket?.sent.at(-1));
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
      Hello: {
        username: encodeSyncplayUser(LOCAL_USER),
        room: { name: ROOM.id },
      },
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

  test("treats ready updates as presence when Plex omits the joined frame", () => {
    const participants: SyncplayParticipantState[] = [];
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets, participants });
    client.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      Set: {
        ready: {
          username: encodeSyncplayUser(REMOTE_USER),
          isReady: false,
        },
      },
    });

    expect(participants).toEqual([
      {
        user: REMOTE_USER,
        isPresent: true,
        isReady: false,
      },
    ]);
  });

  test("applies a remote playstate and replies with the adopted state", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    let localState: SyncplayStateInput = {
      isPaused: true,
      positionSeconds: 12,
      shouldSeek: false,
    };
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => localState,
      applyRemoteState: (state) => {
        localState = {
          isPaused: state.isPaused,
          positionSeconds: state.positionSeconds,
          shouldSeek: false,
        };
        return "applied";
      },
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
      {
        user: REMOTE_USER,
        isPaused: false,
        positionSeconds: 99,
        shouldSeek: true,
      },
    ]);
    // We adopted the remote state, so the reply reflects it (not a stale
    // pre-apply sample of the local player).
    expect(lastPlaystate(sockets[0])).toEqual({
      ping: {
        clientLatencyCalculation: NOW_EPOCH_SECONDS,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: { doSeek: false, paused: false, position: 99, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("reports the actual local position on an ordinary heartbeat", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({
      sockets,
      getPlaybackState: () => ({
        isPaused: false,
        positionSeconds: 99.6,
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

    expect(lastPlaystate(sockets[0])?.playstate).toEqual({
      doSeek: false,
      paused: false,
      position: 99.6,
      setBy: null,
    });
  });

  test("reports client latency timestamps as Unix epoch seconds", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({ sockets });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        playstate: { paused: true, position: 0 },
      },
    });

    expect(lastPlaystate(sockets[0])?.ping?.clientLatencyCalculation).toBe(NOW_EPOCH_SECONDS);
  });

  test("compensates a playing remote position for measured forward delay", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({ sockets, applied });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        ping: {
          clientLatencyCalculation: NOW_EPOCH_SECONDS - 0.2,
          serverRtt: 0.1,
        },
        playstate: { paused: false, position: 10 },
      },
    });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.positionSeconds).toBeCloseTo(10.2, 5);
    expect(lastPlaystate(sockets[0])?.ping?.clientRtt).toBeCloseTo(0.2, 5);
  });

  test("does not compensate from a stale or foreign ping timestamp", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({ sockets, applied });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    sockets[0]?.message({
      State: {
        ping: {
          clientLatencyCalculation: 1234.5,
          serverRtt: 0.1,
        },
        playstate: { paused: false, position: 10 },
      },
    });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.positionSeconds).toBe(10);
    expect(lastPlaystate(sockets[0])?.ping?.clientRtt).toBe(0);
  });

  test("ignores a remote playstate that the server attributes to us", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused: false,
        positionSeconds: 30,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);
    client.markLocalPlayPause();

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

  test("adopts sticky state from this device after a fresh connection", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 0,
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
          position: 30,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(applied).toEqual([
      {
        user: LOCAL_USER,
        isPaused: false,
        positionSeconds: 30,
        shouldSeek: false,
      },
    ]);
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
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
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
    // ...and we claim the pause with the client counter. The server assigns
    // `setBy`, matching Plex Web's wire format.
    expect(lastPlaystate(sockets[0])).toEqual({
      ping: {
        clientLatencyCalculation: NOW_EPOCH_SECONDS,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: {
        doSeek: false,
        paused: true,
        position: 20,
        setBy: null,
      },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("reclaims a local pause interrupted by a server relay", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);
    client.markLocalPlayPause();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 19,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 1,
      server: 0,
    });

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 20,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
        ignoringOnTheFly: { client: 0, server: 1 },
      },
    });

    expect(applied).toEqual([]);
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 1,
    });

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 21,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(lastPlaystate(sockets[0])).toMatchObject({
      playstate: { paused: true, position: 20 },
      ignoringOnTheFly: { client: 1, server: 0 },
    });
  });

  test("does not reclaim a local pause acknowledged during a server relay", () => {
    const sockets: FakeWebSocket[] = [];
    const client = createClient({
      sockets,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);
    client.markLocalPlayPause();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 19,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly?.client).toBe(1);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 20,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 1 },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 1,
    });

    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 20,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });

    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 0,
    });
  });

  test("clears the in-flight flag once the server acknowledges our client counter", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    client.markLocalPlayPause();
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 25,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // in flight now (client = 1)
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 1,
      server: 0,
    });

    // Server acks our counter and reports the agreed (paused) state.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 20,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 0,
    });
  });

  test("reconciles an accepted self-authored seek without replaying it", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    let isPaused = false;
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused,
        positionSeconds: 100,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    client.markLocalSeek();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 20,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly?.client).toBe(1);

    // The replacement media element did not resume, but Plex accepted our
    // playing seek. Its acknowledgement must repair playstate without issuing
    // the same doSeek again.
    isPaused = true;
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 100,
          doSeek: true,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });

    expect(applied).toEqual([
      {
        user: LOCAL_USER,
        isPaused: false,
        positionSeconds: 100,
        shouldSeek: false,
      },
    ]);
  });

  test("claims the newest rapid seek after the previous seek is acknowledged", () => {
    const sockets: FakeWebSocket[] = [];
    let positionSeconds = 100;
    const client = createClient({
      sockets,
      getPlaybackState: () => ({
        isPaused: false,
        positionSeconds,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();

    client.markLocalSeek();
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 10,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(lastPlaystate(sockets[0])?.playstate).toMatchObject({
      doSeek: true,
      position: 100,
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly?.client).toBe(1);

    positionSeconds = 200;
    client.markLocalSeek();
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 100,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 0, server: 0 },
      },
    });
    expect(lastPlaystate(sockets[0])?.playstate).toMatchObject({
      doSeek: false,
      position: 200,
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly?.client).toBe(1);

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 100,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
        ignoringOnTheFly: { client: 1, server: 0 },
      },
    });
    expect(lastPlaystate(sockets[0])?.playstate).toMatchObject({
      doSeek: true,
      position: 200,
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly?.client).toBe(1);
  });

  test("defers (echoes) while the server is relaying another client's change", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({
      sockets,
      applied,
      getPlaybackState: () => ({
        isPaused: false,
        positionSeconds: 50,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    sockets[0]?.sent.splice(0);

    // Server signals it's mid-change for someone else (server counter > 0).
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 70,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
        ignoringOnTheFly: { client: 0, server: 3 },
      },
    });

    // We still apply the peer's change to our player (that's how it propagates),
    // but our reply echoes the server's state rather than asserting our own.
    expect(applied).toEqual([
      {
        user: REMOTE_USER,
        isPaused: true,
        positionSeconds: 70,
        shouldSeek: false,
      },
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
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 50,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();
    client.markLocalPlayPause();

    // Server is mid-change for someone else (server > 0): we can't claim yet, so
    // we echo — but the pending local change must NOT be dropped.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 70,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
        ignoringOnTheFly: { client: 0, server: 3 },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 0,
      server: 3,
    });

    // Once the server stops relaying, our still-pending change is claimed.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 72,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
        ignoringOnTheFly: { client: 0, server: 0 },
      },
    });
    expect(lastPlaystate(sockets[0])?.ignoringOnTheFly).toEqual({
      client: 1,
      server: 0,
    });
  });

  test("observer echoes every State ping (presence heartbeat), even pings attributed to us", () => {
    const sockets: FakeWebSocket[] = [];
    const applied: SyncplayPlaybackState[] = [];
    const client = createClient({ sockets, observer: true, applied });

    client.connect();
    sockets[0]?.open();
    sockets[0]?.message({
      Hello: {
        username: encodeSyncplayUser(LOCAL_USER),
        room: { name: ROOM.id },
      },
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
        clientLatencyCalculation: NOW_EPOCH_SECONDS,
        clientRtt: 0,
        serverRtt: 0,
        latencyCalculation: 0,
      },
      playstate: { doSeek: false, paused: false, position: 99, setBy: null },
      ignoringOnTheFly: { client: 0, server: 0 },
    });
  });

  test("keeps the room authoritative when applyRemoteState throws", () => {
    const sockets: FakeWebSocket[] = [];
    const client = new SyncplayClient({
      room: ROOM,
      user: LOCAL_USER,
      applyRemoteState: () => {
        throw new Error("player blew up");
      },
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 5,
        shouldSeek: false,
      }),
      onError: () => undefined,
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      now: () => NOW_EPOCH_MILLISECONDS,
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

    // An unready player must not reset the room to its stale local sample. Echo
    // the authoritative state so the next heartbeat can retry the apply.
    expect(lastPlaystate(sockets[0])?.playstate).toMatchObject({
      paused: false,
      position: 99,
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
      now: () => NOW_EPOCH_MILLISECONDS,
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
      getPlaybackState: () => ({
        isPaused: false,
        positionSeconds: 10,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();

    // First frame is a baseline (no paused edge yet), even if authored remotely.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 10,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(actions).toEqual([]);

    // paused false -> true: a remote pause.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 12,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // Repeated frame with the same paused value (sticky setBy): heartbeat, no action.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 12,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // paused true -> false: a remote resume.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 12,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
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

  test("does not report the auto-start (first move into playing) as a resume", () => {
    const sockets: FakeWebSocket[] = [];
    const actions: SyncplayRemoteAction[] = [];
    const client = createClient({
      sockets,
      actions,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 0,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();

    // Lobby baseline: room is paused at 0 (nobody has started yet).
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // Auto-start: the room moves into playing for the first time. This is the
    // session starting, NOT a deliberate resume — it must not be reported.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 0,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(actions).toEqual([]);

    // A genuine later pause/resume once the room is playing IS reported.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 20,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 20,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    expect(actions).toEqual([
      { type: "pause", user: REMOTE_USER, positionSeconds: 20 },
      { type: "resume", user: REMOTE_USER, positionSeconds: 20 },
    ]);
  });

  test("does not report a remote action while a local change is in flight", () => {
    const sockets: FakeWebSocket[] = [];
    const actions: SyncplayRemoteAction[] = [];
    const client = createClient({
      sockets,
      actions,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();

    // Baseline frame (paused=false).
    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 10,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });
    // Local pause goes in flight (raises ignoringClient on the next frame).
    client.markLocalPlayPause();
    // A peer's pause edge arrives while our change is in flight: it is NOT
    // applied to our player, so it must NOT be surfaced as a remote action.
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 12,
          setBy: encodeSyncplayUser(REMOTE_USER),
        },
      },
    });

    expect(actions).toEqual([]);
  });

  test("never reports our own actions echoed back by the server", () => {
    const sockets: FakeWebSocket[] = [];
    const actions: SyncplayRemoteAction[] = [];
    const client = createClient({
      sockets,
      actions,
      getPlaybackState: () => ({
        isPaused: true,
        positionSeconds: 20,
        shouldSeek: false,
      }),
    });
    client.connect();
    sockets[0]?.open();

    sockets[0]?.message({
      State: {
        playstate: {
          paused: false,
          position: 19,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
      },
    });
    sockets[0]?.message({
      State: {
        playstate: {
          paused: true,
          position: 20,
          setBy: encodeSyncplayUser(LOCAL_USER),
        },
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

    client.sendState({
      isPaused: false,
      positionSeconds: 30,
      shouldSeek: true,
    });
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
            clientLatencyCalculation: NOW_EPOCH_SECONDS,
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
