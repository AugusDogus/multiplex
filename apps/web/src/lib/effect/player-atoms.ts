"use client";

import { Effect, Fiber, Stream } from "effect";
import { useState, useSyncExternalStore } from "react";

import type { ItemMetadata } from "@multiplex/plex-query";
import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

import {
  PlayerService,
  type PlayerPlaybackIdentity,
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

type PlayerListener = () => void;

const playerListeners = new Set<PlayerListener>();
let playerChangesFiber: Fiber.Fiber<void, never> | null = null;

const subscribePlayer = (listener: PlayerListener): (() => void) => {
  playerListeners.add(listener);
  playerChangesFiber ??= sessionRuntime.runFork(
    Stream.runForEach(player.changes, () =>
      Effect.sync(() => {
        playerListeners.forEach((notify) => notify());
      }),
    ),
  );

  return () => {
    playerListeners.delete(listener);
    if (playerListeners.size === 0 && playerChangesFiber !== null) {
      sessionRuntime.runFork(Fiber.interrupt(playerChangesFiber));
      playerChangesFiber = null;
    }
  };
};

const createPlayerSelectorStore = <T>(
  initialSelect: (state: PlayerState) => T,
  initialIsEqual: (left: T, right: T) => boolean,
) => {
  let select = initialSelect;
  let isEqual = initialIsEqual;
  let selection = select(player.snapshot());

  const getSnapshot = (): T => {
    const next = select(player.snapshot());
    if (!isEqual(selection, next)) {
      selection = next;
    }
    return selection;
  };

  return {
    updateSelector: (
      nextSelect: (state: PlayerState) => T,
      nextIsEqual: (left: T, right: T) => boolean,
    ): void => {
      select = nextSelect;
      isEqual = nextIsEqual;
    },
    getSnapshot,
    subscribe: (listener: PlayerListener): (() => void) => {
      return subscribePlayer(() => {
        const previous = selection;
        if (getSnapshot() !== previous) {
          listener();
        }
      });
    },
  };
};

/** Subscribe to a projection of the canonical PlayerService state. */
export function usePlayerStateSelector<T>(
  select: (state: PlayerState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const [store] = useState(() => createPlayerSelectorStore(select, isEqual));
  store.updateSelector(select, isEqual);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
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
  playbackIdentity: (): PlayerPlaybackIdentity | null =>
    runPlayer((p) => p.playbackIdentity()),
  /** Item-scoped async callers must use `updatePlaybackStateFor`. */
  updatePlaybackState: (updates: PlayerPlaybackUpdate): void => {
    runPlayer((p) => p.updatePlaybackState(updates));
  },
  updatePlaybackStateFor: (
    expected: PlayerPlaybackIdentity,
    updates: PlayerPlaybackUpdate,
  ): boolean => runPlayer((p) => p.updatePlaybackStateFor(expected, updates)),
  retryTranscodeSource: (expected: PlayerPlaybackIdentity): boolean =>
    runPlayer((p) => p.retryTranscodeSource(expected)),
  replaceTranscodeSource: (
    expected: PlayerPlaybackIdentity,
    streamOffset: number,
  ): boolean =>
    runPlayer((p) => p.replaceTranscodeSource(expected, streamOffset)),
  applyPlaybackMetadata: (
    expected: PlayerPlaybackIdentity,
    metadata: ItemMetadata,
    options?: {
      preserveCurrentTime?: number;
      reloadVideo?: boolean;
      previousVideoUsesTranscode?: boolean;
    },
  ): void => {
    runPlayer((p) => p.applyPlaybackMetadata(expected, metadata, options));
  },
  startAutoPlayCountdown: (nextEpisode: NextEpisodeInfo): void => {
    runPlayer((p) => p.startAutoPlayCountdown(nextEpisode));
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
};
