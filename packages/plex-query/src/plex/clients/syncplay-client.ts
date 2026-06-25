import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";

export interface SyncplayUser {
  id: number;
  deviceIdentifier: string;
  deviceName: string;
}

export interface SyncplayParticipantState {
  user: SyncplayUser;
  isPresent?: boolean;
  isReady?: boolean | null;
  positionSeconds?: number;
  isPaused?: boolean;
}

export interface SyncplayPlaybackState {
  user: SyncplayUser | null;
  isPaused: boolean;
  positionSeconds: number;
  shouldSeek: boolean;
}

interface SyncplayClientOptions {
  room: Pick<WatchTogetherRoom, "id" | "syncplayHost" | "syncplayPort" | "sourceUri">;
  user: SyncplayUser;
  onParticipant?: (state: SyncplayParticipantState) => void;
  onPlaybackState?: (state: SyncplayPlaybackState) => void;
  onClose?: () => void;
  onError?: (error: Event | Error) => void;
}

interface SyncplayStateInput {
  isPaused: boolean;
  positionSeconds: number;
  shouldSeek?: boolean;
}

type SyncplayIncomingFrame =
  | { Hello: { username: string; room: { name: string } } }
  | { List: Record<string, Record<string, SyncplayListUserState>> }
  | { Set: SyncplaySetPayload }
  | { State: SyncplayStatePayload }
  | { Error: unknown };

interface SyncplayListUserState {
  position?: number;
  isReady?: boolean | null;
  file?: unknown;
}

interface SyncplaySetPayload {
  ready?: {
    username: string;
    isReady: boolean | null;
  };
  user?: Record<
    string,
    {
      room?: { name?: string };
      event?: { joined?: boolean; left?: boolean };
    }
  >;
}

interface SyncplayStatePayload {
  playstate: {
    position: number;
    paused: boolean;
    doSeek?: boolean;
    setBy?: string | null;
  };
}

export class SyncplayClient {
  private socket: WebSocket | null = null;
  private readonly room: SyncplayClientOptions["room"];
  private readonly user: SyncplayUser;
  private readonly onParticipant: NonNullable<SyncplayClientOptions["onParticipant"]>;
  private readonly onPlaybackState: NonNullable<SyncplayClientOptions["onPlaybackState"]>;
  private readonly onClose: NonNullable<SyncplayClientOptions["onClose"]>;
  private readonly onError: NonNullable<SyncplayClientOptions["onError"]>;
  private requestedReady: boolean | null | undefined;

  constructor(options: SyncplayClientOptions) {
    this.room = options.room;
    this.user = options.user;
    this.onParticipant = options.onParticipant ?? (() => undefined);
    this.onPlaybackState = options.onPlaybackState ?? (() => undefined);
    this.onClose = options.onClose ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
  }

  connect(): void {
    this.disconnect();

    const socket = new WebSocket(`wss://${this.room.syncplayHost}:${this.room.syncplayPort}/ws`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.send({
        Hello: {
          room: { name: this.room.id },
          username: encodeSyncplayUser(this.user),
          version: "1.6.4",
        },
      });
    });
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.onClose();
    });
    socket.addEventListener("error", (event) => this.onError(event));
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    socket.close(1000);
  }

  setReady(isReady: boolean | null): void {
    this.requestedReady = isReady;
    this.send({ Set: { ready: { isReady } } });
  }

  setFile(): void {
    this.send({
      Set: {
        file: {
          name: JSON.stringify({
            ads: { playing: false },
            uri: this.room.sourceUri,
          }),
        },
      },
    });
  }

  sendState(state: SyncplayStateInput): void {
    this.send({
      State: {
        ping: {
          clientLatencyCalculation: performance.now() / 1000,
          clientRtt: 0,
          serverRtt: 0,
          latencyCalculation: 0,
        },
        playstate: {
          doSeek: state.shouldSeek ?? false,
          paused: state.isPaused,
          position: state.positionSeconds,
          setBy: null,
        },
        ignoringOnTheFly: {
          client: 0,
          server: 0,
        },
      },
    });
  }

  private handleMessage(event: MessageEvent<string>): void {
    let frame: SyncplayIncomingFrame;

    try {
      frame = JSON.parse(event.data) as SyncplayIncomingFrame;
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error("Invalid syncplay frame"));
      return;
    }

    if ("Error" in frame) {
      this.onError(new Error(`Syncplay protocol error: ${JSON.stringify(frame.Error)}`));
      this.disconnect();
      return;
    }

    if ("Hello" in frame) {
      this.send({ List: {} });
      this.setFile();
      this.setReady(this.requestedReady ?? null);
      return;
    }

    if ("List" in frame) {
      this.handleList(frame.List);
      return;
    }

    if ("Set" in frame) {
      this.handleSet(frame.Set);
      return;
    }

    if ("State" in frame) {
      this.handleState(frame.State);
    }
  }

  private handleList(list: Record<string, Record<string, SyncplayListUserState>>): void {
    const roomUsers = list[this.room.id];
    if (!roomUsers) {
      return;
    }

    for (const [encodedUser, state] of Object.entries(roomUsers)) {
      const user = decodeSyncplayUser(encodedUser);
      if (!user) {
        continue;
      }

      this.onParticipant({
        user,
        isPresent: true,
        isReady: state.isReady,
        positionSeconds: state.position,
      });
    }
  }

  private handleSet(payload: SyncplaySetPayload): void {
    if (payload.ready) {
      const user = decodeSyncplayUser(payload.ready.username);
      if (user) {
        this.onParticipant({ user, isReady: payload.ready.isReady });
      }
    }

    if (payload.user) {
      for (const [encodedUser, value] of Object.entries(payload.user)) {
        if (value.room?.name !== this.room.id) {
          continue;
        }

        const user = decodeSyncplayUser(encodedUser);
        if (!user) {
          continue;
        }

        this.onParticipant({
          user,
          isPresent: value.event?.left ? false : value.event?.joined ? true : undefined,
        });
      }
    }
  }

  private handleState(payload: SyncplayStatePayload): void {
    const user = payload.playstate.setBy ? decodeSyncplayUser(payload.playstate.setBy) : null;

    if (user?.deviceIdentifier === this.user.deviceIdentifier) {
      return;
    }

    this.onPlaybackState({
      user,
      isPaused: payload.playstate.paused,
      positionSeconds: payload.playstate.position,
      shouldSeek: Boolean(payload.playstate.doSeek),
    });

    this.sendState({
      isPaused: payload.playstate.paused,
      positionSeconds: payload.playstate.position,
      shouldSeek: false,
    });
  }

  private send(frame: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(frame));
  }
}

export function encodeSyncplayUser(user: SyncplayUser): string {
  return JSON.stringify({
    deviceIdentifier: user.deviceIdentifier,
    deviceName: user.deviceName,
    userID: String(user.id),
  });
}

export function decodeSyncplayUser(value: string): SyncplayUser | null {
  try {
    const parsed = JSON.parse(value.replace(/_+$/, "")) as {
      deviceIdentifier?: unknown;
      deviceName?: unknown;
      userID?: unknown;
    };

    if (
      typeof parsed.deviceIdentifier !== "string" ||
      typeof parsed.deviceName !== "string" ||
      typeof parsed.userID !== "string"
    ) {
      return null;
    }

    return {
      id: Number.parseInt(parsed.userID, 10),
      deviceIdentifier: parsed.deviceIdentifier,
      deviceName: parsed.deviceName,
    };
  } catch {
    return null;
  }
}
