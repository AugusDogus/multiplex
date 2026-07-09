"use client";

import {
  Idle,
  playing,
  swapPlayingRoom,
  type ParticipantMap,
  type PlayingItem,
  type SessionState,
  SyncplaySessionController,
  type SyncplayParticipantState,
  type SyncplayPlayerAdapter,
  type SyncplaySessionControllerOptions,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import {
  Context,
  Effect,
  Fiber,
  Layer,
  SubscriptionRef,
  type Scope,
} from "effect";
import type { Stream } from "effect";

import { createWatchTogetherSessionToasts } from "~/components/watch-together/watch-together-session-toasts";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerItem } from "~/types/media-player";

import { PlayerPort, type PlayerPortShape } from "./player-port";

export type StartPlaybackInput = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
  readonly item: MediaPlayerItem;
  readonly resume?: false;
  readonly startPositionSeconds?: number;
};

export type SwapToInput = {
  readonly room: WatchTogetherRoom;
  readonly item: MediaPlayerItem;
};

export type LeaveOptions = {
  readonly suppressAutoStart: boolean;
};

/**
 * Minimal controller surface the session service drives. Production uses
 * {@link SyncplaySessionController}; tests inject a stub factory.
 */
export type SessionControllerLike = {
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly setReady: (isReady: boolean | null) => void;
  readonly handleLocalPlaybackChange: (isPaused: boolean) => void;
  readonly handleLocalSeeked: (time: number) => void;
};

export type MakeSessionController = (
  options: SyncplaySessionControllerOptions,
) => SessionControllerLike;

export type WatchTogetherSessionShape = {
  readonly state: SubscriptionRef.SubscriptionRef<SessionState>;
  readonly changes: Stream.Stream<SessionState>;
  readonly snapshot: () => SessionState;
  readonly startPlayback: (input: StartPlaybackInput) => Effect.Effect<void>;
  readonly swapTo: (input: SwapToInput) => Effect.Effect<void>;
  readonly leave: (options: LeaveOptions) => Effect.Effect<void>;
  readonly handleLocalPlaybackChange: (
    isPaused: boolean,
  ) => Effect.Effect<void>;
  readonly handleLocalSeeked: (seconds: number) => Effect.Effect<void>;
};

/**
 * Transitional Zustand write surface. The lobby presence hook still calls
 * `updateParticipant` directly while in the lobby (different lifetime, same
 * merge); the playing path is owned exclusively by this service.
 */
export type SessionMirror = {
  readonly setPlaying: (session: {
    room: WatchTogetherRoom;
    localUser: SyncplayUser;
  }) => void;
  readonly clear: () => void;
  readonly leave: () => void;
  readonly updateParticipant: (participant: SyncplayParticipantState) => void;
};

export type MakeWatchTogetherSessionOptions = {
  readonly player: PlayerPortShape;
  readonly makeController?: MakeSessionController;
  readonly mirror?: SessionMirror;
};

const defaultMirror = (): SessionMirror => ({
  setPlaying: (session) => useWatchTogetherStore.getState().setSession(session),
  clear: () => useWatchTogetherStore.getState().clearSession(),
  leave: () => useWatchTogetherStore.getState().leaveSession(),
  updateParticipant: (participant) =>
    useWatchTogetherStore.getState().updateParticipant(participant),
});

const defaultMakeController: MakeSessionController = (options) =>
  new SyncplaySessionController(options);

const toPlayingItem = (item: MediaPlayerItem): PlayingItem => ({
  serverId: item.serverId,
  ratingKey: item.ratingKey,
  key: item.key,
  title: item.title,
  type: item.type,
  durationSeconds:
    typeof item.duration === "number" ? item.duration / 1000 : undefined,
  index: item.index,
  parentIndex: item.parentIndex,
});

const playerAdapterFromPort = (
  player: PlayerPortShape,
): SyncplayPlayerAdapter => ({
  getState: () => {
    const snap = player.snapshot();
    return {
      isPlaying: snap.isPlaying,
      currentTime: snap.currentTimeSeconds,
      duration: snap.durationSeconds,
      canPlay: snap.canPlay,
      isLoading: snap.isLoading,
      error: snap.error,
    };
  },
  // Pass results through untouched: the controller relies on play() reporting
  // autoplay failures and on seek() returning "none" to retry a remote seek
  // that arrived before the <video> was ready.
  play: () => player.play(),
  pause: () => {
    player.pause();
  },
  seek: (positionSeconds) => player.seek(positionSeconds),
});

const mergeParticipant = (
  participants: ParticipantMap,
  participant: SyncplayParticipantState,
): ParticipantMap => {
  const key = participant.user.deviceIdentifier;
  if (participant.isPresent === false) {
    return {
      ...participants,
      [key]: { user: participant.user, isPresent: false },
    };
  }
  return {
    ...participants,
    [key]: {
      ...participants[key],
      ...(participant.isPresent !== undefined && {
        isPresent: participant.isPresent,
      }),
      ...(participant.isReady !== undefined && {
        isReady: participant.isReady,
      }),
      ...(participant.positionSeconds !== undefined && {
        positionSeconds: participant.positionSeconds,
      }),
      ...(participant.isPaused !== undefined && {
        isPaused: participant.isPaused,
      }),
      user: participant.user,
    },
  };
};

type ConnectionParams = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
  readonly onParticipant: (participant: SyncplayParticipantState) => void;
  readonly onFatalError: () => void;
  readonly onController: (controller: SessionControllerLike) => void;
};

/**
 * Scoped Syncplay driver: mirrors `bindWatchTogetherSession` (toasts +
 * readiness observation) as an `Effect.acquireRelease` resource. Readiness
 * comes from {@link PlayerPort.subscribe} so the service does not import the
 * media-player store directly.
 */
const runConnection = (
  params: ConnectionParams,
  player: PlayerPortShape,
  makeController: MakeSessionController,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const toasts = createWatchTogetherSessionToasts({
        room: params.room,
        localUser: params.localUser,
      });

      const controller = makeController({
        room: params.room,
        user: params.localUser,
        player: playerAdapterFromPort(player),
        onParticipant: (participant) => {
          params.onParticipant(participant);
          toasts.handleParticipant(participant);
        },
        onRemoteAction: toasts.handleRemoteAction,
        onFatalError: () => {
          params.onFatalError();
        },
      });

      params.onController(controller);
      controller.connect();

      if (player.snapshot().canPlay) {
        toasts.noteLocalStarted();
      }
      let previousCanPlay = player.snapshot().canPlay;
      const unsubscribeReady = player.subscribe((snap) => {
        if (snap.canPlay === previousCanPlay) return;
        previousCanPlay = snap.canPlay;
        controller.setReady(snap.canPlay);
        if (snap.canPlay) {
          toasts.noteLocalStarted();
        }
      });

      return { controller, toasts, unsubscribeReady };
    }),
    ({ controller, toasts, unsubscribeReady }) =>
      Effect.sync(() => {
        unsubscribeReady();
        controller.disconnect();
        toasts.dispose();
      }),
  ).pipe(Effect.andThen(Effect.never));

export const makeWatchTogetherSession = (
  options: MakeWatchTogetherSessionOptions,
): Effect.Effect<WatchTogetherSessionShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const player = options.player;
    const makeController = options.makeController ?? defaultMakeController;
    const mirror = options.mirror ?? defaultMirror();

    const state = yield* SubscriptionRef.make<SessionState>(Idle);

    let connectionFiber: Fiber.Fiber<void, never> | null = null;
    let liveController: SessionControllerLike | null = null;
    let localUser: SyncplayUser | null = null;
    let leaving = false;

    const interruptActive = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fiber = connectionFiber;
        connectionFiber = null;
        liveController = null;
        if (!fiber) return;
        yield* Fiber.interrupt(fiber);
      });

    yield* Effect.addFinalizer(() => interruptActive());

    const onParticipant = (participant: SyncplayParticipantState): void => {
      Effect.runFork(
        SubscriptionRef.update(state, (s) => {
          if (s._tag !== "Playing") return s;
          return {
            ...s,
            participants: mergeParticipant(s.participants, participant),
          };
        }),
      );
      mirror.updateParticipant(participant);
    };

    const leave = (leaveOptions: LeaveOptions): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (leaving) return;
        leaving = true;
        try {
          yield* interruptActive();
          localUser = null;
          yield* SubscriptionRef.set(state, Idle);
          if (leaveOptions.suppressAutoStart) {
            mirror.leave();
          } else {
            mirror.clear();
          }
        } finally {
          leaving = false;
        }
      });

    const startConnection = (
      room: WatchTogetherRoom,
      user: SyncplayUser,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fiber = yield* runConnection(
          {
            room,
            localUser: user,
            onParticipant,
            onFatalError: () => {
              Effect.runFork(leave({ suppressAutoStart: false }));
            },
            onController: (controller) => {
              liveController = controller;
            },
          },
          player,
          makeController,
        ).pipe(Effect.scoped, Effect.forkDetach({ startImmediately: true }));

        connectionFiber = fiber;
      });

    const startPlayback = (input: StartPlaybackInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptActive();
        localUser = input.localUser;

        const next = playing({
          room: input.room,
          item: toPlayingItem(input.item),
          participants: {},
        });
        yield* SubscriptionRef.set(state, next);
        mirror.setPlaying({
          room: input.room,
          localUser: input.localUser,
        });

        player.load(input.item, {
          resume: false,
          startPositionSeconds: input.startPositionSeconds,
        });

        yield* startConnection(input.room, input.localUser);
      });

    const swapTo = (input: SwapToInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const user = localUser;
        if (!user) return;

        yield* interruptActive();

        // Single atomic ref update: room+item swap with no intermediate state.
        yield* SubscriptionRef.update(state, (s) => {
          if (s._tag !== "Playing") {
            return playing({
              room: input.room,
              item: toPlayingItem(input.item),
              participants: {},
            });
          }
          return swapPlayingRoom(s, input.room, toPlayingItem(input.item), {});
        });
        mirror.setPlaying({ room: input.room, localUser: user });

        player.load(input.item, { resume: false });
        yield* startConnection(input.room, user);
      });

    const handleLocalPlaybackChange = (
      isPaused: boolean,
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        liveController?.handleLocalPlaybackChange(isPaused);
      });

    const handleLocalSeeked = (seconds: number): Effect.Effect<void> =>
      Effect.sync(() => {
        liveController?.handleLocalSeeked(seconds);
      });

    return {
      state,
      // beta.59: `changes` is a module function, not a ref property getter.
      changes: SubscriptionRef.changes(state),
      // Escape-hatch sync read for React/compat; SubscriptionRef.get is Effect.
      snapshot: () => Effect.runSync(SubscriptionRef.get(state)),
      startPlayback,
      swapTo,
      leave,
      handleLocalPlaybackChange,
      handleLocalSeeked,
    } satisfies WatchTogetherSessionShape;
  });

/**
 * Client-side Watch Together session owner for the Playing path.
 *
 * Effect v4 (`4.0.0-beta.59`): `Context.Service` + `Layer.effect` (scoped;
 * replaces the missing `Effect.Service` / `Layer.scoped` helpers).
 */
export class WatchTogetherSession extends Context.Service<
  WatchTogetherSession,
  WatchTogetherSessionShape
>()("WatchTogetherSession") {
  static readonly Default = Layer.effect(WatchTogetherSession)(
    Effect.gen(function* () {
      const player = yield* PlayerPort;
      return yield* makeWatchTogetherSession({ player });
    }),
  );

  /** Test layer with injectable PlayerPort + controller factory + mirror. */
  static readonly layer = (options: MakeWatchTogetherSessionOptions) =>
    Layer.effect(WatchTogetherSession)(makeWatchTogetherSession(options));
}
