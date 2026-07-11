"use client";

import type {
  ItemMetadata,
  Marker,
  PlayQueueResponse,
} from "@multiplex/plex-query";
import { Context, Effect, Layer, SubscriptionRef } from "effect";
import type { Stream } from "effect";

import {
  buildPlexPlaybackPlan,
  playbackUsesTranscode,
} from "~/components/media-player/utils/plex-playback-plan";
import { formatTime } from "~/components/media-player/utils/playback-time-utils";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { useProgressStore } from "~/stores/progress-store";
import type {
  MediaPlayerItem,
  NextEpisodeInfo,
  PlaybackRate,
  CaptionSize,
} from "~/types/media-player";

/**
 * Playback / session view-model owned by {@link PlayerService}.
 *
 * Persisted UI prefs (volume, mute, rate, caption size, autoPlay.enabled)
 * live in `player-prefs-store` — not here — but countdown fields stay on
 * this struct so overlay / auto-play hooks keep a single reactive read.
 */
export type PlayerState = {
  readonly isOpen: boolean;
  readonly currentItem: MediaPlayerItem | null;
  readonly playQueue: PlayQueueResponse | null;
  readonly playQueueId: string | null;
  readonly markers: Marker[];
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly bufferedTime: number;
  readonly streamOffset: number;
  readonly streamSessionId: string;
  readonly sourceGeneration: number;
  readonly isFullscreen: boolean;
  readonly showControls: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly canPlay: boolean;
  readonly isBuffering: boolean;
  readonly autoPlay: {
    readonly isCountingDown: boolean;
    readonly countdownSeconds: number;
    readonly nextEpisode: NextEpisodeInfo | null;
  };
};

export type PlayerPlaybackIdentity = {
  readonly streamSessionId: string;
  readonly serverId: string;
  readonly ratingKey: string;
};

export function getPlayerPlaybackIdentity(
  state: PlayerState,
): PlayerPlaybackIdentity | null {
  return state.currentItem
    ? {
        streamSessionId: state.streamSessionId,
        serverId: state.currentItem.serverId,
        ratingKey: state.currentItem.ratingKey,
      }
    : null;
}

export function isPlayerPlaybackIdentityCurrent(
  state: PlayerState,
  expected: PlayerPlaybackIdentity,
): boolean {
  const current = getPlayerPlaybackIdentity(state);
  return (
    current !== null &&
    current.streamSessionId === expected.streamSessionId &&
    current.serverId === expected.serverId &&
    current.ratingKey === expected.ratingKey
  );
}

/**
 * Fields writable via {@link PlayerServiceShape.updatePlaybackState}.
 * Item-scoped async callers must use `updatePlaybackStateFor` instead.
 */
export type PlayerPlaybackUpdate = Partial<
  Omit<PlayerState, "autoPlay" | "sourceGeneration"> & {
    autoPlay: PlayerState["autoPlay"];
  }
>;

export const initialPlayerState: PlayerState = {
  isOpen: false,
  currentItem: null,
  playQueue: null,
  playQueueId: null,
  markers: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  bufferedTime: 0,
  streamOffset: 0,
  streamSessionId: "",
  sourceGeneration: 0,
  isFullscreen: false,
  showControls: true,
  isLoading: false,
  error: null,
  canPlay: false,
  isBuffering: false,
  autoPlay: {
    isCountingDown: false,
    countdownSeconds: 0,
    nextEpisode: null,
  },
};

export function getProgressPercent(state: PlayerState): number {
  return state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
}

export function getBufferedPercent(state: PlayerState): number {
  return state.duration > 0 ? (state.bufferedTime / state.duration) * 100 : 0;
}

export function getFormattedCurrentTime(state: PlayerState): string {
  return formatTime(state.currentTime);
}

export function getFormattedDuration(state: PlayerState): string {
  return formatTime(state.duration);
}

export function getPlayerStatus(state: PlayerState): {
  status: "loading" | "ready" | "error" | "buffering" | "waiting";
  message?: string;
} {
  if (state.error) return { status: "error", message: state.error };
  if (state.isLoading) return { status: "loading" };
  if (state.isBuffering) return { status: "buffering" };
  if (!state.canPlay) return { status: "waiting" };
  return { status: "ready" };
}

export function getIsReady(state: PlayerState): boolean {
  return Boolean(
    state.currentItem && state.canPlay && !state.isLoading && !state.error,
  );
}

export type PlayerServiceShape = {
  readonly state: SubscriptionRef.SubscriptionRef<PlayerState>;
  readonly changes: Stream.Stream<PlayerState>;
  readonly snapshot: () => PlayerState;
  readonly openPlayer: (
    item: MediaPlayerItem,
    options?: { resume?: boolean; startPositionSeconds?: number },
  ) => void;
  readonly closePlayer: () => void;
  readonly playbackIdentity: () => PlayerPlaybackIdentity | null;
  /** Only for synchronous updates that are not scoped to a playback item. */
  readonly updatePlaybackState: (updates: PlayerPlaybackUpdate) => void;
  readonly updatePlaybackStateFor: (
    expected: PlayerPlaybackIdentity,
    updates: PlayerPlaybackUpdate,
  ) => boolean;
  readonly updateCurrentTime: (time: number) => void;
  readonly updateDuration: (duration: number) => void;
  readonly updateBufferedTime: (bufferedTime: number) => void;
  readonly applyPlaybackMetadata: (
    expected: PlayerPlaybackIdentity,
    metadata: ItemMetadata,
    options?: {
      preserveCurrentTime?: number;
      reloadVideo?: boolean;
      previousVideoUsesTranscode?: boolean;
    },
  ) => void;
  readonly toggleFullscreen: () => void;
  /**
   * Controls auto-hide uses plain `setTimeout` at this browser boundary
   * (same behavior as the former Zustand store). The timer id is held in
   * service closure — not in {@link PlayerState} — so atom subscribers are
   * not woken by timer bookkeeping.
   */
  readonly showControlsTemporarily: () => void;
  readonly hideControls: () => void;
  readonly startAutoPlayCountdown: (nextEpisode: NextEpisodeInfo) => void;
  readonly setAutoPlayEnabled: (isEnabled: boolean) => void;
  readonly cancelAutoPlay: () => void;
  readonly triggerAutoPlay: (nextEpisode: NextEpisodeInfo) => void;
  readonly updateCountdownSeconds: (seconds: number) => void;
  /** Prefs facade — writes {@link usePlayerPrefsStore}. */
  readonly setVolume: (volume: number) => void;
  readonly toggleMute: () => void;
  readonly setPlaybackRate: (playbackRate: PlaybackRate) => void;
  readonly setCaptionSize: (captionSize: CaptionSize) => void;
};

const setState = (
  state: SubscriptionRef.SubscriptionRef<PlayerState>,
  updates: PlayerPlaybackUpdate | ((s: PlayerState) => PlayerState),
): void => {
  Effect.runSync(
    SubscriptionRef.update(state, (current) => {
      const next =
        typeof updates === "function"
          ? updates(current)
          : { ...current, ...updates };

      if (
        next.streamOffset !== current.streamOffset &&
        next.sourceGeneration === current.sourceGeneration
      ) {
        return {
          ...next,
          sourceGeneration: current.sourceGeneration + 1,
        };
      }

      return next;
    }),
  );
};

const getVideoSourceSignature = (item: MediaPlayerItem): string => {
  const media = item.Media?.[0];
  const plan = buildPlexPlaybackPlan(item);

  return plan.streamDecision === "direct-play" &&
    plan.burnedSubtitleIndex === null
    ? JSON.stringify({
        kind: "direct-play",
        serverUrl: item.serverUrl,
        authToken: item.authToken,
        partKey: media?.Part?.[0]?.key,
      })
    : JSON.stringify({
        kind: "transcode",
        serverUrl: item.serverUrl,
        authToken: item.authToken,
        key: item.key,
        hasPart: Boolean(media?.Part?.[0]?.key),
        burnedSubtitleIndex: plan.burnedSubtitleIndex,
      });
};

const getState = (
  state: SubscriptionRef.SubscriptionRef<PlayerState>,
): PlayerState => Effect.runSync(SubscriptionRef.get(state));

export const makePlayerService: Effect.Effect<PlayerServiceShape> = Effect.gen(
  function* () {
    const state = yield* SubscriptionRef.make<PlayerState>(initialPlayerState);

    // Browser timer for controls auto-hide; cleared on close / re-show.
    let controlsTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearControlsTimeout = (): void => {
      if (controlsTimeout !== null) {
        clearTimeout(controlsTimeout);
        controlsTimeout = null;
      }
    };

    const openPlayer: PlayerServiceShape["openPlayer"] = (item, options) => {
      // Watch Together starts everyone from the beginning (resume === false)
      // so all participants stay in sync; otherwise resume from cached
      // progress or the item's viewOffset.
      const resume = options?.resume ?? true;
      const progressStore = useProgressStore.getState();
      const updatedProgressPercent = resume
        ? progressStore.getItemProgress(item.ratingKey)
        : undefined;

      // Calculate initial currentTime. An explicit `startPositionSeconds`
      // wins (used when joining an in-progress Watch Together session, so
      // the joiner starts at the room's current position instead of 0 and
      // doesn't drag everyone else back to the start). Otherwise resume
      // from cached progress / viewOffset, or start at 0.
      const initialCurrentTime =
        options?.startPositionSeconds !== undefined
          ? item.duration
            ? Math.min(
                Math.max(0, options.startPositionSeconds),
                item.duration / 1000,
              )
            : Math.max(0, options.startPositionSeconds)
          : !resume
            ? 0
            : updatedProgressPercent !== undefined && item.duration
              ? (updatedProgressPercent / 100) * (item.duration / 1000)
              : Math.floor(item.viewOffset ?? 0) / 1000;

      // Plex's transcoded MP4 stream can't be seeked after load, so for
      // resumed transcoded items we bake the resume position into the
      // initial stream URL via `offset`.
      const initialStreamOffset =
        initialCurrentTime > 0 && playbackUsesTranscode(item)
          ? initialCurrentTime
          : 0;

      setState(state, (current) => ({
        ...current,
        isOpen: true,
        currentItem: item,
        playQueue: null,
        playQueueId: null,
        markers: [],
        currentTime: initialCurrentTime,
        streamOffset: initialStreamOffset,
        // Fresh, unique transcode session per playback (stable across seeks)
        // so two viewers — and repeat plays of the same item — never collide
        // on one Plex transcode session (which returns HTTP 400 / no source).
        streamSessionId: `multiplex-${crypto.randomUUID()}`,
        sourceGeneration: current.sourceGeneration + 1,
        isLoading: true,
        error: null,
        isPlaying: false,
        duration: 0,
        bufferedTime: 0,
        canPlay: false,
        isBuffering: false,
        autoPlay: {
          isCountingDown: false,
          countdownSeconds: 0,
          nextEpisode: null,
        },
      }));
    };

    const cancelAutoPlay: PlayerServiceShape["cancelAutoPlay"] = () => {
      setState(state, (s) => ({
        ...s,
        autoPlay: {
          isCountingDown: false,
          countdownSeconds: 0,
          nextEpisode: null,
        },
      }));
    };

    const triggerAutoPlay: PlayerServiceShape["triggerAutoPlay"] = (
      nextEpisode,
    ) => {
      const currentItem = getState(state).currentItem;
      if (!currentItem) return;

      // Cancel countdown first
      cancelAutoPlay();

      // Drop stale Media/Stream metadata from the previous episode while
      // keeping shared library/server fields needed for playback.
      const nextEpisodeItem: MediaPlayerItem = {
        ...currentItem,
        Media: undefined,
        ratingKey: nextEpisode.ratingKey,
        key: nextEpisode.key,
        title: nextEpisode.title,
        type: "episode",
        index: nextEpisode.index,
        parentIndex: nextEpisode.parentIndex,
        thumb: nextEpisode.thumb,
        art: nextEpisode.art,
        duration: nextEpisode.duration,
        grandparentTitle: nextEpisode.grandparentTitle,
        parentTitle: nextEpisode.parentTitle,
        viewOffset: 0,
      };

      // Open the next episode
      openPlayer(nextEpisodeItem);
    };

    return {
      state,
      changes: SubscriptionRef.changes(state),
      snapshot: () => getState(state),

      openPlayer,

      closePlayer: () => {
        clearControlsTimeout();

        // autoPlay.isEnabled lives in player-prefs-store and is intentionally
        // left alone (same persistence behavior as the old store's closePlayer).
        setState(state, (current) => ({
          ...initialPlayerState,
          sourceGeneration: current.sourceGeneration + 1,
          autoPlay: {
            isCountingDown: false,
            countdownSeconds: 0,
            nextEpisode: null,
          },
          showControls: true,
          isFullscreen: false,
        }));
      },

      playbackIdentity: () => getPlayerPlaybackIdentity(getState(state)),

      updatePlaybackState: (updates) => setState(state, updates),
      updatePlaybackStateFor: (expected, updates) => {
        let applied = false;
        setState(state, (current) => {
          if (!isPlayerPlaybackIdentityCurrent(current, expected)) {
            return current;
          }
          applied = true;
          return { ...current, ...updates };
        });
        return applied;
      },

      updateCurrentTime: (time) => setState(state, { currentTime: time }),
      updateDuration: (duration) => setState(state, { duration }),
      updateBufferedTime: (bufferedTime) => setState(state, { bufferedTime }),

      applyPlaybackMetadata: (expected, metadata, options) => {
        setState(state, (current) => {
          if (
            !current.currentItem ||
            !isPlayerPlaybackIdentityCurrent(current, expected) ||
            metadata.ratingKey !== expected.ratingKey
          ) {
            return current;
          }

          const currentStreams =
            current.currentItem.Media?.[0]?.Part?.[0]?.Stream;
          const nextStreams = metadata.Media?.[0]?.Part?.[0]?.Stream;
          if (
            !options?.reloadVideo &&
            currentStreams &&
            nextStreams &&
            JSON.stringify(currentStreams) === JSON.stringify(nextStreams)
          ) {
            return current;
          }

          const hydratedItem: MediaPlayerItem = {
            ...current.currentItem,
            ...metadata,
            serverUrl: current.currentItem.serverUrl,
            authToken: current.currentItem.authToken,
            serverId: current.currentItem.serverId,
          };
          const plan = buildPlexPlaybackPlan(hydratedItem);
          const videoSourceChanged =
            getVideoSourceSignature(current.currentItem) !==
            getVideoSourceSignature(hydratedItem);
          const preserveCurrentTime =
            options?.preserveCurrentTime ?? current.currentTime;

          if (options?.reloadVideo) {
            const previousUsesTranscode =
              options.previousVideoUsesTranscode ??
              playbackUsesTranscode(current.currentItem);
            const shouldReloadVideo =
              previousUsesTranscode || plan.videoUsesTranscode;
            const sourceGeneration =
              shouldReloadVideo || videoSourceChanged
                ? current.sourceGeneration + 1
                : current.sourceGeneration;

            return {
              ...current,
              currentItem: hydratedItem,
              currentTime: preserveCurrentTime,
              sourceGeneration,
              streamOffset:
                plan.videoUsesTranscode && preserveCurrentTime > 0
                  ? preserveCurrentTime
                  : 0,
              ...(shouldReloadVideo ? { isLoading: true, canPlay: false } : {}),
            };
          }

          const shouldSeedStreamOffset =
            current.streamOffset === 0 &&
            current.currentTime > 0 &&
            plan.videoUsesTranscode;

          return {
            ...current,
            currentItem: hydratedItem,
            sourceGeneration: videoSourceChanged
              ? current.sourceGeneration + 1
              : current.sourceGeneration,
            streamOffset: shouldSeedStreamOffset
              ? current.currentTime
              : current.streamOffset,
          };
        });
      },

      toggleFullscreen: () =>
        setState(state, (s) => ({ ...s, isFullscreen: !s.isFullscreen })),

      showControlsTemporarily: () => {
        clearControlsTimeout();
        controlsTimeout = setTimeout(() => {
          controlsTimeout = null;
          setState(state, { showControls: false });
        }, 3000);
        setState(state, { showControls: true });
      },

      hideControls: () => {
        clearControlsTimeout();
        setState(state, { showControls: false });
      },

      startAutoPlayCountdown: (nextEpisode) => {
        setState(state, (s) => ({
          ...s,
          autoPlay: {
            isCountingDown: true,
            countdownSeconds: 5,
            nextEpisode,
          },
        }));
      },

      setAutoPlayEnabled: (isEnabled) => {
        usePlayerPrefsStore.getState().setAutoPlayEnabled(isEnabled);
        if (!isEnabled) {
          setState(state, (s) => ({
            ...s,
            autoPlay: {
              isCountingDown: false,
              countdownSeconds: 0,
              nextEpisode: null,
            },
          }));
        }
      },

      cancelAutoPlay,
      triggerAutoPlay,

      updateCountdownSeconds: (timeRemaining) => {
        const current = getState(state);

        if (!current.autoPlay.isCountingDown) {
          return;
        }

        const countdownSeconds = Math.max(Math.ceil(timeRemaining), 0);

        setState(state, (s) => ({
          ...s,
          autoPlay: {
            ...s.autoPlay,
            countdownSeconds,
          },
        }));

        // Trigger auto-play when countdown reaches 0
        if (countdownSeconds <= 0 && current.autoPlay.nextEpisode) {
          triggerAutoPlay(current.autoPlay.nextEpisode);
        }
      },

      setVolume: (volume) => {
        usePlayerPrefsStore.getState().setVolume(volume);
      },
      toggleMute: () => {
        usePlayerPrefsStore.getState().toggleMute();
      },
      setPlaybackRate: (playbackRate) => {
        usePlayerPrefsStore.getState().setPlaybackRate(playbackRate);
      },
      setCaptionSize: (captionSize) => {
        usePlayerPrefsStore.getState().setCaptionSize(captionSize);
      },
    } satisfies PlayerServiceShape;
  },
);

/**
 * Effect v4 (`4.0.0-beta.59`): `Context.Service` + `Layer.effect` (no
 * `Effect.Service` / auto-`Default` in this beta).
 */
export class PlayerService extends Context.Service<
  PlayerService,
  PlayerServiceShape
>()("PlayerService") {
  static readonly Default = Layer.effect(PlayerService)(makePlayerService);
}

/** Sync constructor for unit tests outside a ManagedRuntime. */
export const createPlayerService = (): PlayerServiceShape =>
  Effect.runSync(makePlayerService);
