import type { WatchTogetherRoom } from "../schemas/watch-together-schemas";
import {
  SKIP_SYNCPLAY_REPLY,
  SyncplayClient,
  type SyncplayClientOptions,
  type SyncplayParticipantState,
  type SyncplayPlaybackState,
  type SyncplayStateInput,
  type SyncplayStateReply,
  type SyncplayUser,
} from "./syncplay-client";

const DEFAULT_SEEK_AHEAD_THRESHOLD_SECONDS = 4;
const DEFAULT_SEEK_BEHIND_THRESHOLD_SECONDS = -1.75;
const DEFAULT_REMOTE_STATE_SETTLE_INTERVAL_MS = 25;
const DEFAULT_REMOTE_SEEK_SUPPRESSION_MS = 5000;
const DEFAULT_REMOTE_PLAYBACK_SUPPRESSION_MS = 750;
const DEFAULT_REMOTE_STATE_APPLY_TIMEOUT_MS = 5000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;

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
  remoteStateSettleIntervalMs?: number;
  remoteSeekSuppressionMs?: number;
  remotePlaybackSuppressionMs?: number;
  remoteStateApplyTimeoutMs?: number;
  reconnectDelayMs?: number;
}

interface SuppressedPlaybackEvent {
  id: number;
  isPaused: boolean;
  expiresAt: number;
}

interface SuppressedSeekEvent {
  positionSeconds: number;
  expiresAt: number;
  mode: SyncplaySeekResult;
  settled: Promise<void>;
  resolve: () => void;
}

interface RemoteApplyResult {
  status: "applied" | "pending";
  shouldSeek: boolean;
  targetPosition: number;
  seekMode?: SyncplaySeekResult;
  seekSettled?: Promise<void>;
  playSettled?: Promise<boolean>;
}

export class SyncplaySessionController {
  private client: SyncplayClient | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private sawFatalError = false;
  private suppressedPlaybackEventId = 0;
  private suppressedPlaybackEvents: SuppressedPlaybackEvent[] = [];
  private suppressedSeek: SuppressedSeekEvent | null = null;
  private remoteStateGeneration = 0;
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
    this.connectClient();
  }

  disconnect(): void {
    this.disposed = true;
    this.disconnectClient();
    this.remoteStateGeneration += 1;
    this.suppressedPlaybackEvents = [];
    this.suppressedSeek = null;
  }

  setReady(isReady: boolean | null): void {
    this.client?.setReady(isReady);
  }

  handleLocalPlaybackChange(isPaused: boolean): void {
    this.sendLocalState({ isPaused });
  }

  handleLocalSeeked(time: number): void {
    const suppressedSeek = this.suppressedSeek;
    if (
      suppressedSeek &&
      this.now() <= suppressedSeek.expiresAt &&
      Math.abs(time - suppressedSeek.positionSeconds) < 0.75
    ) {
      suppressedSeek.resolve();
      this.suppressedSeek = null;
      return;
    }

    if (suppressedSeek && this.now() > suppressedSeek.expiresAt) {
      this.suppressedSeek = null;
    }

    this.sendLocalState({
      isPaused: !this.options.player.getState().isPlaying,
      shouldSeek: true,
      time,
    });
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
      webSocketFactory: this.options.webSocketFactory,
      now: this.now,
      onPlaybackState: async (state) => {
        const generation = ++this.remoteStateGeneration;
        const result = this.applyRemotePlaybackState(state);
        return result.status === "pending"
          ? this.waitForDurationThenApplyRemoteState(state, generation)
          : this.waitForRemoteStateToSettle(state, result, generation);
      },
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
        this.suppressedPlaybackEvents = [];
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

  private applyRemotePlaybackState(state: SyncplayPlaybackState): RemoteApplyResult {
    const playerState = this.options.player.getState();
    const targetPosition = clampRemotePosition(state.positionSeconds, playerState.duration);
    const diffSeconds = playerState.currentTime - targetPosition;
    const shouldSeek =
      state.shouldSeek ||
      diffSeconds >=
        (this.options.seekAheadThresholdSeconds ?? DEFAULT_SEEK_AHEAD_THRESHOLD_SECONDS) ||
      diffSeconds <=
        (this.options.seekBehindThresholdSeconds ?? DEFAULT_SEEK_BEHIND_THRESHOLD_SECONDS);

    if (shouldSeek && playerState.duration <= 0) {
      return { status: "pending", shouldSeek, targetPosition };
    }

    let seekMode: SyncplaySeekResult | undefined;
    let seekSettled: Promise<void> | undefined;
    if (shouldSeek) {
      seekMode = this.options.player.seek(targetPosition);
      if (seekMode === "none") {
        return { status: "pending", shouldSeek, targetPosition };
      }
      seekSettled = this.createSuppressedSeekEvent(targetPosition, seekMode).settled;
    }

    let playSettled: Promise<boolean> | undefined;
    if (state.isPaused && playerState.isPlaying) {
      this.addSuppressedPlaybackEvent(true);
      this.options.player.pause();
    } else if (!state.isPaused && !playerState.isPlaying) {
      const suppressedEventId = this.addSuppressedPlaybackEvent(false);
      playSettled = Promise.resolve(this.options.player.play()).then(
        (played) => {
          if (!played) {
            this.removeSuppressedPlaybackEvent(suppressedEventId);
          }
          return played;
        },
        () => {
          this.removeSuppressedPlaybackEvent(suppressedEventId);
          return false;
        },
      );
    }

    return {
      status: "applied",
      shouldSeek,
      targetPosition,
      seekMode,
      seekSettled,
      playSettled,
    };
  }

  private async waitForRemoteStateToSettle(
    state: SyncplayPlaybackState,
    applyResult: RemoteApplyResult,
    generation: number,
  ): Promise<SyncplayStateReply> {
    const deadline = this.now() + this.remoteStateApplyTimeoutMs;
    let directSeekSettled = applyResult.seekMode !== "direct";
    if (applyResult.seekMode === "direct" && applyResult.seekSettled) {
      void applyResult.seekSettled.then(() => {
        directSeekSettled = true;
      });
    }

    let playSettled = !applyResult.playSettled;
    let playSucceeded = true;
    if (applyResult.playSettled) {
      void applyResult.playSettled.then((played) => {
        playSettled = true;
        playSucceeded = played;
      });
    }

    while (this.remoteStateGeneration === generation) {
      const playerState = this.options.player.getState();
      if (playerState.error) {
        return this.getCurrentState();
      }

      const playbackSettled = playerState.isPlaying !== state.isPaused;
      const positionSettled =
        !applyResult.shouldSeek ||
        ((applyResult.seekMode !== "direct" || directSeekSettled) &&
          Math.abs(playerState.currentTime - applyResult.targetPosition) < 0.75 &&
          (applyResult.seekMode !== "reload" || (playerState.canPlay && !playerState.isLoading)));

      if (playbackSettled && positionSettled) {
        break;
      }

      if (this.now() >= deadline || (!state.isPaused && playSettled && !playSucceeded)) {
        return this.getCurrentState();
      }

      await this.wait(this.remoteStateSettleIntervalMs);
    }

    return SKIP_SYNCPLAY_REPLY;
  }

  private async waitForDurationThenApplyRemoteState(
    state: SyncplayPlaybackState,
    generation: number,
  ): Promise<SyncplayStateReply> {
    const deadline = this.now() + this.remoteStateApplyTimeoutMs;
    while (this.remoteStateGeneration === generation) {
      const playerState = this.options.player.getState();
      if (playerState.error) {
        return this.getCurrentState();
      }

      if (playerState.duration > 0) {
        const applyResult = this.applyRemotePlaybackState(state);
        if (applyResult.status === "pending") {
          return this.getCurrentState();
        }
        return this.waitForRemoteStateToSettle(state, applyResult, generation);
      }

      if (this.now() >= deadline) {
        return this.getCurrentState();
      }

      await this.wait(this.remoteStateSettleIntervalMs);
    }

    return SKIP_SYNCPLAY_REPLY;
  }

  private sendLocalState(nextState: {
    isPaused: boolean;
    shouldSeek?: boolean;
    time?: number;
  }): void {
    if (!this.client) {
      return;
    }

    const now = this.now();
    this.suppressedPlaybackEvents = this.suppressedPlaybackEvents.filter(
      (event) => event.expiresAt >= now,
    );
    const suppressedPlaybackIndex = this.suppressedPlaybackEvents.findIndex(
      (event) => event.isPaused === nextState.isPaused,
    );

    if (suppressedPlaybackIndex >= 0) {
      this.suppressedPlaybackEvents.splice(suppressedPlaybackIndex, 1);
      return;
    }

    const playerState = this.options.player.getState();
    this.client.sendState({
      isPaused: nextState.isPaused,
      positionSeconds: nextState.time ?? playerState.currentTime,
      shouldSeek: nextState.shouldSeek ?? false,
    });
  }

  private getCurrentState(): SyncplayStateInput {
    const playerState = this.options.player.getState();
    return {
      isPaused: !playerState.isPlaying || Boolean(playerState.error),
      positionSeconds: playerState.currentTime,
      shouldSeek: false,
    };
  }

  private addSuppressedPlaybackEvent(isPaused: boolean): number {
    this.suppressedPlaybackEventId += 1;
    const id = this.suppressedPlaybackEventId;
    this.suppressedPlaybackEvents.push({
      id,
      isPaused,
      expiresAt: this.now() + this.remotePlaybackSuppressionMs,
    });
    return id;
  }

  private removeSuppressedPlaybackEvent(id: number): void {
    this.suppressedPlaybackEvents = this.suppressedPlaybackEvents.filter(
      (event) => event.id !== id,
    );
  }

  private createSuppressedSeekEvent(
    positionSeconds: number,
    mode: SyncplaySeekResult,
  ): SuppressedSeekEvent {
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const event: SuppressedSeekEvent = {
      positionSeconds,
      expiresAt: this.now() + this.remoteSeekSuppressionMs,
      mode,
      settled,
      resolve: resolveSettled,
    };
    this.suppressedSeek = event;
    return event;
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout === null) {
      return;
    }

    this.clearTimer(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(resolve, ms);
    });
  }

  private get remoteStateSettleIntervalMs(): number {
    return this.options.remoteStateSettleIntervalMs ?? DEFAULT_REMOTE_STATE_SETTLE_INTERVAL_MS;
  }

  private get remoteSeekSuppressionMs(): number {
    return this.options.remoteSeekSuppressionMs ?? DEFAULT_REMOTE_SEEK_SUPPRESSION_MS;
  }

  private get remotePlaybackSuppressionMs(): number {
    return this.options.remotePlaybackSuppressionMs ?? DEFAULT_REMOTE_PLAYBACK_SUPPRESSION_MS;
  }

  private get remoteStateApplyTimeoutMs(): number {
    return this.options.remoteStateApplyTimeoutMs ?? DEFAULT_REMOTE_STATE_APPLY_TIMEOUT_MS;
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
