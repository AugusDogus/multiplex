import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";
import {
  SyncplayClient,
  type SyncplayClientOptions,
  type SyncplayParticipantState,
  type SyncplayPlaybackState,
  type SyncplayStateInput,
  type SyncplayUser,
} from "./syncplay-client";

const DEFAULT_SEEK_AHEAD_THRESHOLD_SECONDS = 4;
const DEFAULT_SEEK_BEHIND_THRESHOLD_SECONDS = -1.75;
const DEFAULT_REMOTE_EVENT_SUPPRESSION_MS = 5000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
// A suppressed seek only matches a player 'seeked' within this many seconds of
// the position we asked for, so a genuine user seek isn't mistaken for our own
// remote-apply.
const SUPPRESSED_SEEK_MATCH_SECONDS = 2;
// Retry a remote seek that arrived before media metadata (duration) loaded.
const PENDING_SEEK_RETRY_MS = 250;
const PENDING_SEEK_MAX_MS = 15000;
// On auto-start every participant opens the player while the room's playstate is
// still "paused" (the lobby never played), so the first State pings would pause
// the freshly-autoplaying player and the whole room deadlocks at 0:00. For a
// brief window after connecting we therefore don't let a remote *pause* stop our
// player; our local "playing" then propagates and the room gets going. (The
// official client instead dispatches an explicit play on auto-start.) Remote
// play/seek still apply during this window, and normal pause arbitration resumes
// right after.
const DEFAULT_REMOTE_STARTUP_GRACE_MS = 5000;

export type SyncplaySeekResult = "direct" | "reload" | "none";

export interface SyncplayPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  canPlay: boolean;
  isLoading: boolean;
  error: unknown;
}

export interface SyncplayPlayerAdapter {
  getState: () => SyncplayPlayerState;
  play: () => boolean | Promise<boolean>;
  pause: () => void;
  seek: (positionSeconds: number) => SyncplaySeekResult;
}

export interface SyncplaySessionControllerOptions {
  room: Pick<WatchTogetherRoom, "id" | "syncplayHost" | "syncplayPort" | "sourceUri">;
  user: SyncplayUser;
  player: SyncplayPlayerAdapter;
  onParticipant?: (state: SyncplayParticipantState) => void;
  onClose?: () => void;
  onError?: (error: Event | Error) => void;
  onFatalError?: (error: Error) => void;
  webSocketFactory?: SyncplayClientOptions["webSocketFactory"];
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timeout: ReturnType<typeof setTimeout>) => void;
  seekAheadThresholdSeconds?: number;
  seekBehindThresholdSeconds?: number;
  remoteEventSuppressionMs?: number;
  remoteStartupGraceMs?: number;
  reconnectDelayMs?: number;
}

interface SuppressedPlayPause {
  isPaused: boolean;
  expiresAt: number;
}

interface SuppressedSeek {
  positionSeconds: number;
  expiresAt: number;
}

/**
 * Drives the local media player from a Watch Together room and reports local
 * changes back, using {@link SyncplayClient}'s "ignoring on the fly" handshake
 * for arbitration. This class is a thin bridge: it applies remote play/pause/
 * seek to the player and forwards genuine user actions to the client. Echo/loop
 * prevention for the client's own remote-applies is handled by short-lived
 * suppression entries (a player paused by us must not be re-broadcast as a new
 * local pause).
 */
export class SyncplaySessionController {
  private client: SyncplayClient | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private sawFatalError = false;
  // Programmatic play/pause/seek we triggered while applying remote state; the
  // resulting player events must not be mistaken for fresh user actions. Matched
  // by value (target paused-state / position) so a genuine user action within
  // the window still counts.
  private suppressedPlayPause: SuppressedPlayPause | null = null;
  private suppressedSeek: SuppressedSeek | null = null;
  // When the socket actually opened (0 = not yet). The startup grace is measured
  // from here, not from connect-initiation, so a slow connect can't expire it.
  private connectedAt = 0;
  // A remote seek that arrived before media duration was known, retried until it
  // can be applied.
  private pendingRemoteSeek: SyncplayPlaybackState | null = null;
  private pendingRemoteSeekTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRemoteSeekDeadline = 0;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<SyncplaySessionControllerOptions["setTimeout"]>;
  private readonly clearTimer: NonNullable<SyncplaySessionControllerOptions["clearTimeout"]>;

  constructor(private readonly options: SyncplaySessionControllerOptions) {
    this.now = options.now ?? getDefaultNow;
    this.setTimer = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    this.clearTimer = options.clearTimeout ?? ((timeout) => globalThis.clearTimeout(timeout));
  }

  connect(): void {
    this.disconnectClient();
    this.disposed = false;
    this.sawFatalError = false;
    this.connectedAt = 0;
    this.clearPendingRemoteSeek();
    this.suppressedPlayPause = null;
    this.suppressedSeek = null;
    this.connectClient();
  }

  disconnect(): void {
    this.disposed = true;
    this.disconnectClient();
    this.clearPendingRemoteSeek();
    this.suppressedPlayPause = null;
    this.suppressedSeek = null;
  }

  setReady(isReady: boolean | null): void {
    this.client?.setReady(isReady);
  }

  handleLocalPlaybackChange(isPaused: boolean): void {
    // Ignore the event our own remote-apply just produced (same target state);
    // otherwise claim the user's change (reported on the next State ping).
    const suppressed = this.suppressedPlayPause;
    if (suppressed && this.now() <= suppressed.expiresAt && suppressed.isPaused === isPaused) {
      this.suppressedPlayPause = null;
      return;
    }
    this.client?.markLocalPlayPause();
  }

  handleLocalSeeked(time: number): void {
    // Only suppress a seek to ~the position we asked for, so a genuine user seek
    // within the window still claims the change.
    const suppressed = this.suppressedSeek;
    if (
      suppressed &&
      this.now() <= suppressed.expiresAt &&
      Math.abs(time - suppressed.positionSeconds) <= SUPPRESSED_SEEK_MATCH_SECONDS
    ) {
      this.suppressedSeek = null;
      return;
    }
    this.client?.markLocalSeek();
  }

  private connectClient(): void {
    if (this.disposed) {
      return;
    }

    const client = new SyncplayClient({
      room: this.options.room,
      user: this.options.user,
      onParticipant: this.options.onParticipant,
      getPlaybackState: () => this.getCurrentState(),
      applyRemoteState: (state) => this.applyRemoteState(state),
      // Start the startup grace from the actual socket open, not connect-
      // initiation, so a slow connect can't expire the grace before any State.
      onOpen: () => {
        if (this.client === client) {
          this.connectedAt = this.now();
        }
      },
      webSocketFactory: this.options.webSocketFactory,
      now: this.now,
      onClose: () => {
        if (this.disposed || this.client !== client) {
          return;
        }

        this.client = null;
        this.options.onClose?.();
        if (this.sawFatalError) {
          return;
        }

        this.clearReconnectTimeout();
        this.reconnectTimeout = this.setTimer(
          () => this.connectClient(),
          this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
        );
      },
      onError: (error) => {
        this.options.onError?.(error);
        if (this.disposed || this.client !== client) {
          return;
        }

        const fatalError =
          error instanceof Error && error.message.startsWith("Syncplay protocol error:")
            ? error
            : null;

        if (!fatalError) {
          return;
        }

        this.sawFatalError = true;
        this.client = null;
        this.clearPendingRemoteSeek();
        this.suppressedPlayPause = null;
        this.suppressedSeek = null;
        this.options.onFatalError?.(fatalError);
      },
    });

    client.connect();
    client.setReady(this.options.player.getState().canPlay);
    this.client = client;
  }

  private disconnectClient(): void {
    this.clearReconnectTimeout();
    this.client?.disconnect();
    this.client = null;
  }

  /** Steer the player toward a remote-initiated playstate (fire-and-forget). */
  private applyRemoteState(state: SyncplayPlaybackState): void {
    const playerState = this.options.player.getState();
    if (playerState.error) {
      return;
    }

    const targetPosition = clampRemotePosition(state.positionSeconds, playerState.duration);
    const diffSeconds = playerState.currentTime - targetPosition;
    const shouldSeek =
      state.shouldSeek ||
      diffSeconds >=
        (this.options.seekAheadThresholdSeconds ?? DEFAULT_SEEK_AHEAD_THRESHOLD_SECONDS) ||
      diffSeconds <=
        (this.options.seekBehindThresholdSeconds ?? DEFAULT_SEEK_BEHIND_THRESHOLD_SECONDS);

    if (shouldSeek) {
      if (playerState.duration > 0) {
        this.clearPendingRemoteSeek();
        const result = this.options.player.seek(targetPosition);
        if (result !== "none") {
          this.suppressedSeek = {
            positionSeconds: targetPosition,
            expiresAt: this.now() + this.remoteEventSuppressionMs,
          };
        }
      } else {
        // Metadata (duration) isn't loaded yet; retry shortly so the seek isn't
        // silently dropped (it would otherwise clamp to 0).
        this.schedulePendingRemoteSeek(state);
      }
    } else {
      // A non-seek update supersedes any seek we were waiting to apply.
      this.clearPendingRemoteSeek();
    }

    // During the startup grace we deliberately don't let the stale lobby
    // "paused" stop our autoplay; the local "playing" still reaches the room via
    // the play-claim (markLocalPlayPause), not via this reply, so we keep
    // echoing the server state to avoid a still-in-grace peer overriding a real
    // pause.
    const withinStartupGrace = this.now() - this.connectedAt < this.remoteStartupGraceMs;
    if (state.isPaused && playerState.isPlaying && !withinStartupGrace) {
      this.suppressedPlayPause = {
        isPaused: true,
        expiresAt: this.now() + this.remoteEventSuppressionMs,
      };
      this.options.player.pause();
    } else if (!state.isPaused && !playerState.isPlaying) {
      const suppression = {
        isPaused: false,
        expiresAt: this.now() + this.remoteEventSuppressionMs,
      };
      this.suppressedPlayPause = suppression;
      // Clear the suppression if play() never actually started (returned false
      // or rejected) — but only if a newer remote change hasn't replaced it.
      void Promise.resolve(this.options.player.play()).then(
        (played) => {
          if (!played && this.suppressedPlayPause === suppression) {
            this.suppressedPlayPause = null;
          }
        },
        () => {
          if (this.suppressedPlayPause === suppression) {
            this.suppressedPlayPause = null;
          }
        },
      );
    }
  }

  private schedulePendingRemoteSeek(state: SyncplayPlaybackState): void {
    if (this.pendingRemoteSeek === null) {
      this.pendingRemoteSeekDeadline = this.now() + PENDING_SEEK_MAX_MS;
    }
    this.pendingRemoteSeek = state;
    if (this.pendingRemoteSeekTimer !== null) {
      return;
    }
    this.pendingRemoteSeekTimer = this.setTimer(() => {
      this.pendingRemoteSeekTimer = null;
      const pending = this.pendingRemoteSeek;
      if (this.disposed || !pending) {
        return;
      }
      if (this.now() > this.pendingRemoteSeekDeadline) {
        this.clearPendingRemoteSeek();
        return;
      }
      this.applyRemoteState(pending);
    }, PENDING_SEEK_RETRY_MS);
  }

  private clearPendingRemoteSeek(): void {
    this.pendingRemoteSeek = null;
    if (this.pendingRemoteSeekTimer !== null) {
      this.clearTimer(this.pendingRemoteSeekTimer);
      this.pendingRemoteSeekTimer = null;
    }
  }

  private getCurrentState(): SyncplayStateInput {
    const playerState = this.options.player.getState();
    return {
      isPaused: !playerState.isPlaying || Boolean(playerState.error),
      positionSeconds: playerState.currentTime,
      shouldSeek: false,
    };
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout === null) {
      return;
    }

    this.clearTimer(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }

  private get remoteEventSuppressionMs(): number {
    return this.options.remoteEventSuppressionMs ?? DEFAULT_REMOTE_EVENT_SUPPRESSION_MS;
  }

  private get remoteStartupGraceMs(): number {
    return this.options.remoteStartupGraceMs ?? DEFAULT_REMOTE_STARTUP_GRACE_MS;
  }
}

function clampRemotePosition(positionSeconds: number, duration: number): number {
  if (duration <= 0) {
    return positionSeconds;
  }

  return Math.min(Math.max(positionSeconds, 0), duration);
}

function getDefaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
