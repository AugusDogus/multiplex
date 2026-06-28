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

interface SuppressedEvent {
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
  // resulting player events must not be mistaken for fresh user actions.
  private suppressedPlayPause: SuppressedEvent | null = null;
  private suppressedSeek: SuppressedEvent | null = null;
  private connectedAt = 0;
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
    this.suppressedPlayPause = null;
    this.suppressedSeek = null;
    this.connectClient();
  }

  disconnect(): void {
    this.disposed = true;
    this.disconnectClient();
    this.suppressedPlayPause = null;
    this.suppressedSeek = null;
  }

  setReady(isReady: boolean | null): void {
    this.client?.setReady(isReady);
  }

  handleLocalPlaybackChange(_isPaused: boolean): void {
    // Ignore the event our own remote-apply just produced; otherwise claim the
    // user's change (reported on the next State ping, like the official client).
    if (this.consume("suppressedPlayPause")) {
      return;
    }
    this.client?.markLocalPlayPause();
  }

  handleLocalSeeked(_time: number): void {
    if (this.consume("suppressedSeek")) {
      return;
    }
    this.client?.markLocalSeek();
  }

  private connectClient(): void {
    if (this.disposed) {
      return;
    }

    this.connectedAt = this.now();
    const client = new SyncplayClient({
      room: this.options.room,
      user: this.options.user,
      onParticipant: this.options.onParticipant,
      getPlaybackState: () => this.getCurrentState(),
      applyRemoteState: (state) => this.applyRemoteState(state),
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

    if (shouldSeek && playerState.duration > 0) {
      const result = this.options.player.seek(targetPosition);
      if (result !== "none") {
        this.suppress("suppressedSeek");
      }
    }

    const withinStartupGrace =
      this.now() - this.connectedAt < this.remoteStartupGraceMs;
    if (state.isPaused && playerState.isPlaying && !withinStartupGrace) {
      this.suppress("suppressedPlayPause");
      this.options.player.pause();
    } else if (!state.isPaused && !playerState.isPlaying) {
      this.suppress("suppressedPlayPause");
      void Promise.resolve(this.options.player.play()).then((played) => {
        if (!played) {
          // Playback couldn't start (e.g. autoplay/transcode hiccup); drop the
          // suppression so a later genuine play is still reported.
          this.suppressedPlayPause = null;
        }
      });
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

  private suppress(key: "suppressedPlayPause" | "suppressedSeek"): void {
    this[key] = {
      expiresAt: this.now() + this.remoteEventSuppressionMs,
    };
  }

  private consume(key: "suppressedPlayPause" | "suppressedSeek"): boolean {
    const event = this[key];
    if (event && this.now() <= event.expiresAt) {
      this[key] = null;
      return true;
    }
    if (event) {
      this[key] = null;
    }
    return false;
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
