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

export type SyncplayRemoteActionType = "pause" | "resume" | "seek";

/**
 * A deliberate playback action by a remote participant: an incoming `State`
 * frame authored by them (`setBy`) whose `paused` value changed, or one
 * carrying `doSeek`. This mirrors when the official Plex client shows its
 * "<user> paused/resumed/seeked" notifications. `setBy` is sticky — the server
 * repeats it on every subsequent ping — so only edges count, and the first
 * frame after connecting only establishes the baseline.
 */
export interface SyncplayRemoteAction {
  type: SyncplayRemoteActionType;
  user: SyncplayUser | null;
  positionSeconds: number;
}

export interface SyncplayWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: (event: Event) => void): void;
}

export type SyncplayWebSocketFactory = (url: string) => SyncplayWebSocketLike;

export interface SyncplayStateInput {
  isPaused: boolean;
  positionSeconds: number;
  shouldSeek?: boolean;
}

export interface SyncplayClientOptions {
  room: Pick<WatchTogetherRoom, "id" | "syncplayHost" | "syncplayPort" | "sourceUri">;
  user: SyncplayUser;
  /**
   * Presence/observer mode for the lobby ("echo" mode in Syncplay terms): this
   * client has no player to drive, so on every server `State` ping it replies by
   * echoing the server's own playstate. That heartbeat keeps the server treating
   * it as an active member (so it stays listed for everyone else) without ever
   * changing the shared position/pause. Drivers (the media player) leave this off.
   */
  observer?: boolean;
  onParticipant?: (state: SyncplayParticipantState) => void;
  /**
   * Fires on deliberate remote playback actions (see
   * {@link SyncplayRemoteAction}): incoming `doSeek` frames and remote-authored
   * `paused` edges. Never fires for our own actions.
   */
  onRemoteAction?: (action: SyncplayRemoteAction) => void;
  /** Fires when the socket opens (after `Hello` is sent). */
  onOpen?: () => void;
  /**
   * Drive the local player toward a remote-initiated playstate. Only called for
   * drivers (non-observer) and only when the change wasn't made locally and
   * isn't being ignored on-the-fly (see the arbitration in `handleState`).
   */
  applyRemoteState?: (state: SyncplayPlaybackState) => void;
  /** Current local playstate, reported back to the server on each `State` ping. */
  getPlaybackState?: () => SyncplayStateInput | null | undefined;
  onClose?: () => void;
  onError?: (error: Event | Error) => void;
  webSocketFactory?: SyncplayWebSocketFactory;
  now?: () => number;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

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
  ignoringOnTheFly?: {
    client?: number;
    server?: number;
  };
}

interface SyncplayPingState {
  clientLatencyCalculation?: number;
  clientRtt?: number;
  serverRtt?: number;
  latencyCalculation?: number;
}

export class SyncplayClient {
  private socket: SyncplayWebSocketLike | null = null;
  private readonly room: SyncplayClientOptions["room"];
  private readonly user: SyncplayUser;
  private readonly onParticipant: NonNullable<SyncplayClientOptions["onParticipant"]>;
  private readonly onRemoteAction: NonNullable<SyncplayClientOptions["onRemoteAction"]>;
  private readonly onOpen: NonNullable<SyncplayClientOptions["onOpen"]>;
  private readonly applyRemoteState: NonNullable<SyncplayClientOptions["applyRemoteState"]>;
  private readonly getPlaybackState: NonNullable<SyncplayClientOptions["getPlaybackState"]>;
  private readonly onClose: NonNullable<SyncplayClientOptions["onClose"]>;
  private readonly onError: NonNullable<SyncplayClientOptions["onError"]>;
  private readonly webSocketFactory: SyncplayWebSocketFactory;
  private readonly now: NonNullable<SyncplayClientOptions["now"]>;
  private readonly observer: boolean;
  private requestedReady: boolean | null | undefined;
  private lastPing: SyncplayPingState | null = null;
  private pendingState: SyncplayStateInput | null = null;
  private readonly knownParticipants = new Map<string, SyncplayUser>();
  private connectionId = 0;
  // Syncplay's "ignoring on the fly" handshake — the arbitration that stops a
  // peer's in-flight playstate from clobbering a local pause/seek. `client` is
  // raised while one of our own changes is awaiting server acknowledgement;
  // `server` mirrors the server while it is relaying someone else's change.
  private ignoringClient = 0;
  private ignoringServer = 0;
  // Flags set when the local user pauses/plays/seeks, so the next `State` reply
  // claims the change (and bumps `ignoringClient`).
  private pendingPlayPause = false;
  private pendingSeek = false;
  // Room paused value from the previous State frame, for remote pause/resume
  // edge detection (null = no frame yet this connection, so the first frame is
  // a baseline, not an action).
  private lastFramePaused: boolean | null = null;

  constructor(options: SyncplayClientOptions) {
    this.room = options.room;
    this.user = options.user;
    this.onParticipant = options.onParticipant ?? (() => undefined);
    this.onRemoteAction = options.onRemoteAction ?? (() => undefined);
    this.onOpen = options.onOpen ?? (() => undefined);
    this.applyRemoteState = options.applyRemoteState ?? (() => undefined);
    this.getPlaybackState = options.getPlaybackState ?? (() => undefined);
    this.onClose = options.onClose ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
    this.webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
    this.now = options.now ?? getDefaultNow;
    this.observer = options.observer ?? false;
  }

  connect(): void {
    this.disconnect();

    this.ignoringClient = 0;
    this.ignoringServer = 0;
    this.pendingPlayPause = false;
    this.pendingSeek = false;
    this.lastFramePaused = null;
    this.connectionId += 1;
    const connectionId = this.connectionId;
    const socket = this.webSocketFactory(
      `wss://${this.room.syncplayHost}:${this.room.syncplayPort}/ws`,
    );
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
      this.onOpen();
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

  /**
   * Record that the local user toggled play/pause. The change is claimed on the
   * next `State` exchange, which raises `ignoringClient` so the server arbitrates
   * it and other clients defer to it.
   */
  markLocalPlayPause(): void {
    this.pendingPlayPause = true;
  }

  /** Record that the local user seeked; reported with `doSeek` on the next reply. */
  markLocalSeek(): void {
    this.pendingSeek = true;
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
          clientLatencyCalculation: this.now() / 1000,
          clientRtt: this.lastPing?.clientRtt ?? 0,
          serverRtt: this.lastPing?.serverRtt ?? 0,
          latencyCalculation: this.lastPing?.latencyCalculation ?? 0,
        },
        playstate: {
          doSeek: state.shouldSeek ?? false,
          paused: state.isPaused,
          position: state.positionSeconds,
          // Claim authorship while a local change is in flight so the server
          // attributes it to us and relays it to the room.
          setBy: this.ignoringClient > 0 ? encodeSyncplayUser(this.user) : null,
        },
        ignoringOnTheFly: {
          client: this.ignoringClient,
          server: this.ignoringServer,
        },
      },
    };

    if (!this.send(frame) && this.socket?.readyState === SOCKET_CONNECTING) {
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
        if (value.room?.name !== undefined && value.room.name !== this.room.id) {
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
    this.lastPing = payload.ping ?? null;

    // Mirror the server's "ignoring on the fly" counter for this message, then
    // decide whether we're echoing (observer, or deferring while the server
    // relays someone else's change).
    this.ignoringServer =
      (payload.ignoringOnTheFly?.server ?? 0) > 0 ? payload.ignoringOnTheFly!.server! : 0;
    const shouldEcho = this.observer || this.ignoringServer > 0;

    // The server echoes our `client` counter back once it has processed our
    // change; matching it (or entering echo mode) clears the in-flight state.
    const ackedClient =
      (payload.ignoringOnTheFly?.client ?? 0) > 0 ? payload.ignoringOnTheFly!.client! : 0;
    if (shouldEcho || ackedClient === this.ignoringClient) {
      this.ignoringClient = 0;
    }
    // A fresh local change (claimed below) raises the counter so the server
    // arbitrates it and peers defer to it.
    if (!shouldEcho && (this.pendingPlayPause || this.pendingSeek)) {
      this.ignoringClient += 1;
    }

    // Apply the remote playstate to our player unless we made it ourselves or a
    // local change of ours is still in flight (which would otherwise be clobbered).
    // Applies whether or not we're echoing — echoing only changes the reply, not
    // whether a peer's change reaches our player. (Observers pass no
    // `applyRemoteState`, so this is a no-op there.)
    const setByUser = payload.playstate.setBy ? decodeSyncplayUser(payload.playstate.setBy) : null;
    const isSelf = setByUser?.deviceIdentifier === this.user.deviceIdentifier;

    // Deliberate remote actions live on the frames themselves: a `doSeek`
    // frame is a seek, and a change in the room's `paused` value is a
    // pause/resume by whoever `setBy` names (the official Plex client keys its
    // "<user> paused/resumed/seeked" notifications off exactly this). `setBy`
    // is sticky across pings, so only edges count — a repeated frame with the
    // same `paused` value is a heartbeat, not a new action.
    //
    // Only surface actions we actually adopt: while a local change of ours is
    // in flight (`ignoringClient !== 0`) the peer's change is not applied to
    // our player, so announcing it would show "Alice paused" while our player
    // ignores it. Still track `lastFramePaused` so a swallowed edge doesn't
    // leave a stale baseline that misfires later.
    const framePaused = payload.playstate.paused;
    const appliedRemote = !isSelf && this.ignoringClient === 0;
    if (appliedRemote) {
      if (payload.playstate.doSeek) {
        this.onRemoteAction({
          type: "seek",
          user: setByUser,
          positionSeconds: payload.playstate.position,
        });
      }
      if (this.lastFramePaused !== null && framePaused !== this.lastFramePaused) {
        this.onRemoteAction({
          type: framePaused ? "pause" : "resume",
          user: setByUser,
          positionSeconds: payload.playstate.position,
        });
      }
    }
    this.lastFramePaused = framePaused;
    let didApplyRemote = appliedRemote;
    if (didApplyRemote) {
      try {
        this.applyRemoteState({
          user: setByUser,
          isPaused: payload.playstate.paused,
          positionSeconds: payload.playstate.position,
          shouldSeek: Boolean(payload.playstate.doSeek),
        });
      } catch (error) {
        // The apply failed, so the local player didn't actually adopt the remote
        // state — report our real state below instead of echoing one we never
        // applied. Never let the error abort the reply; the socket must keep
        // replying to stay in the session.
        didApplyRemote = false;
        this.onError(
          error instanceof Error ? error : new Error("Syncplay applyRemoteState handler threw"),
        );
      }
    }

    if (this.connectionId !== connectionId) {
      return;
    }

    // Always reply (heartbeat). Echo the server's state when we adopted a remote
    // change (not a stale pre-apply sample) or while deferring; otherwise report
    // our own player's state, claiming a pending local seek via `doSeek`.
    let reply: SyncplayStateInput;
    if (shouldEcho || didApplyRemote) {
      reply = {
        isPaused: payload.playstate.paused,
        positionSeconds: payload.playstate.position,
        shouldSeek: false,
      };
    } else {
      reply = this.buildLocalReply();
    }
    // Only drop the pending flags once we had the chance to claim them (a
    // non-echo reply). While echoing (the server is relaying another client's
    // change) we couldn't claim, so carry them forward to the next non-echo
    // reply instead of silently losing the local change.
    if (!shouldEcho) {
      this.pendingPlayPause = false;
      this.pendingSeek = false;
    }
    this.sendState(reply);
  }

  private buildLocalReply(): SyncplayStateInput {
    const local = this.getPlaybackState();
    return {
      isPaused: local?.isPaused ?? true,
      positionSeconds: local?.positionSeconds ?? 0,
      shouldSeek: this.pendingSeek,
    };
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
    if (this.socket?.readyState !== SOCKET_OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(frame));
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createDefaultWebSocket(url: string): SyncplayWebSocketLike {
  if (!("WebSocket" in globalThis)) {
    throw new Error("SyncplayClient requires a WebSocket implementation");
  }

  return new globalThis.WebSocket(url);
}

function getDefaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
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

  // Validate the arbitration counters: a non-number here (e.g. "1") would slip
  // through and corrupt the ignoring-on-the-fly handshake.
  if (value.ignoringOnTheFly !== undefined) {
    if (!isRecord(value.ignoringOnTheFly)) {
      return false;
    }
    for (const field of [value.ignoringOnTheFly.client, value.ignoringOnTheFly.server]) {
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
