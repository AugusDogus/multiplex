"use client";

import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import type { ItemMetadata } from "@multiplex/plex-query";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type {
  CaptionSize,
  MediaPlayerItem,
  NextEpisodeInfo,
  PlaybackRate,
} from "~/types/media-player";

import {
  PlayerService,
  type PlayerPlaybackUpdate,
  type PlayerServiceShape,
  type PlayerState,
} from "./player-service";
import { sessionRuntime } from "./runtime";

/**
 * PlayerService instance from the shared {@link sessionRuntime} so Watch
 * Together's PlayerPort and React UI share one SubscriptionRef.
 */
const player: PlayerServiceShape = sessionRuntime.runSync(
  Effect.gen(function* () {
    return yield* PlayerService;
  }),
);

/**
 * Synchronous PlayerState for React. Backed by `Atom.subscriptionRef` so
 * updates from the service's SubscriptionRef propagate without polling.
 */
export const playerStateAtom: Atom.Atom<PlayerState> = Atom.subscriptionRef(
  player.state,
).pipe(Atom.keepAlive);

/** Playback/session fields from PlayerService (no persisted prefs). */
export function usePlayerPlaybackState(): PlayerState {
  return useAtomValue(playerStateAtom);
}

/**
 * Composed view matching the legacy `MediaPlayerState` shape: playback
 * fields from PlayerService plus prefs from the Zustand prefs store, with
 * `autoPlay.isEnabled` merged onto the countdown sub-state.
 */
export type PlayerViewState = PlayerState & {
  volume: number;
  isMuted: boolean;
  playbackRate: PlaybackRate;
  captionSize: CaptionSize;
  autoPlay: {
    isEnabled: boolean;
    isCountingDown: boolean;
    countdownSeconds: number;
    nextEpisode: NextEpisodeInfo | null;
  };
};

export function usePlayerState(): PlayerViewState {
  const playback = useAtomValue(playerStateAtom);
  const volume = usePlayerPrefsStore((s) => s.volume);
  const isMuted = usePlayerPrefsStore((s) => s.isMuted);
  const playbackRate = usePlayerPrefsStore((s) => s.playbackRate);
  const captionSize = usePlayerPrefsStore((s) => s.captionSize);
  const autoPlayEnabled = usePlayerPrefsStore((s) => s.autoPlayEnabled);

  return useMemo(
    () => ({
      ...playback,
      volume,
      isMuted,
      playbackRate,
      captionSize,
      autoPlay: {
        ...playback.autoPlay,
        isEnabled: autoPlayEnabled,
      },
    }),
    [playback, volume, isMuted, playbackRate, captionSize, autoPlayEnabled],
  );
}

/**
 * Fine-grained selector over {@link usePlayerState}. Prefer this when a
 * component only needs one or two fields to limit re-render breadth.
 */
export function usePlayerStateSelector<T>(
  select: (state: PlayerViewState) => T,
): T {
  const state = usePlayerState();
  return useMemo(() => select(state), [state, select]);
}

const runPlayer = <A>(f: (p: PlayerServiceShape) => A): A => f(player);

/**
 * Plain-function command facade for non-React callers. Runs against the
 * PlayerService living in {@link sessionRuntime}.
 */
export const playerCommands = {
  snapshot: (): PlayerState => player.snapshot(),
  openPlayer: (
    item: MediaPlayerItem,
    options?: { resume?: boolean; startPositionSeconds?: number },
  ): void => {
    runPlayer((p) => p.openPlayer(item, options));
  },
  closePlayer: (): void => {
    runPlayer((p) => p.closePlayer());
  },
  updatePlaybackState: (updates: PlayerPlaybackUpdate): void => {
    runPlayer((p) => p.updatePlaybackState(updates));
  },
  updateCurrentTime: (time: number): void => {
    runPlayer((p) => p.updateCurrentTime(time));
  },
  updateDuration: (duration: number): void => {
    runPlayer((p) => p.updateDuration(duration));
  },
  updateBufferedTime: (bufferedTime: number): void => {
    runPlayer((p) => p.updateBufferedTime(bufferedTime));
  },
  applyPlaybackMetadata: (
    metadata: ItemMetadata,
    options?: {
      preserveCurrentTime?: number;
      reloadVideo?: boolean;
      previousVideoUsesTranscode?: boolean;
    },
  ): void => {
    runPlayer((p) => p.applyPlaybackMetadata(metadata, options));
  },
  toggleFullscreen: (): void => {
    runPlayer((p) => p.toggleFullscreen());
  },
  showControlsTemporarily: (): void => {
    runPlayer((p) => p.showControlsTemporarily());
  },
  hideControls: (): void => {
    runPlayer((p) => p.hideControls());
  },
  startAutoPlayCountdown: (nextEpisode: NextEpisodeInfo): void => {
    runPlayer((p) => p.startAutoPlayCountdown(nextEpisode));
  },
  setAutoPlayEnabled: (isEnabled: boolean): void => {
    runPlayer((p) => p.setAutoPlayEnabled(isEnabled));
  },
  cancelAutoPlay: (): void => {
    runPlayer((p) => p.cancelAutoPlay());
  },
  triggerAutoPlay: (nextEpisode: NextEpisodeInfo): void => {
    runPlayer((p) => p.triggerAutoPlay(nextEpisode));
  },
  updateCountdownSeconds: (seconds: number): void => {
    runPlayer((p) => p.updateCountdownSeconds(seconds));
  },
  setVolume: (volume: number): void => {
    runPlayer((p) => p.setVolume(volume));
  },
  toggleMute: (): void => {
    runPlayer((p) => p.toggleMute());
  },
  setPlaybackRate: (playbackRate: PlaybackRate): void => {
    runPlayer((p) => p.setPlaybackRate(playbackRate));
  },
  setCaptionSize: (captionSize: CaptionSize): void => {
    runPlayer((p) => p.setCaptionSize(captionSize));
  },
};
