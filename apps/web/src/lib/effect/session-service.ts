"use client";

import {
  DISCOVERY_POLL_MS,
  EVERYONE_JOINED_GRACE_MS,
  Idle,
  LOBBY_OBSERVER_RECONNECT_DELAY_MS,
  OBSERVER_RECONNECT_DELAY_MS,
  PRESENCE_GRACE_MS,
  RotationArmed,
  RotationNone,
  SyncplayClient,
  allInvitedPresent,
  decideLobbyAutoStart,
  decideRotation,
  getAutoAdvanceRank,
  haveMultiplexParticipantsJoined,
  isSomeoneElseWatching,
  lobby,
  mergeParticipantState,
  playing,
  rotationGathering,
  rotationNextRoom,
  rotationRoomKnown,
  swapPlayingRoom,
  type ParticipantMap,
  type PlayingItem,
  type RotationDecision,
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
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schedule,
  SubscriptionRef,
  type Scope,
} from "effect";
import type { Stream } from "effect";

import { createWatchTogetherSessionToasts } from "~/components/watch-together/watch-together-session-toasts";
import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

import { PlayerPort, type PlayerPortShape } from "./player-port";
import {
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiShape,
} from "./watch-together-api";

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

export type RotationContext = {
  readonly nextEpisode: NextEpisodeInfo | null;
  readonly autoPlayEnabled: boolean;
};

export type EnterLobbyInput = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
};

/**
 * React-derived lobby inputs the auto-start fiber cannot obtain itself
 * (media resolution + leave-mutation pending).
 */
export type LobbyContext = {
  readonly canStart: boolean;
  readonly playbackInput: null | { readonly item: MediaPlayerItem };
  readonly leaving: boolean;
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

/**
 * Silent Syncplay observer used for lobby presence and rotation gathering.
 * Lobby also supplies {@link onRoomState} for late-join playhead tracking.
 */
export type ObserverConnectionLike = {
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly setReady: (isReady: boolean | null) => void;
};

export type MakeObserverConnection = (options: {
  readonly room: Pick<
    WatchTogetherRoom,
    "id" | "syncplayHost" | "syncplayPort" | "sourceUri"
  >;
  readonly user: SyncplayUser;
  readonly onParticipant: (participant: SyncplayParticipantState) => void;
  readonly onClose: () => void;
  readonly onRoomState?: (state: {
    paused: boolean;
    positionSeconds: number;
  }) => void;
}) => ObserverConnectionLike;

export type WatchTogetherSessionShape = {
  readonly state: SubscriptionRef.SubscriptionRef<SessionState>;
  readonly changes: Stream.Stream<SessionState>;
  readonly snapshot: () => SessionState;
  /**
   * Idle→Lobby (starts presence observer + auto-start fiber). Idempotent by
   * room id while already in Lobby: refreshes the room object without
   * reconnecting. No-op while Playing (the driver owns the socket).
   */
  readonly enterLobby: (input: EnterLobbyInput) => Effect.Effect<void>;
  /** Refresh the room object on Lobby (or Playing) when the same room refetches. */
  readonly updateLobbyRoom: (room: WatchTogetherRoom) => Effect.Effect<void>;
  /** Lobby→Idle on lobby unmount/navigation. Distinct from {@link leave}. */
  readonly exitLobby: () => Effect.Effect<void>;
  readonly setLobbyContext: (ctx: LobbyContext) => Effect.Effect<void>;
  readonly startPlayback: (input: StartPlaybackInput) => Effect.Effect<void>;
  readonly swapTo: (input: SwapToInput) => Effect.Effect<void>;
  readonly leave: (options: LeaveOptions) => Effect.Effect<void>;
  readonly setRotationContext: (ctx: RotationContext) => Effect.Effect<void>;
  /** Room id whose auto-start is suppressed after a deliberate player close. */
  readonly getSuppressedRoomId: () => string | null;
  readonly handleLocalPlaybackChange: (
    isPaused: boolean,
  ) => Effect.Effect<void>;
  readonly handleLocalSeeked: (seconds: number) => Effect.Effect<void>;
};

export type MakeWatchTogetherSessionOptions = {
  readonly player: PlayerPortShape;
  readonly api?: WatchTogetherApiShape;
  readonly makeController?: MakeSessionController;
  readonly makeObserver?: MakeObserverConnection;
};

const defaultMakeController: MakeSessionController = (options) =>
  new SyncplaySessionController(options);

const defaultMakeObserver: MakeObserverConnection = (options) =>
  new SyncplayClient({
    room: options.room,
    user: options.user,
    observer: true,
    onParticipant: options.onParticipant,
    onClose: options.onClose,
    onRoomState: options.onRoomState,
  });
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

type PrefetchedMetadata = Partial<MediaPlayerItem> & {
  readonly ratingKey: string;
};

const buildNextItem = (
  currentItem: MediaPlayerItem,
  nextEpisode: NextEpisodeInfo,
  metadata: PrefetchedMetadata | null,
): MediaPlayerItem => ({
  ...currentItem,
  Media: undefined,
  ...(metadata?.ratingKey === nextEpisode.ratingKey ? metadata : undefined),
  serverId: currentItem.serverId,
  serverUrl: currentItem.serverUrl,
  authToken: currentItem.authToken,
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
});

export const makeWatchTogetherSession = (
  options: MakeWatchTogetherSessionOptions,
): Effect.Effect<WatchTogetherSessionShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    const player = options.player;
    const providedApi = options.api;
    const apiFromContext = yield* Effect.serviceOption(WatchTogetherApi);
    const api: WatchTogetherApiShape =
      providedApi ??
      Option.getOrElse(apiFromContext, () => ({
        listRooms: () => Effect.succeed([]),
        getRoom: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "getRoom",
            }),
          ),
        createRoom: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "createRoom",
            }),
          ),
        deleteRoom: () => Effect.void,
        getItemMetadata: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "getItemMetadata",
            }),
          ),
        getUserInfo: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "getUserInfo",
            }),
          ),
        createPlayQueue: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "createPlayQueue",
            }),
          ),
        getPlayQueue: () =>
          Effect.fail(
            new WatchTogetherApiError({
              cause: "WatchTogetherApi not provided",
              operation: "getPlayQueue",
            }),
          ),
      }));
    const makeController = options.makeController ?? defaultMakeController;
    const makeObserver = options.makeObserver ?? defaultMakeObserver;

    const state = yield* SubscriptionRef.make<SessionState>(Idle);
    const rotationContext = yield* Ref.make<RotationContext>({
      nextEpisode: null,
      autoPlayEnabled: false,
    });
    const lobbyContext = yield* Ref.make<LobbyContext>({
      canStart: false,
      playbackInput: null,
      leaving: false,
    });

    let connectionFiber: Fiber.Fiber<void, never> | null = null;
    let lobbyFiber: Fiber.Fiber<void, never> | null = null;
    let rotationFiber: Fiber.Fiber<void, never> | null = null;
    let liveController: SessionControllerLike | null = null;
    let localUser: SyncplayUser | null = null;
    let leaving = false;
    let swapping = false;
    let suppressedRoomId: string | null = null;

    const interruptConnection = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fiber = connectionFiber;
        connectionFiber = null;
        liveController = null;
        if (!fiber) return;
        yield* Fiber.interrupt(fiber);
      });

    const interruptLobby = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fiber = lobbyFiber;
        lobbyFiber = null;
        if (!fiber) return;
        yield* Fiber.interrupt(fiber);
      });

    const interruptRotation = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fiber = rotationFiber;
        rotationFiber = null;
        if (!fiber) return;
        yield* Fiber.interrupt(fiber);
      });

    const interruptActive = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptRotation();
        yield* interruptLobby();
        yield* interruptConnection();
      });

    yield* Effect.addFinalizer(() => interruptActive());

    const onPlayingParticipant = (
      participant: SyncplayParticipantState,
    ): void => {
      Effect.runFork(
        SubscriptionRef.update(state, (s) => {
          if (s._tag !== "Playing") return s;
          return {
            ...s,
            participants: mergeParticipantState(s.participants, participant),
          };
        }),
      );
    };

    const leave = (leaveOptions: LeaveOptions): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (leaving) return;
        leaving = true;
        try {
          const current = yield* SubscriptionRef.get(state);
          if (leaveOptions.suppressAutoStart) {
            if (current._tag === "Playing" || current._tag === "Lobby") {
              suppressedRoomId = current.room.id;
            }
          }
          yield* interruptActive();
          localUser = null;
          yield* SubscriptionRef.set(state, Idle);
          yield* Ref.set(lobbyContext, {
            canStart: false,
            playbackInput: null,
            leaving: false,
          });
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
            onParticipant: onPlayingParticipant,
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

    /**
     * Lobby presence observer + auto-start evaluation loop. Scoped children
     * (observer reconnect loop) interrupt together when the lobby fiber ends
     * (exitLobby / startPlayback / leave).
     */
    const runLobby = (
      room: WatchTogetherRoom,
      user: SyncplayUser,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        // Long-lived lobby scope: observer-callback evaluations must fork
        // grace timers here, not into a throwaway Effect.scoped that closes
        // when the callback returns (which would orphan graceFiber).
        const lobbyScope = yield* Effect.scope;
        const stickyPresent = yield* Ref.make(false);
        const hasAutoStarted = yield* Ref.make(false);
        const presentSinceMs = yield* Ref.make<number | null>(null);
        const clockMs = yield* Ref.make(0);
        let observerFiber: Fiber.Fiber<void, never> | null = null;
        let graceFiber: Fiber.Fiber<void, never> | null = null;

        const interruptChild = (
          fiber: Fiber.Fiber<void, never> | null,
        ): Effect.Effect<void> =>
          fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* interruptChild(observerFiber);
            yield* interruptChild(graceFiber);
            observerFiber = null;
            graceFiber = null;
          }),
        );

        let evaluateOnce: () => Effect.Effect<void> = () => Effect.void;

        const startLobbyObserver = (): Effect.Effect<
          void,
          never,
          Scope.Scope
        > =>
          Effect.gen(function* () {
            if (observerFiber) return;
            observerFiber = yield* Effect.gen(function* () {
              yield* Effect.forever(
                Effect.gen(function* () {
                  // Re-learn presence from scratch on every (re)connect.
                  yield* SubscriptionRef.update(state, (s) => {
                    if (s._tag !== "Lobby" || s.room.id !== room.id) return s;
                    return { ...s, participants: {} };
                  });
                  const closed = yield* Deferred.make<void>();
                  yield* Effect.scoped(
                    Effect.gen(function* () {
                      const client = yield* Effect.acquireRelease(
                        Effect.sync(() => {
                          const next = makeObserver({
                            room: {
                              id: room.id,
                              syncplayHost: room.syncplayHost,
                              syncplayPort: room.syncplayPort,
                              sourceUri: room.sourceUri,
                            },
                            user,
                            onParticipant: (participant) => {
                              Effect.runFork(
                                Effect.gen(function* () {
                                  yield* SubscriptionRef.update(state, (s) => {
                                    if (
                                      s._tag !== "Lobby" ||
                                      s.room.id !== room.id
                                    ) {
                                      return s;
                                    }
                                    return {
                                      ...s,
                                      participants: mergeParticipantState(
                                        s.participants,
                                        participant,
                                      ),
                                    };
                                  });
                                  // Do not Effect.scoped here — grace fibers
                                  // must land in lobbyScope via forkIn.
                                  yield* evaluateOnce();
                                }),
                              );
                            },
                            onRoomState: (roomState) => {
                              Effect.runFork(
                                Effect.gen(function* () {
                                  yield* SubscriptionRef.update(state, (s) => {
                                    if (
                                      s._tag !== "Lobby" ||
                                      s.room.id !== room.id
                                    ) {
                                      return s;
                                    }
                                    return {
                                      ...s,
                                      roomPositionSeconds:
                                        roomState.positionSeconds,
                                    };
                                  });
                                  yield* evaluateOnce();
                                }),
                              );
                            },
                            onClose: () => {
                              Effect.runFork(
                                Deferred.succeed(closed, undefined).pipe(
                                  Effect.ignore,
                                ),
                              );
                            },
                          });
                          next.connect();
                          next.setReady(false);
                          return next;
                        }),
                        (next) =>
                          Effect.sync(() => {
                            next.disconnect();
                          }),
                      );
                      void client;
                      yield* Deferred.await(closed);
                    }),
                  );
                  yield* Effect.sleep(
                    `${LOBBY_OBSERVER_RECONNECT_DELAY_MS} millis`,
                  );
                }),
              );
            }).pipe(Effect.forkScoped);
          });

        evaluateOnce = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (leaving) return;
            const session = yield* SubscriptionRef.get(state);
            if (session._tag !== "Lobby" || session.room.id !== room.id) {
              return;
            }

            const ctx = yield* Ref.get(lobbyContext);
            const everyoneNow = allInvitedPresent(
              session.room,
              session.participants,
              user.id,
            );

            if (everyoneNow) {
              yield* interruptChild(graceFiber);
              graceFiber = null;
              const wasSticky = yield* Ref.get(stickyPresent);
              if (!wasSticky) {
                yield* Ref.set(stickyPresent, true);
              }
            } else {
              const wasSticky = yield* Ref.get(stickyPresent);
              if (wasSticky && !graceFiber) {
                graceFiber = yield* Effect.forkIn(
                  Effect.gen(function* () {
                    yield* Effect.sleep(`${PRESENCE_GRACE_MS} millis`);
                    yield* Ref.set(stickyPresent, false);
                    yield* Ref.set(presentSinceMs, null);
                    yield* Ref.set(hasAutoStarted, false);
                    yield* evaluateOnce();
                  }),
                  lobbyScope,
                );
              }
            }

            const sticky = yield* Ref.get(stickyPresent);
            const started = yield* Ref.get(hasAutoStarted);
            const someoneElseWatching = isSomeoneElseWatching(
              session.room,
              session.participants,
              user.id,
            );
            const canStart = ctx.canStart && ctx.playbackInput !== null;
            const suppressed = suppressedRoomId === session.room.id;
            const positionOk =
              !someoneElseWatching || session.roomPositionSeconds !== null;
            const armed =
              sticky &&
              everyoneNow &&
              canStart &&
              !suppressed &&
              session.room.users.length > 1 &&
              !ctx.leaving &&
              !started &&
              positionOk;

            const now = yield* Ref.get(clockMs);
            if (armed) {
              const since = yield* Ref.get(presentSinceMs);
              if (since === null) {
                yield* Ref.set(presentSinceMs, now);
              }
            } else if (sticky && everyoneNow) {
              // Conditions not fully met yet (media pending, unknown position,
              // etc.) — keep sticky but don't accumulate delay until armed.
              yield* Ref.set(presentSinceMs, null);
            }

            const since = yield* Ref.get(presentSinceMs);
            const presentStableMs =
              armed && since !== null ? Math.max(0, now - since) : 0;

            const decision = decideLobbyAutoStart({
              room: session.room,
              participants: session.participants,
              localUserId: user.id,
              presentStableMs,
              everyonePresentSticky: sticky,
              autoStartSuppressed: suppressed,
              canStart,
              leaving: ctx.leaving,
              hasAutoStarted: started,
              roomPositionSeconds: session.roomPositionSeconds,
            });

            switch (decision.kind) {
              case "wait":
                return;
              case "rearm":
                yield* Ref.set(hasAutoStarted, false);
                yield* Ref.set(presentSinceMs, null);
                return;
              case "start": {
                const playback = ctx.playbackInput;
                if (!playback) return;
                yield* Ref.set(hasAutoStarted, true);
                // Detach so interruptActive inside startPlayback cannot cancel
                // the Lobby→Playing transition mid-flight.
                yield* startPlayback({
                  room: session.room,
                  localUser: user,
                  item: playback.item,
                  resume: false,
                  ...(decision.startPositionSeconds !== null && {
                    startPositionSeconds: decision.startPositionSeconds,
                  }),
                }).pipe(
                  Effect.forkDetach({ startImmediately: true }),
                  Effect.asVoid,
                );
                return;
              }
              default: {
                const _exhaustive: never = decision;
                return _exhaustive;
              }
            }
          });

        yield* startLobbyObserver();
        // Tick the lobby clock so presentStableMs / auto-start delay advance
        // under TestClock and wall clock alike.
        yield* Effect.gen(function* () {
          yield* evaluateOnce();
          yield* Effect.repeat(
            Effect.gen(function* () {
              yield* Ref.update(clockMs, (n) => n + 100);
              yield* evaluateOnce();
            }),
            Schedule.spaced("100 millis"),
          );
        });
      });

    // Forward declaration: runLobby's auto-start calls startPlayback, which
    // interrupts the lobby fiber — bind via suspend so the const is stable.
    let startPlaybackImpl: (
      input: StartPlaybackInput,
    ) => Effect.Effect<void> = () => Effect.void;
    const startPlayback = (input: StartPlaybackInput): Effect.Effect<void> =>
      Effect.suspend(() => startPlaybackImpl(input));

    const startLobbyFiber = (
      room: WatchTogetherRoom,
      user: SyncplayUser,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptLobby();
        const fiber = yield* runLobby(room, user).pipe(
          Effect.scoped,
          Effect.forkDetach({ startImmediately: true }),
        );
        lobbyFiber = fiber;
      });

    const enterLobby = (input: EnterLobbyInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current._tag === "Playing") {
          // Driver owns the socket; keep Playing. Still refresh room if same id.
          if (current.room.id === input.room.id) {
            yield* SubscriptionRef.set(state, {
              ...current,
              room: input.room,
            });
          }
          return;
        }
        if (current._tag === "Lobby" && current.room.id === input.room.id) {
          // Idempotent by room id: refresh room object, keep participants /
          // position / observer fiber.
          yield* SubscriptionRef.set(state, {
            ...current,
            room: input.room,
          });
          localUser = input.localUser;
          return;
        }

        yield* interruptActive();
        localUser = input.localUser;
        yield* SubscriptionRef.set(
          state,
          lobby({
            room: input.room,
            participants: {},
            roomPositionSeconds: null,
          }),
        );
        yield* startLobbyFiber(input.room, input.localUser);
      });

    const updateLobbyRoom = (room: WatchTogetherRoom): Effect.Effect<void> =>
      SubscriptionRef.update(state, (s) => {
        if (s._tag === "Lobby" && s.room.id === room.id) {
          return { ...s, room };
        }
        if (s._tag === "Playing" && s.room.id === room.id) {
          return { ...s, room };
        }
        return s;
      });

    const exitLobby = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current._tag !== "Lobby") return;
        yield* interruptLobby();
        localUser = null;
        yield* SubscriptionRef.set(state, Idle);
        yield* Ref.set(lobbyContext, {
          canStart: false,
          playbackInput: null,
          leaving: false,
        });
      });

    const setLobbyContext = (ctx: LobbyContext): Effect.Effect<void> =>
      Ref.set(lobbyContext, ctx);

    const updateRotationPhase = (
      update: (
        phase: Extract<SessionState, { _tag: "Playing" }>["rotation"],
      ) => Extract<SessionState, { _tag: "Playing" }>["rotation"],
    ): Effect.Effect<void> =>
      SubscriptionRef.update(state, (s) => {
        if (s._tag !== "Playing") return s;
        return { ...s, rotation: update(s.rotation) };
      });

    /**
     * Rotation protocol for one Playing lifetime. Child fibers (discovery,
     * create, observer, grace, eval) are scoped to this fiber and interrupt
     * together on leave / swap / disabled.
     */
    const runRotation = (
      user: SyncplayUser,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const visibleRooms = yield* Ref.make<ReadonlyArray<WatchTogetherRoom>>(
          [],
        );
        const graceElapsed = yield* Ref.make(false);
        const hasAttemptedCreate = yield* Ref.make(false);
        const gatheredParticipants = yield* Ref.make<ParticipantMap>({});
        const prefetchedMetadata = yield* Ref.make<PrefetchedMetadata | null>(
          null,
        );

        let createFiber: Fiber.Fiber<void, never> | null = null;
        let discoveryFiber: Fiber.Fiber<void, never> | null = null;
        let observerFiber: Fiber.Fiber<void, never> | null = null;
        let graceFiber: Fiber.Fiber<void, never> | null = null;
        let prefetchFiber: Fiber.Fiber<void, never> | null = null;
        /** ratingKey the in-flight / completed prefetch was launched for. */
        let prefetchTargetKey: string | null = null;

        const interruptChild = (
          fiber: Fiber.Fiber<void, never> | null,
        ): Effect.Effect<void> =>
          fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;

        const stopCreate = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(createFiber);
            createFiber = null;
          });

        const stopDiscovery = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(discoveryFiber);
            discoveryFiber = null;
          });

        const stopObserver = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(observerFiber);
            observerFiber = null;
          });

        const stopGrace = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(graceFiber);
            graceFiber = null;
          });

        const stopPrefetch = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(prefetchFiber);
            prefetchFiber = null;
            prefetchTargetKey = null;
          });

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* stopCreate();
            yield* stopDiscovery();
            yield* stopObserver();
            yield* stopGrace();
            yield* stopPrefetch();
          }),
        );

        // Assigned after executeDecision; helpers close over the mutable binding.
        // Child helpers use Scope because they forkScoped; the rotation fiber
        // itself is already Effect.scoped.
        type ScopedVoid = Effect.Effect<void, never, Scope.Scope>;
        let evaluateOnce: () => ScopedVoid = () => Effect.void;

        const ensureDiscovery = (): ScopedVoid =>
          Effect.gen(function* () {
            if (discoveryFiber) return;
            discoveryFiber = yield* Effect.gen(function* () {
              yield* Effect.repeat(
                Effect.gen(function* () {
                  const rooms = yield* api
                    .listRooms()
                    .pipe(Effect.orElseSucceed(() => []));
                  yield* Ref.set(visibleRooms, rooms);
                  yield* evaluateOnce();
                }),
                Schedule.spaced(`${DISCOVERY_POLL_MS} millis`),
              );
            }).pipe(Effect.forkScoped);
          });

        const ensurePrefetch = (
          nextEpisode: NextEpisodeInfo,
          serverId: string,
        ): ScopedVoid =>
          Effect.gen(function* () {
            // Same target already in flight or completed — keep it.
            if (prefetchTargetKey === nextEpisode.ratingKey) return;
            // Target changed (or first launch): interrupt any stale fiber and
            // discard mismatched metadata before relaunching.
            yield* interruptChild(prefetchFiber);
            prefetchFiber = null;
            prefetchTargetKey = nextEpisode.ratingKey;
            yield* Ref.set(prefetchedMetadata, null);
            prefetchFiber = yield* Effect.gen(function* () {
              const meta = yield* api
                .getItemMetadata({
                  serverId,
                  ratingKey: nextEpisode.ratingKey,
                })
                .pipe(Effect.option);
              const value = Option.getOrUndefined(meta);
              if (value?.ratingKey === nextEpisode.ratingKey) {
                yield* Ref.set(prefetchedMetadata, value as PrefetchedMetadata);
              }
            }).pipe(
              Effect.catch(() => Effect.void),
              // Clear the fiber ref on completion so a later same-key call can
              // re-check; target key stays so we don't refetch needlessly.
              Effect.ensuring(
                Effect.sync(() => {
                  prefetchFiber = null;
                }),
              ),
              Effect.forkScoped,
            );
          });

        const startCreate = (
          afterMs: number,
          nextEpisode: NextEpisodeInfo,
          currentRoom: WatchTogetherRoom,
          serverId: string,
        ): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopCreate();
            yield* Ref.set(hasAttemptedCreate, true);
            createFiber = yield* Effect.gen(function* () {
              yield* Effect.sleep(`${afterMs} millis`);
              const result = yield* api
                .createRoom({
                  serverId,
                  ratingKey: nextEpisode.ratingKey,
                  key: nextEpisode.key,
                  title: nextEpisode.title || `Episode ${nextEpisode.index}`,
                  users: currentRoom.users
                    .map((u) => u.id)
                    .filter((id) => id !== user.id),
                })
                .pipe(Effect.exit);
              // Room is adopted via discovery, not the create response.
              if (Exit.isFailure(result)) {
                yield* Ref.set(hasAttemptedCreate, false);
                yield* evaluateOnce();
              }
            }).pipe(Effect.forkScoped);
          });

        const startObserver = (nextRoom: WatchTogetherRoom): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopObserver();
            yield* Ref.set(gatheredParticipants, {});
            observerFiber = yield* Effect.gen(function* () {
              yield* Effect.forever(
                Effect.gen(function* () {
                  // Re-learn presence from scratch on every (re)connect: leaves
                  // while the socket was down never produced an isPresent:false.
                  yield* Ref.set(gatheredParticipants, {});
                  yield* updateRotationPhase((phase) => {
                    if (phase._tag !== "Gathering") return phase;
                    if (phase.nextRoom.id !== nextRoom.id) return phase;
                    return rotationGathering(phase.nextRoom, new Set());
                  });
                  const closed = yield* Deferred.make<void>();
                  // Per-connection scope so disconnect runs on close/reconnect,
                  // not only when the whole observer fiber is interrupted.
                  yield* Effect.scoped(
                    Effect.gen(function* () {
                      const client = yield* Effect.acquireRelease(
                        Effect.sync(() => {
                          const next = makeObserver({
                            room: {
                              id: nextRoom.id,
                              syncplayHost: nextRoom.syncplayHost,
                              syncplayPort: nextRoom.syncplayPort,
                              sourceUri: nextRoom.sourceUri,
                            },
                            user,
                            onParticipant: (participant) => {
                              Effect.runFork(
                                Effect.gen(function* () {
                                  const gathered = yield* Ref.updateAndGet(
                                    gatheredParticipants,
                                    (prev) =>
                                      mergeParticipantState(prev, participant),
                                  );
                                  yield* updateRotationPhase((phase) => {
                                    if (phase._tag !== "Gathering")
                                      return phase;
                                    if (phase.nextRoom.id !== nextRoom.id) {
                                      return phase;
                                    }
                                    return rotationGathering(
                                      phase.nextRoom,
                                      new Set(
                                        Object.entries(gathered)
                                          .filter(
                                            ([, p]) => p.isPresent === true,
                                          )
                                          .map(([id]) => id),
                                      ),
                                    );
                                  });
                                  // runFork is outside the rotation Scope; re-scope.
                                  yield* evaluateOnce().pipe(Effect.scoped);
                                }),
                              );
                            },
                            onClose: () => {
                              Effect.runFork(
                                Deferred.succeed(closed, undefined).pipe(
                                  Effect.ignore,
                                ),
                              );
                            },
                          });
                          next.connect();
                          next.setReady(false);
                          return next;
                        }),
                        (next) =>
                          Effect.sync(() => {
                            next.disconnect();
                          }),
                      );
                      void client;
                      yield* Deferred.await(closed);
                    }),
                  );
                  yield* Effect.sleep(`${OBSERVER_RECONNECT_DELAY_MS} millis`);
                }),
              );
            }).pipe(Effect.forkScoped);
          });

        const startGrace = (): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopGrace();
            yield* Ref.set(graceElapsed, false);
            graceFiber = yield* Effect.gen(function* () {
              yield* Effect.sleep(`${EVERYONE_JOINED_GRACE_MS} millis`);
              yield* Ref.set(graceElapsed, true);
              yield* evaluateOnce();
            }).pipe(Effect.forkScoped);
          });

        const adoptRoom = (room: WatchTogetherRoom): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* stopCreate();
            yield* stopObserver();
            yield* stopGrace();
            yield* Ref.set(hasAttemptedCreate, true);
            yield* Ref.set(graceElapsed, false);
            yield* Ref.set(gatheredParticipants, {});
            yield* updateRotationPhase(() => rotationRoomKnown(room));
          });

        const performSwap = (
          nextRoom: WatchTogetherRoom,
          nextEpisode: NextEpisodeInfo,
        ): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (swapping) return;
            const current = yield* SubscriptionRef.get(state);
            if (current._tag !== "Playing") return;

            const currentItem = player.currentItem();
            if (!currentItem) return;

            const metadata = yield* Ref.get(prefetchedMetadata);
            const nextItem = buildNextItem(currentItem, nextEpisode, metadata);
            const previousRoomId = current.room.id;

            swapping = true;
            // Fork so swapTo's interrupt of this rotation fiber cannot cancel
            // the atomic swap or the best-effort previous-room delete.
            yield* Effect.gen(function* () {
              try {
                yield* swapTo({ room: nextRoom, item: nextItem });
                yield* api.deleteRoom(previousRoomId).pipe(Effect.ignore);
              } finally {
                swapping = false;
              }
            }).pipe(
              Effect.forkDetach({ startImmediately: true }),
              Effect.asVoid,
            );
          });

        const executeDecision = (
          decision: RotationDecision,
          ctx: {
            readonly nextEpisode: NextEpisodeInfo;
            readonly currentRoom: WatchTogetherRoom;
            readonly serverId: string;
          },
        ): ScopedVoid => {
          switch (decision.kind) {
            case "wait":
              return Effect.void;
            case "disabled":
              return Effect.gen(function* () {
                yield* stopCreate();
                yield* stopDiscovery();
                yield* stopObserver();
                yield* stopGrace();
                yield* stopPrefetch();
                yield* updateRotationPhase(() => RotationNone);
                yield* Ref.set(hasAttemptedCreate, false);
                yield* Ref.set(graceElapsed, false);
                yield* Ref.set(gatheredParticipants, {});
                yield* Ref.set(visibleRooms, []);
                yield* Ref.set(prefetchedMetadata, null);
              });
            case "arm":
              return Effect.gen(function* () {
                yield* Ref.set(hasAttemptedCreate, false);
                yield* Ref.set(graceElapsed, false);
                yield* Ref.set(gatheredParticipants, {});
                // Keep prefetch across re-arm when nextEpisode is unchanged;
                // ensurePrefetch interrupts/relaunches if the key changed.
                yield* updateRotationPhase(() => RotationArmed);
                yield* ensureDiscovery();
                yield* ensurePrefetch(ctx.nextEpisode, ctx.serverId);
                yield* evaluateOnce();
              });
            case "create_room":
              return Effect.gen(function* () {
                yield* ensureDiscovery();
                yield* startCreate(
                  decision.afterMs,
                  ctx.nextEpisode,
                  ctx.currentRoom,
                  ctx.serverId,
                );
              });
            case "adopt_room":
              return Effect.gen(function* () {
                yield* ensureDiscovery();
                yield* ensurePrefetch(ctx.nextEpisode, ctx.serverId);
                yield* adoptRoom(decision.room);
                yield* evaluateOnce();
              });
            case "begin_gathering":
              return Effect.gen(function* () {
                const snap = yield* SubscriptionRef.get(state);
                if (snap._tag !== "Playing") return;
                const nextRoom = rotationNextRoom(snap.rotation);
                if (!nextRoom) return;
                yield* updateRotationPhase(() =>
                  rotationGathering(nextRoom, new Set()),
                );
                yield* startObserver(nextRoom);
                yield* startGrace();
              });
            case "swap":
              return Effect.gen(function* () {
                const snap = yield* SubscriptionRef.get(state);
                if (snap._tag !== "Playing") return;
                const nextRoom = rotationNextRoom(snap.rotation);
                if (!nextRoom) return;
                yield* performSwap(nextRoom, ctx.nextEpisode);
              });
            default: {
              const _exhaustive: never = decision;
              return _exhaustive;
            }
          }
        };

        evaluateOnce = (): ScopedVoid =>
          Effect.gen(function* () {
            if (swapping || leaving) return;

            const session = yield* SubscriptionRef.get(state);
            if (session._tag !== "Playing") return;

            const ctx = yield* Ref.get(rotationContext);
            const nextEpisode = ctx.nextEpisode;
            if (!nextEpisode || !ctx.autoPlayEnabled) {
              if (session.rotation._tag !== "None") {
                yield* executeDecision(
                  { kind: "disabled" },
                  {
                    nextEpisode: nextEpisode ?? {
                      ratingKey: "",
                      key: "",
                      title: "",
                      index: 0,
                      parentIndex: 0,
                    },
                    currentRoom: session.room,
                    serverId: session.item.serverId,
                  },
                );
              }
              return;
            }

            // Keep prefetch aligned with the current next episode even when
            // the phase is already past arm (setRotationContext can change
            // nextEpisode mid-rotation without re-emitting "arm").
            if (session.rotation._tag !== "None") {
              yield* ensurePrefetch(nextEpisode, session.item.serverId);
            }

            const snap = player.snapshot();
            const durationSeconds = snap.durationSeconds;
            const currentTimeSeconds = snap.currentTimeSeconds;
            const timeRemainingSeconds =
              durationSeconds > 0
                ? durationSeconds - currentTimeSeconds
                : Number.POSITIVE_INFINITY;

            const rooms = yield* Ref.get(visibleRooms);
            const gathered = yield* Ref.get(gatheredParticipants);
            const grace = yield* Ref.get(graceElapsed);
            const attempted = yield* Ref.get(hasAttemptedCreate);
            const rank = getAutoAdvanceRank(session.participants, user);
            const everyoneJoined = haveMultiplexParticipantsJoined(
              session.participants,
              gathered,
              user,
            );

            const decision = decideRotation({
              phase: session.rotation,
              timeRemainingSeconds,
              durationSeconds,
              currentTimeSeconds,
              rank,
              visibleRooms: rooms,
              everyoneJoined,
              graceElapsed: grace,
              autoPlayEnabled: ctx.autoPlayEnabled,
              serverId: session.item.serverId,
              nextRatingKey: nextEpisode.ratingKey,
              currentRoom: session.room,
              hasAttemptedCreate: attempted,
            });

            yield* executeDecision(decision, {
              nextEpisode,
              currentRoom: session.room,
              serverId: session.item.serverId,
            });
          });

        // ~1s cadence; player time updates arrive ~4Hz but decisions are
        // threshold-based so sub-second precision is unnecessary.
        yield* evaluateOnce().pipe(Effect.repeat(Schedule.spaced("1 second")));
      });

    const startRotation = (user: SyncplayUser): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptRotation();
        const fiber = yield* runRotation(user).pipe(
          Effect.scoped,
          Effect.forkDetach({ startImmediately: true }),
        );
        rotationFiber = fiber;
      });

    const maybeStartRotation = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const user = localUser;
        if (!user) return;
        const session = yield* SubscriptionRef.get(state);
        if (session._tag !== "Playing") return;
        const ctx = yield* Ref.get(rotationContext);
        if (!ctx.autoPlayEnabled || !ctx.nextEpisode) {
          yield* interruptRotation();
          if (session.rotation._tag !== "None") {
            yield* updateRotationPhase(() => RotationNone);
          }
          return;
        }
        if (!rotationFiber) {
          yield* startRotation(user);
        }
      });

    startPlaybackImpl = (input: StartPlaybackInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptActive();
        localUser = input.localUser;
        // Starting a session clears auto-start suppression (matches old store).
        suppressedRoomId = null;

        const next = playing({
          room: input.room,
          item: toPlayingItem(input.item),
          participants: {},
        });
        yield* SubscriptionRef.set(state, next);

        player.load(input.item, {
          resume: false,
          startPositionSeconds: input.startPositionSeconds,
        });

        yield* startConnection(input.room, input.localUser);
        yield* maybeStartRotation();
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

        player.load(input.item, { resume: false });
        yield* startConnection(input.room, user);
        yield* maybeStartRotation();
      });

    const setRotationContext = (ctx: RotationContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.set(rotationContext, ctx);
        yield* maybeStartRotation();
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
      enterLobby,
      updateLobbyRoom,
      exitLobby,
      setLobbyContext,
      startPlayback,
      swapTo,
      leave,
      setRotationContext,
      getSuppressedRoomId: () => suppressedRoomId,
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
      const api = yield* WatchTogetherApi;
      return yield* makeWatchTogetherSession({ player, api });
    }),
  );

  /** Test layer with injectable PlayerPort + controller factory + mirror. */
  static readonly layer = (options: MakeWatchTogetherSessionOptions) =>
    Layer.effect(WatchTogetherSession)(makeWatchTogetherSession(options));
}
