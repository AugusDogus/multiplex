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
  onPlaybackState?: (
    state: SyncplayPlaybackState,
  ) => Promise<SyncplayStateReply> | SyncplayStateReply;
  onClose?: () => void;
  onError?: (error: Event | Error) => void;
}

interface SyncplayStateInput {
  isPaused: boolean;
  positionSeconds: number;
  shouldSeek?: boolean;
}

interface SyncplaySkipReply {
  skipReply: true;
}

type SyncplayStateReply = SyncplayStateInput | SyncplaySkipReply | null | void;

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
  ping?: SyncplayPingState;
  playstate: {
    position: number;
    paused: boolean;
    doSeek?: boolean;
    setBy?: string | null;
  };
}

interface SyncplayPingState {
  clientLatencyCalculation?: number;
  clientRtt?: number;
  serverRtt?: number;
  latencyCalculation?: number;
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
  private lastPing: SyncplayPingState | null = null;
  private pendingState: SyncplayStateInput | null = null;
  private readonly knownParticipants = new Map<string, SyncplayUser>();
  private connectionId = 0;

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

    this.connectionId += 1;
    const connectionId = this.connectionId;
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
      this.flushPendingState();
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleMessage(event, connectionId);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.onClose();
    });
    socket.addEventListener("error", (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.onError(event);
      this.disconnect({ notify: true });
    });
  }

  disconnect(options: { notify?: boolean } = {}): void {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.connectionId += 1;
    this.pendingState = null;
    socket.close(1000);
    if (options.notify) {
      this.onClose();
    }
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
    const frame = {
      State: {
        ping: {
          clientLatencyCalculation: performance.now() / 1000,
          clientRtt: this.lastPing?.clientRtt ?? 0,
          serverRtt: this.lastPing?.serverRtt ?? 0,
          latencyCalculation: this.lastPing?.latencyCalculation ?? 0,
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
    };

    if (!this.send(frame) && this.socket?.readyState === WebSocket.CONNECTING) {
      this.pendingState = state;
    }
  }

  private handleMessage(event: MessageEvent<string>, connectionId: number): void {
    let frame: SyncplayIncomingFrame;

    try {
      frame = JSON.parse(event.data) as SyncplayIncomingFrame;
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error("Invalid syncplay frame"));
      return;
    }

    if (typeof frame !== "object" || frame === null) {
      this.onError(new Error("Invalid syncplay frame: expected object"));
      return;
    }

    if ("Error" in frame) {
      this.onError(new Error(`Syncplay protocol error: ${JSON.stringify(frame.Error)}`));
      this.disconnect({ notify: true });
      return;
    }

    if ("Hello" in frame) {
      if (!isRecord(frame.Hello)) {
        this.onError(new Error("Invalid syncplay Hello frame"));
        return;
      }
      this.send({ List: {} });
      this.setFile();
      this.setReady(this.requestedReady ?? null);
      return;
    }

    if ("List" in frame) {
      if (!isValidListPayload(frame.List, this.room.id)) {
        this.onError(new Error("Invalid syncplay List frame"));
        return;
      }
      this.handleList(frame.List);
      return;
    }

    if ("Set" in frame) {
      if (!isValidSetPayload(frame.Set)) {
        this.onError(new Error("Invalid syncplay Set frame"));
        return;
      }
      this.handleSet(frame.Set);
      return;
    }

    if ("State" in frame) {
      if (!isValidStatePayload(frame.State)) {
        this.onError(new Error("Invalid syncplay State frame"));
        return;
      }
      this.handleState(frame.State, connectionId);
    }
  }

  private handleList(list: Record<string, Record<string, SyncplayListUserState>>): void {
    const roomUsers = list[this.room.id];
    if (!roomUsers) {
      return;
    }

    const presentUsers = new Set<string>();

    for (const [encodedUser, state] of Object.entries(roomUsers)) {
      const user = decodeSyncplayUser(encodedUser);
      if (!user) {
        continue;
      }

      presentUsers.add(user.deviceIdentifier);
      this.knownParticipants.set(user.deviceIdentifier, user);
      this.onParticipant({
        user,
        isPresent: true,
        isReady: state.isReady,
        positionSeconds: state.position,
      });
    }

    for (const [deviceIdentifier, user] of this.knownParticipants) {
      if (presentUsers.has(deviceIdentifier)) {
        continue;
      }

      this.onParticipant({
        user,
        isPresent: false,
      });
      this.knownParticipants.delete(deviceIdentifier);
    }
  }

  private handleSet(payload: SyncplaySetPayload): void {
    if (payload.ready) {
      const user = decodeSyncplayUser(payload.ready.username);
      if (user) {
        this.knownParticipants.set(user.deviceIdentifier, user);
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

        if (value.event?.left) {
          this.knownParticipants.delete(user.deviceIdentifier);
        } else {
          this.knownParticipants.set(user.deviceIdentifier, user);
        }
        this.onParticipant({
          user,
          isPresent: value.event?.left ? false : value.event?.joined ? true : undefined,
        });
      }
    }
  }

  private handleState(payload: SyncplayStatePayload, connectionId: number): void {
    const user = payload.playstate.setBy ? decodeSyncplayUser(payload.playstate.setBy) : null;

    if (user?.deviceIdentifier === this.user.deviceIdentifier) {
      return;
    }

    this.lastPing = payload.ping ?? null;

    const fallbackState = {
      isPaused: payload.playstate.paused,
      positionSeconds: payload.playstate.position,
      shouldSeek: false,
    };

    void new Promise<SyncplayStateReply>((resolve, reject) => {
      try {
        resolve(
          this.onPlaybackState({
            user,
            isPaused: payload.playstate.paused,
            positionSeconds: payload.playstate.position,
            shouldSeek: Boolean(payload.playstate.doSeek),
          }),
        );
      } catch (error) {
        reject(error);
      }
    })
      .then((state) => {
        if (this.connectionId !== connectionId) {
          return;
        }

        if (isSkipReply(state)) {
          return;
        }

        this.sendState(state ?? fallbackState);
      })
      .catch((error: unknown) => {
        if (this.connectionId !== connectionId) {
          return;
        }

        this.onError(
          error instanceof Error ? error : new Error("Syncplay playback handler rejected"),
        );
        this.sendState(fallbackState);
      });
  }

  private flushPendingState(): void {
    const pendingState = this.pendingState;
    if (!pendingState) {
      return;
    }

    this.pendingState = null;
    this.sendState(pendingState);
  }

  private send(frame: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(frame));
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSkipReply(value: SyncplayStateReply): value is SyncplaySkipReply {
  return isRecord(value) && value.skipReply === true;
}

function isValidListPayload(
  value: unknown,
  roomId: string,
): value is Record<string, Record<string, SyncplayListUserState>> {
  if (!isRecord(value)) {
    return false;
  }

  const roomUsers = value[roomId];
  if (roomUsers === undefined) {
    return true;
  }

  if (!isRecord(roomUsers)) {
    return false;
  }

  return Object.values(roomUsers).every((state) => {
    if (!isRecord(state)) {
      return false;
    }

    if (
      state.position !== undefined &&
      (typeof state.position !== "number" || !Number.isFinite(state.position))
    ) {
      return false;
    }

    if (
      state.isReady !== undefined &&
      state.isReady !== null &&
      typeof state.isReady !== "boolean"
    ) {
      return false;
    }

    return true;
  });
}

function isValidSetPayload(value: unknown): value is SyncplaySetPayload {
  if (!isRecord(value)) {
    return false;
  }

  const ready = value.ready;
  if (ready !== undefined) {
    if (!isRecord(ready) || typeof ready.username !== "string") {
      return false;
    }

    if (ready.isReady !== null && typeof ready.isReady !== "boolean") {
      return false;
    }
  }

  const user = value.user;
  if (user !== undefined) {
    if (!isRecord(user)) {
      return false;
    }

    for (const state of Object.values(user)) {
      if (!isRecord(state)) {
        return false;
      }

      if (state.room !== undefined && !isRecord(state.room)) {
        return false;
      }

      if (state.event !== undefined && !isRecord(state.event)) {
        return false;
      }

      if (isRecord(state.event)) {
        if (state.event.joined !== undefined && typeof state.event.joined !== "boolean") {
          return false;
        }

        if (state.event.left !== undefined && typeof state.event.left !== "boolean") {
          return false;
        }
      }
    }
  }

  return true;
}

function isValidStatePayload(value: unknown): value is SyncplayStatePayload {
  if (!isRecord(value) || !isRecord(value.playstate)) {
    return false;
  }

  const { playstate } = value;
  if (
    typeof playstate.position !== "number" ||
    !Number.isFinite(playstate.position) ||
    typeof playstate.paused !== "boolean"
  ) {
    return false;
  }

  if (playstate.doSeek !== undefined && typeof playstate.doSeek !== "boolean") {
    return false;
  }

  if (
    playstate.setBy !== undefined &&
    playstate.setBy !== null &&
    typeof playstate.setBy !== "string"
  ) {
    return false;
  }

  if (value.ping !== undefined) {
    if (!isRecord(value.ping)) {
      return false;
    }

    for (const field of [
      value.ping.clientLatencyCalculation,
      value.ping.clientRtt,
      value.ping.serverRtt,
      value.ping.latencyCalculation,
    ]) {
      if (field !== undefined && (typeof field !== "number" || !Number.isFinite(field))) {
        return false;
      }
    }
  }

  return true;
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
