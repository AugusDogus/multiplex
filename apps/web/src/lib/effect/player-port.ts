"use client";

import { Context, Effect, Fiber, Layer, Stream } from "effect";

import {
  PlayerService,
  type PlayerServiceShape,
  type PlayerState,
} from "./player-service";
import type {
  MediaPlayerItem,
  MediaPlayerSeekResult,
} from "~/types/media-player";

export type PlayerSnapshot = {
  readonly isPlaying: boolean;
  readonly currentTimeSeconds: number;
  readonly durationSeconds: number;
  readonly canPlay: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
};

/**
 * Result types match the Syncplay controller's contract: `play` reports
 * whether playback actually started (autoplay can be blocked), and `seek`
 * reports how the seek was applied — `"none"` means the video wasn't ready
 * and the controller must retry the remote seek rather than drop it.
 */
export type PlayerActions = {
  readonly play: () => boolean | Promise<boolean>;
  readonly pause: () => void;
  readonly seek: (seconds: number) => MediaPlayerSeekResult;
};

export type PlayerPortShape = {
  readonly load: (
    item: MediaPlayerItem,
    opts: { resume: boolean; startPositionSeconds?: number },
  ) => void;
  readonly close: () => void;
  readonly snapshot: () => PlayerSnapshot;
  /** Current media-player item (full metadata), or null when closed. */
  readonly currentItem: () => MediaPlayerItem | null;
  readonly subscribe: (
    listener: (snapshot: PlayerSnapshot) => void,
  ) => () => void;
  /**
   * Wave-2: register video-element play/pause/seek actions from React hooks.
   * Until registered, play/pause/seek no-op with a console.warn.
   */
  readonly registerActions: (actions: PlayerActions) => void;
  readonly play: () => boolean | Promise<boolean>;
  readonly pause: () => void;
  readonly seek: (seconds: number) => MediaPlayerSeekResult;
};

const toSnapshot = (state: PlayerState): PlayerSnapshot => ({
  isPlaying: state.isPlaying,
  currentTimeSeconds: state.currentTime,
  durationSeconds: state.duration,
  canPlay: state.canPlay,
  isLoading: state.isLoading,
  error: state.error,
});

const snapshotsEqual = (a: PlayerSnapshot, b: PlayerSnapshot): boolean =>
  a.isPlaying === b.isPlaying &&
  a.currentTimeSeconds === b.currentTimeSeconds &&
  a.durationSeconds === b.durationSeconds &&
  a.canPlay === b.canPlay &&
  a.isLoading === b.isLoading &&
  a.error === b.error;

/**
 * Imperative player boundary over {@link PlayerService}.
 *
 * Effect v4 (`4.0.0-beta.59`) uses `Context.Service` + `Layer.effect`
 * (no `Effect.Service` / auto-`Default` in this beta).
 */
export const makePlayerPort = (player: PlayerServiceShape): PlayerPortShape => {
  let actions: PlayerActions | null = null;

  const warnUnregistered = (method: "play" | "pause" | "seek"): void => {
    console.warn(
      `[PlayerPort] ${method}() called before registerActions(); no-op until wave-2 adapter wires the video element.`,
    );
  };

  return {
    load: (item, opts) => {
      player.openPlayer(item, {
        resume: opts.resume,
        startPositionSeconds: opts.startPositionSeconds,
      });
    },
    close: () => {
      player.closePlayer();
    },
    snapshot: () => toSnapshot(player.snapshot()),
    currentItem: () => player.snapshot().currentItem,
    subscribe: (listener) => {
      let previous = toSnapshot(player.snapshot());
      // SubscriptionRef.changes is a module function in v4 beta.59.
      const fiber = Effect.runFork(
        Stream.runForEach(player.changes, (state) =>
          Effect.sync(() => {
            const next = toSnapshot(state);
            if (snapshotsEqual(previous, next)) return;
            previous = next;
            listener(next);
          }),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
    registerActions: (next) => {
      actions = next;
    },
    play: () => {
      if (!actions) {
        warnUnregistered("play");
        return false;
      }
      return actions.play();
    },
    pause: () => {
      if (!actions) {
        warnUnregistered("pause");
        return;
      }
      actions.pause();
    },
    seek: (seconds) => {
      if (!actions) {
        warnUnregistered("seek");
        // "none" tells the Syncplay controller to retry the remote seek once
        // the video is ready, instead of silently dropping it.
        return "none";
      }
      return actions.seek(seconds);
    },
  };
};

export class PlayerPort extends Context.Service<PlayerPort, PlayerPortShape>()(
  "PlayerPort",
) {
  static readonly Default = Layer.effect(PlayerPort)(
    Effect.gen(function* () {
      const player = yield* PlayerService;
      return makePlayerPort(player);
    }),
  );
}
