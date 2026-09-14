import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";
import { z } from "zod";

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
  /** Participants remembered by a previous socket for reconnect reconciliation. */
  initialParticipants?: Iterable<SyncplayUser>;
  /**
   * Fires on deliberate remote playback actions (see
   * {@link SyncplayRemoteAction}): incoming `doSeek` frames and remote-authored
   * `paused` edges. Never fires for our own actions.
   */
  onRemoteAction?: (action: SyncplayRemoteAction) => void;
  /**
   * Fires on every `State` ping with the room's current playhead. Lets an
   * observer (the lobby) track where the room is, so a late joiner can start at
   * the current position instead of resetting everyone to 0.
   */
  onRoomState?: (state: { paused: boolean; positionSeconds: number }) => void;
  /** Fires when the socket opens (after `Hello` is sent). */
  onOpen?: () => void;
  /**
   * Drive the local player toward a remote-initiated playstate. Only called for
   * drivers (non-observer) and only when the change wasn't made locally and
   * isn't being ignored on-the-fly (see the arbitration in `handleState`).
   */
  applyRemoteState?: (state: SyncplayPlaybackState) => SyncplayRemoteStateApplyResult;
  /** Current local playstate, reported back to the server on each `State` ping. */
  getPlaybackState?: () => SyncplayStateInput | null | undefined;
  onClose?: () => void;
  onError?: (error: Event | Error) => void;
  webSocketFactory?: SyncplayWebSocketFactory;
  /** Wall-clock time in milliseconds since the Unix epoch. */
  now?: () => number;
}

export type SyncplayRemoteStateApplyResult = "applied" | "deferred";

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const PING_MOVING_AVERAGE_WEIGHT = 0.85;
const MAX_PING_ROUND_TRIP_SECONDS = 60;

const finiteNumber = z.number().finite();

const syncplayListUserStateSchema = z.object({
  position: finiteNumber.optional(),
  isReady: z.boolean().nullable().optional(),
  file: z.unknown().optional(),
});

const syncplaySetPayloadSchema = z.object({
  ready: z
    .object({
      username: z.string(),
      isReady: z.boolean().nullable(),
    })
    .optional(),
  user: z
    .record(
      z.object({
        room: z.object({ name: z.string().optional() }).optional(),
        event: z
          .object({
            joined: z.boolean().optional(),
            left: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const syncplayPingStateSchema = z.object({
  clientLatencyCalculation: finiteNumber.optional(),
  clientRtt: finiteNumber.optional(),
  serverRtt: finiteNumber.optional(),
  latencyCalculation: finiteNumber.optional(),
});

const syncplayStatePayloadSchema = z.object({
  ping: syncplayPingStateSchema.optional(),
  playstate: z.object({
    position: finiteNumber,
    paused: z.boolean(),
    doSeek: z.boolean().optional(),
    setBy: z.string().nullable().optional(),
  }),
  ignoringOnTheFly: z
    .object({
      client: finiteNumber.optional(),
      server: finiteNumber.optional(),
    })
    .optional(),
});

const syncplayErrorFrameSchema = z
  .object({ Error: z.unknown() })
  .refine((frame) => Object.hasOwn(frame, "Error"));

const syncplayIncomingFrameSchema = z.union([
  z.object({ Hello: z.object({}).passthrough() }),
  z.object({
    List: z.record(z.record(syncplayListUserStateSchema)),
  }),
  z.object({ Set: syncplaySetPayloadSchema }),
  z.object({ State: syncplayStatePayloadSchema }),
  syncplayErrorFrameSchema,
]);

const encodedSyncplayUserSchema = z.object({
  deviceIdentifier: z.string(),
  deviceName: z.string(),
  userID: z.string().regex(/^\d+$/),
});

type SyncplayIncomingFrame = z.infer<typeof syncplayIncomingFrameSchema>;
type SyncplayListUserState = z.infer<typeof syncplayListUserStateSchema>;
type SyncplaySetPayload = z.infer<typeof syncplaySetPayloadSchema>;
type SyncplayStatePayload = z.infer<typeof syncplayStatePayloadSchema>;
type SyncplayPingState = z.infer<typeof syncplayPingStateSchema>;
type SyncplayOutgoingFrame =
  | {
      Hello: {
        room: { name: string };
        username: string;
        version: string;
      };
    }
  | { Set: { ready: { isReady: boolean | null } } }
  | { Set: { file: { name: string } } }
  | {
      State: {
        ping: {
          clientLatencyCalculation: number;
          clientRtt: number;
          serverRtt: number;
          latencyCalculation: number;
        };
        playstate: {
          doSeek: boolean;
          paused: boolean;
          position: number;
          setBy: string | null;
        };
        ignoringOnTheFly: { client: number; server: number };
      };
    }
  | { List: Record<string, never> };

export class SyncplayClient {
  private socket: SyncplayWebSocketLike | null = null;
  private readonly room: SyncplayClientOptions["room"];
  private readonly user: SyncplayUser;
  private readonly onParticipant: NonNullable<SyncplayClientOptions["onParticipant"]>;
  private readonly onRemoteAction: NonNullable<SyncplayClientOptions["onRemoteAction"]>;
  private readonly onRoomState: NonNullable<SyncplayClientOptions["onRoomState"]>;
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
  private roundTripSeconds = 0;
  private averageRoundTripSeconds = 0;
  private forwardDelaySeconds = 0;
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
  // Remember which actions the current client counter represents. Plex can
  // interrupt that claim with a server relay before acknowledging it; those
  // actions must then be queued again instead of being lost.
  private claimedPlayPause = false;
  private claimedSeek = false;
  // `setBy` survives reconnects and may name this persisted device even when
  // the current connection did not author the room state. Only claims made by
  // this connection are safe to treat as self-authored.
  private hasAuthoredState = false;
  // Room paused value from the previous State frame, for remote pause/resume
  // edge detection (null = no frame yet this connection, so the first frame is
  // a baseline, not an action).
  private lastFramePaused: boolean | null = null;
  // Whether the room has reached playback yet this connection. The first
  // transition into playing is the session auto-starting (everyone leaving the
  // lobby's paused baseline), not a deliberate "resume", so it must not surface
  // as a remote action.
  private hasReachedPlaying = false;

  constructor(options: SyncplayClientOptions) {
    this.room = options.room;
    this.user = options.user;
    this.onParticipant = options.onParticipant ?? (() => undefined);
    this.onRemoteAction = options.onRemoteAction ?? (() => undefined);
    this.onRoomState = options.onRoomState ?? (() => undefined);
    this.onOpen = options.onOpen ?? (() => undefined);
    this.applyRemoteState = options.applyRemoteState ?? (() => "deferred");
    this.getPlaybackState = options.getPlaybackState ?? (() => undefined);
    this.onClose = options.onClose ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
    this.webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
    this.now = options.now ?? getDefaultNow;
    this.observer = options.observer ?? false;
    for (const participant of options.initialParticipants ?? []) {
      this.knownParticipants.set(participant.deviceIdentifier, participant);
    }
  }

  connect(): void {
    this.disconnect();

    this.ignoringClient = 0;
    this.ignoringServer = 0;
    this.roundTripSeconds = 0;
    this.averageRoundTripSeconds = 0;
    this.forwardDelaySeconds = 0;
    this.lastPing = null;
    this.pendingPlayPause = false;
    this.pendingSeek = false;
    this.claimedPlayPause = false;
    this.claimedSeek = false;
    this.hasAuthoredState = false;
    this.lastFramePaused = null;
    this.hasReachedPlaying = false;
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
          clientRtt: this.roundTripSeconds,
          serverRtt: this.lastPing?.serverRtt ?? 0,
          latencyCalculation: this.lastPing?.latencyCalculation ?? 0,
        },
        playstate: {
          doSeek: state.shouldSeek ?? false,
          paused: state.isPaused,
          position: state.positionSeconds,
          // Plex Web leaves authorship empty on client claims. Syncplay assigns
          // `setBy` from the connection identity when it accepts the raised
          // client counter, then relays that authoritative value to the room.
          setBy: null,
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
      const parsed = syncplayIncomingFrameSchema.safeParse(JSON.parse(event.data));
      if (!parsed.success) {
        this.onError(new Error("Invalid syncplay frame"));
        return;
      }
      frame = parsed.data;
    } catch {
      this.onError(new Error("Invalid syncplay frame"));
      return;
    }

    if ("Error" in frame) {
      this.onError(new Error(`Syncplay protocol error: ${JSON.stringify(frame.Error)}`));
      this.disconnect({ notify: true });
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
        // A ready update can only be emitted by a connected room member. Plex's
        // Syncplay service does not consistently precede it with a joined/List
        // frame, so it is also authoritative presence evidence.
        this.onParticipant({
          user,
          isPresent: true,
          isReady: payload.ready.isReady,
        });
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
    this.updatePing(payload.ping);
    const roomPositionSeconds = payload.playstate.paused
      ? payload.playstate.position
      : payload.playstate.position + this.forwardDelaySeconds;
    this.onRoomState({
      paused: payload.playstate.paused,
      positionSeconds: roomPositionSeconds,
    });

    // Mirror the server's "ignoring on the fly" counter for this message, then
    // decide whether we're echoing (observer, or deferring while the server
    // relays someone else's change).
    this.ignoringServer =
      (payload.ignoringOnTheFly?.server ?? 0) > 0 ? payload.ignoringOnTheFly!.server! : 0;
    const shouldEcho = this.observer || this.ignoringServer > 0;

    // The server echoes our `client` counter back once it has processed our
    // change. A server relay can interrupt an unacknowledged claim, in which
    // case preserve its actions so they can be claimed again afterward.
    const ackedClient =
      (payload.ignoringOnTheFly?.client ?? 0) > 0 ? payload.ignoringOnTheFly!.client! : 0;
    const hadInFlightLocalClaim = this.ignoringClient > 0;
    if (hadInFlightLocalClaim && ackedClient === this.ignoringClient) {
      this.claimedPlayPause = false;
      this.claimedSeek = false;
      this.ignoringClient = 0;
    } else if (shouldEcho && hadInFlightLocalClaim) {
      this.pendingPlayPause ||= this.claimedPlayPause;
      this.pendingSeek ||= this.claimedSeek;
      this.claimedPlayPause = false;
      this.claimedSeek = false;
      this.ignoringClient = 0;
    }
    // A fresh local change raises the counter so the server arbitrates it and
    // peers defer to it. If another local action arrives while a claim is
    // already in flight, retain it until that claim is acknowledged. Reusing
    // the same counter would let the server discard a rapid final seek as a
    // duplicate, then restore the older room position.
    const hasPendingLocalChange = this.pendingPlayPause || this.pendingSeek;
    const startedLocalClaim = !shouldEcho && hasPendingLocalChange && this.ignoringClient === 0;
    if (startedLocalClaim) {
      this.ignoringClient += 1;
      this.claimedPlayPause = this.pendingPlayPause;
      this.claimedSeek = this.pendingSeek;
      this.hasAuthoredState = true;
    }

    // Apply the authoritative server playstate unless a local change is still
    // in flight (which would otherwise be clobbered). This also reconciles an
    // acknowledged self-authored state when the local media transport failed
    // to follow its own command. Observers never drive a player.
    const setByUser = payload.playstate.setBy ? decodeSyncplayUser(payload.playstate.setBy) : null;
    const isSameDevice = setByUser?.deviceIdentifier === this.user.deviceIdentifier;
    const isSelfAuthored = isSameDevice && this.hasAuthoredState;

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
    const isFirstStateFrame = this.lastFramePaused === null;
    // The session's first move into playing is the auto-start, not a resume;
    // only announce resumes once the room has actually been playing.
    const reachedPlayingBefore = this.hasReachedPlaying;
    if (!framePaused) {
      this.hasReachedPlaying = true;
    }
    const protectsLocalChange = this.ignoringClient !== 0 || hasPendingLocalChange;
    const appliesServerState = !this.observer && !protectsLocalChange;
    if (appliesServerState) {
      if (!isSameDevice && payload.playstate.doSeek) {
        this.onRemoteAction({
          type: "seek",
          user: setByUser,
          positionSeconds: roomPositionSeconds,
        });
      }
      if (!isSameDevice && this.lastFramePaused !== null && framePaused !== this.lastFramePaused) {
        if (framePaused) {
          this.onRemoteAction({
            type: "pause",
            user: setByUser,
            positionSeconds: roomPositionSeconds,
          });
        } else if (reachedPlayingBefore) {
          this.onRemoteAction({
            type: "resume",
            user: setByUser,
            positionSeconds: roomPositionSeconds,
          });
        }
      }
    }
    this.lastFramePaused = framePaused;
    let didApplyServerState = false;
    if (appliesServerState) {
      try {
        const applyResult = this.applyRemoteState({
          user: setByUser,
          isPaused: payload.playstate.paused,
          positionSeconds: roomPositionSeconds,
          // A self-authored seek is already in flight locally. Replaying its
          // doSeek acknowledgment would replace the same transcode twice, but
          // the accepted room playstate and position can still repair a local
          // transport that failed to resume after replacement.
          shouldSeek: !isSelfAuthored && Boolean(payload.playstate.doSeek),
        });
        didApplyServerState = applyResult === "applied";
      } catch (error) {
        // Applying playback state is best-effort while a media element is
        // loading. Keep the room authoritative when it fails: echoing the
        // remote state prevents this temporarily unready player from resetting
        // every participant to its stale local sample. The next State heartbeat
        // retries the apply.
        this.onError(
          error instanceof Error ? error : new Error("Syncplay applyRemoteState handler threw"),
        );
      }
    }

    if (this.connectionId !== connectionId) {
      return;
    }

    // Always reply (heartbeat). Drivers report their actual player position,
    // matching Plex Web, so the room clock stays tied to media playback rather
    // than recursively echoing a slightly stale server timestamp. Observers,
    // server-relay deferrals, and failed/unavailable player applies still echo
    // the authoritative server state.
    let reply: SyncplayStateInput;
    const localState = this.getPlaybackState();
    const adoptedStickySelfState =
      appliesServerState && isFirstStateFrame && isSameDevice && !this.hasAuthoredState;
    if (
      shouldEcho ||
      adoptedStickySelfState ||
      (appliesServerState && !didApplyServerState) ||
      localState === null ||
      localState === undefined
    ) {
      reply = {
        isPaused: payload.playstate.paused,
        positionSeconds: payload.playstate.position,
        shouldSeek: false,
      };
    } else {
      reply = {
        isPaused: localState.isPaused,
        positionSeconds: localState.positionSeconds,
        shouldSeek: startedLocalClaim && this.pendingSeek,
      };
    }
    // Only drop pending actions when this frame started a new claim. Echo
    // frames and heartbeats for an older in-flight claim cannot author the new
    // action, so keep the latest local state queued for the acknowledgment.
    if (startedLocalClaim) {
      this.pendingPlayPause = false;
      this.pendingSeek = false;
    }
    this.sendState(reply);
  }

  private updatePing(ping: SyncplayPingState | undefined): void {
    const timestamp = ping?.clientLatencyCalculation;
    const senderRoundTrip = ping?.serverRtt;
    if (
      timestamp === undefined ||
      senderRoundTrip === undefined ||
      timestamp <= 0 ||
      senderRoundTrip < 0
    ) {
      return;
    }

    const roundTrip = this.now() / 1000 - timestamp;
    if (!Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > MAX_PING_ROUND_TRIP_SECONDS) {
      return;
    }

    this.roundTripSeconds = roundTrip;
    this.averageRoundTripSeconds =
      this.averageRoundTripSeconds === 0
        ? roundTrip
        : this.averageRoundTripSeconds * PING_MOVING_AVERAGE_WEIGHT +
          roundTrip * (1 - PING_MOVING_AVERAGE_WEIGHT);
    this.forwardDelaySeconds =
      senderRoundTrip < roundTrip
        ? this.averageRoundTripSeconds / 2 + (roundTrip - senderRoundTrip)
        : this.averageRoundTripSeconds / 2;
  }

  private flushPendingState(): void {
    const pendingState = this.pendingState;
    if (!pendingState) {
      return;
    }

    this.pendingState = null;
    this.sendState(pendingState);
  }

  private send(frame: SyncplayOutgoingFrame): boolean {
    if (this.socket?.readyState !== SOCKET_OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(frame));
    return true;
  }
}

function createDefaultWebSocket(url: string): SyncplayWebSocketLike {
  if (!("WebSocket" in globalThis)) {
    throw new Error("SyncplayClient requires a WebSocket implementation");
  }

  return new globalThis.WebSocket(url);
}

function getDefaultNow(): number {
  return Date.now();
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
    const parsed = encodedSyncplayUserSchema.safeParse(JSON.parse(value.replace(/_+$/, "")));
    if (!parsed.success) {
      return null;
    }

    return {
      id: Number.parseInt(parsed.data.userID, 10),
      deviceIdentifier: parsed.data.deviceIdentifier,
      deviceName: parsed.data.deviceName,
    };
  } catch {
    return null;
  }
}
