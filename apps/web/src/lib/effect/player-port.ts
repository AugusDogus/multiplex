"use client";

import { Context, Layer } from "effect";

import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { MediaPlayerItem } from "~/types/media-player";

export type PlayerSnapshot = {
  readonly isPlaying: boolean;
  readonly currentTimeSeconds: number;
  readonly durationSeconds: number;
  readonly canPlay: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
};

export type PlayerActions = {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (seconds: number) => void;
};

export type PlayerPortShape = {
  readonly load: (
    item: MediaPlayerItem,
    opts: { resume: boolean; startPositionSeconds?: number },
  ) => void;
  readonly close: () => void;
  readonly snapshot: () => PlayerSnapshot;
  readonly subscribe: (
    listener: (snapshot: PlayerSnapshot) => void,
  ) => () => void;
  /**
   * Wave-2: register video-element play/pause/seek actions from React hooks.
   * Until registered, play/pause/seek no-op with a console.warn.
   */
  readonly registerActions: (actions: PlayerActions) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (seconds: number) => void;
};

const readSnapshot = (): PlayerSnapshot => {
  const state = useMediaPlayerStore.getState();
  return {
    isPlaying: state.isPlaying,
    currentTimeSeconds: state.currentTime,
    durationSeconds: state.duration,
    canPlay: state.canPlay,
    isLoading: state.isLoading,
    error: state.error,
  };
};

const snapshotsEqual = (a: PlayerSnapshot, b: PlayerSnapshot): boolean =>
  a.isPlaying === b.isPlaying &&
  a.currentTimeSeconds === b.currentTimeSeconds &&
  a.durationSeconds === b.durationSeconds &&
  a.canPlay === b.canPlay &&
  a.isLoading === b.isLoading &&
  a.error === b.error;

/**
 * TODO(wave-2): play/pause/seek currently live on the video element via React
 * hooks (`useMediaPlayerActions` etc.). Register them through
 * `registerActions` once the session service needs to command playback; until
 * then those methods warn and no-op.
 */
export const makePlayerPort = (): PlayerPortShape => {
  let actions: PlayerActions | null = null;

  const warnUnregistered = (method: "play" | "pause" | "seek"): void => {
    console.warn(
      `[PlayerPort] ${method}() called before registerActions(); no-op until wave-2 adapter wires the video element.`,
    );
  };

  return {
    load: (item, opts) => {
      useMediaPlayerStore.getState().openPlayer(item, {
        resume: opts.resume,
        startPositionSeconds: opts.startPositionSeconds,
      });
    },
    close: () => {
      useMediaPlayerStore.getState().closePlayer();
    },
    snapshot: readSnapshot,
    subscribe: (listener) => {
      let previous = readSnapshot();
      return useMediaPlayerStore.subscribe(() => {
        const next = readSnapshot();
        if (snapshotsEqual(previous, next)) return;
        previous = next;
        listener(next);
      });
    },
    registerActions: (next) => {
      actions = next;
    },
    play: () => {
      if (!actions) {
        warnUnregistered("play");
        return;
      }
      actions.play();
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
        return;
      }
      actions.seek(seconds);
    },
  };
};

/**
 * Imperative player boundary over the Zustand media-player store.
 *
 * Effect v4 (`4.0.0-beta.59`) uses `Context.Service` + `Layer.succeed` /
 * `Layer.sync` (no `Effect.Service` / auto-`Default` in this beta).
 */
export class PlayerPort extends Context.Service<PlayerPort, PlayerPortShape>()(
  "PlayerPort",
) {
  static readonly Default = Layer.sync(PlayerPort, makePlayerPort);
}
