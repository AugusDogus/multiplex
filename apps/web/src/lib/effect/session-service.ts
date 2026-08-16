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
  findNextEpisodeRoom,
  getAutoAdvanceRank,
  getPartyProgressSeconds,
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
  type LobbyStartPolicy,
  type PlayingItem,
  type RotationDecision,
  type SessionState,
  SyncplaySessionController,
  type SyncplayParticipantState,
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
  Semaphore,
  SubscriptionRef,
  type Scope,
} from "effect";

import { createWatchTogetherSessionToasts } from "~/components/watch-together/watch-together-session-toasts";
import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

import { PlayerPort, type PlayerPortContract } from "./player-port";
import {
  cohortDeviceIds,
  runConnection,
  type MakeSessionController,
  type SessionControllerLike,
} from "./session-connection";
import {
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiContract,
} from "./watch-together-api";

export type {
  MakeSessionController,
  SessionControllerLike,
} from "./session-connection";

export type StartPlaybackInput = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
  readonly item: MediaPlayerItem;
  readonly resume?: false;
  readonly startPositionSeconds?: number;
  /** Reject a detached auto-start after its Lobby lifetime was replaced. */
  readonly expectedLobby?: {
    readonly generation: number;
    readonly roomId: string;
  };
};

export type SwapToInput = {
  readonly room: WatchTogetherRoom;
  readonly item: MediaPlayerItem;
  /** Reject a detached rotation after another lifecycle command took over. */
  readonly expectedCurrent?: {
    readonly roomId: string;
    readonly serverId: string;
    readonly ratingKey: string;
  };
};

const ROTATION_CREATE_RETRY_MS = 1_000;

const roomConnectionChanged = (
  current: WatchTogetherRoom,
  next: WatchTogetherRoom,
): boolean =>
  current.syncplayHost !== next.syncplayHost ||
  current.syncplayPort !== next.syncplayPort ||
  current.sourceUri !== next.sourceUri;

export type LeaveOptions = {
  readonly suppressAutoStart: boolean;
  /** Ignore cleanup belonging to a room that has already been replaced. */
  readonly expectedRoomId?: string;
};

export type ExitLobbyOptions = {
  /** Ignore cleanup belonging to a room that has already been replaced. */
  readonly expectedRoomId?: string;
};

const REPLACEMENT_PREPARATION_TIMEOUT = "2 seconds";

export type RotationContext = {
  readonly nextEpisode: NextEpisodeInfo | null;
  readonly autoPlayEnabled: boolean;
};

export type EnterLobbyInput = {
  readonly room: WatchTogetherRoom;
  readonly localUser: SyncplayUser;
  readonly startPolicy?: LobbyStartPolicy;
};

/**
 * React-derived lobby inputs the auto-start fiber cannot obtain itself
 * (tRPC media resolution + leave-mutation pending).
 */
export type LobbyContext = {
  readonly canStart: boolean;
  readonly playbackInput: null | { readonly item: MediaPlayerItem };
  readonly leaving: boolean;
};

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

export type WatchTogetherSessionContract = {
  readonly state: SubscriptionRef.SubscriptionRef<SessionState>;
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
  readonly exitLobby: (options?: ExitLobbyOptions) => Effect.Effect<void>;
  readonly setLobbyContext: (ctx: LobbyContext) => Effect.Effect<void>;
  readonly startPlayback: (input: StartPlaybackInput) => Effect.Effect<boolean>;
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
  readonly player: PlayerPortContract;
  readonly api?: WatchTogetherApiContract;
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

const canInitiateStartupPlayback = (
  room: WatchTogetherRoom,
  user: SyncplayUser,
  policy: LobbyStartPolicy,
): boolean => {
  if (policy._tag === "HostControlled") {
    return policy.localRole === "Host";
  }

  const participantIds = room.users.map((participant) => participant.id);
  return user.id === Math.min(user.id, ...participantIds);
};

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
): Effect.Effect<WatchTogetherSessionContract, never, Scope.Scope> =>
  Effect.gen(function* () {
    const player = options.player;
    const providedApi = options.api;
    const apiFromContext = yield* Effect.serviceOption(WatchTogetherApi);
    const api: WatchTogetherApiContract =
      providedApi ??
      Option.getOrElse(apiFromContext, () => ({
        listRooms: () => Effect.succeed([]),
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
    const lifecycleSemaphore = yield* Semaphore.make(1);

    const serializeLifecycle = <A>(
      effect: Effect.Effect<A>,
    ): Effect.Effect<A> => lifecycleSemaphore.withPermits(1)(effect);

    let connectionFiber: Fiber.Fiber<void, never> | null = null;
    let lobbyFiber: Fiber.Fiber<void, never> | null = null;
    let rotationFiber: Fiber.Fiber<void, never> | null = null;
    let liveController: SessionControllerLike | null = null;
    let localUser: SyncplayUser | null = null;
    let leaving = false;
    let swapping = false;
    let suppressedRoomId: string | null = null;
    let lifecycleGeneration = 0;

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
      generation: number,
      roomId: string,
    ): void => {
      Effect.runFork(
        serializeLifecycle(
          Effect.gen(function* () {
            if (lifecycleGeneration !== generation) return;
            yield* SubscriptionRef.update(state, (s) => {
              if (s._tag !== "Playing" || s.room.id !== roomId) return s;
              return {
                ...s,
                participants: mergeParticipantState(
                  s.participants,
                  participant,
                ),
              };
            });
          }),
        ),
      );
    };

    const leaveImpl = (leaveOptions: LeaveOptions): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (leaving) return;
        if (leaveOptions.expectedRoomId) {
          const current = yield* SubscriptionRef.get(state);
          if (
            current._tag === "Idle" ||
            current.room.id !== leaveOptions.expectedRoomId
          ) {
            return;
          }
        }
        leaving = true;
        try {
          lifecycleGeneration += 1;
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
    const leave = (leaveOptions: LeaveOptions): Effect.Effect<void> =>
      serializeLifecycle(leaveImpl(leaveOptions));
    const leaveIfGeneration = (
      generation: number,
      leaveOptions: LeaveOptions,
    ): Effect.Effect<void> =>
      serializeLifecycle(
        Effect.gen(function* () {
          if (lifecycleGeneration !== generation) return;
          yield* leaveImpl(leaveOptions);
        }),
      );

    const isPresenceHandoff = (): boolean => {
      const current = Effect.runSync(SubscriptionRef.get(state));
      return current._tag === "Playing" && current.rotation._tag !== "None";
    };

    const startConnection = (
      room: WatchTogetherRoom,
      user: SyncplayUser,
      generation: number,
      startPolicy: LobbyStartPolicy,
      initialCohortDeviceIds?: ReadonlySet<string>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const notifications = createWatchTogetherSessionToasts({
          room,
          localUser: user,
          initialCohortDeviceIds,
          // Presence mute derives from Playing.rotation — no parallel flag.
          isPresenceHandoff,
        });
        const fiber = yield* runConnection(
          {
            room,
            localUser: user,
            canInitiateStartupPlayback: canInitiateStartupPlayback(
              room,
              user,
              startPolicy,
            ),
            isCurrent: () => lifecycleGeneration === generation,
            notifications,
            onParticipant: (participant) => {
              onPlayingParticipant(participant, generation, room.id);
            },
            onFatalError: () => {
              Effect.runFork(
                leaveIfGeneration(generation, { suppressAutoStart: false }),
              );
            },
            onController: (controller) => {
              if (lifecycleGeneration !== generation) return;
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
      generation: number,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        // Callback evaluations fork grace work into the lobby lifetime.
        const lobbyScope = yield* Effect.scope;
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
                    if (
                      lifecycleGeneration !== generation ||
                      s._tag !== "Lobby" ||
                      s.room.id !== room.id
                    ) {
                      return s;
                    }
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
                                  if (lifecycleGeneration !== generation) {
                                    return;
                                  }
                                  yield* SubscriptionRef.update(state, (s) => {
                                    if (
                                      lifecycleGeneration !== generation ||
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
                                  yield* evaluateOnce();
                                }),
                              );
                            },
                            onRoomState: (roomState) => {
                              Effect.runFork(
                                Effect.gen(function* () {
                                  if (lifecycleGeneration !== generation) {
                                    return;
                                  }
                                  yield* SubscriptionRef.update(state, (s) => {
                                    if (
                                      lifecycleGeneration !== generation ||
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
            if (leaving || lifecycleGeneration !== generation) return;
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

            if (
              session.startPolicy._tag === "AllInvitedPresent" &&
              everyoneNow
            ) {
              yield* interruptChild(graceFiber);
              graceFiber = null;
              if (!session.everyonePresentSticky) {
                yield* SubscriptionRef.update(state, (s) =>
                  lifecycleGeneration === generation &&
                  s._tag === "Lobby" &&
                  s.room.id === room.id
                    ? { ...s, everyonePresentSticky: true }
                    : s,
                );
              }
            } else if (session.startPolicy._tag === "AllInvitedPresent") {
              if (session.everyonePresentSticky && !graceFiber) {
                graceFiber = yield* Effect.forkIn(
                  Effect.gen(function* () {
                    yield* Effect.sleep(`${PRESENCE_GRACE_MS} millis`);
                    yield* SubscriptionRef.update(state, (s) =>
                      lifecycleGeneration === generation &&
                      s._tag === "Lobby" &&
                      s.room.id === room.id
                        ? { ...s, everyonePresentSticky: false }
                        : s,
                    );
                    yield* Ref.set(presentSinceMs, null);
                    yield* Ref.set(hasAutoStarted, false);
                    yield* evaluateOnce();
                  }),
                  lobbyScope,
                );
              }
            }

            const sticky = everyoneNow ? true : session.everyonePresentSticky;
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
            const policy = session.startPolicy;
            const hostReady =
              policy._tag === "HostControlled" &&
              policy.localRole === "Guest" &&
              Object.values(session.participants).some(
                (participant) =>
                  participant.user.id === policy.hostUserId &&
                  participant.isReady === true,
              );
            const armed =
              session.startPolicy._tag === "HostControlled"
                ? hostReady &&
                  canStart &&
                  !suppressed &&
                  !ctx.leaving &&
                  !started &&
                  session.roomPositionSeconds !== null
                : sticky &&
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
            } else {
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
              startPolicy: session.startPolicy,
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
                  expectedLobby: {
                    generation,
                    roomId: room.id,
                  },
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
    ) => Effect.Effect<boolean> = () => Effect.succeed(false);
    const startPlayback = (input: StartPlaybackInput): Effect.Effect<boolean> =>
      serializeLifecycle(Effect.suspend(() => startPlaybackImpl(input)));

    const startLobbyFiber = (
      room: WatchTogetherRoom,
      user: SyncplayUser,
      generation: number,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* interruptLobby();
        const fiber = yield* runLobby(room, user, generation).pipe(
          Effect.scoped,
          Effect.forkDetach({ startImmediately: true }),
        );
        lobbyFiber = fiber;
      });

    const enterLobby = (input: EnterLobbyInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (current._tag === "Playing") {
          // Driver owns the socket; keep Playing. A cached room can initially
          // carry an empty/stale endpoint, so reconnect when authoritative
          // room data changes the connection identity.
          if (current.room.id === input.room.id) {
            const reconnect = roomConnectionChanged(current.room, input.room);
            const next = {
              ...current,
              room: input.room,
              participants: reconnect ? {} : current.participants,
              startPolicy: input.startPolicy ?? current.startPolicy,
            };
            yield* SubscriptionRef.set(state, next);
            localUser = input.localUser;
            if (reconnect) {
              lifecycleGeneration += 1;
              const generation = lifecycleGeneration;
              yield* interruptConnection();
              yield* startConnection(
                input.room,
                input.localUser,
                generation,
                next.startPolicy,
              );
            }
          }
          return;
        }
        if (current._tag === "Lobby" && current.room.id === input.room.id) {
          const reconnect = roomConnectionChanged(current.room, input.room);
          // Idempotent for metadata-only refreshes. A connection change starts
          // a fresh observer and discards presence learned from the old socket.
          yield* SubscriptionRef.set(state, {
            ...current,
            room: input.room,
            participants: reconnect ? {} : current.participants,
            roomPositionSeconds: reconnect ? null : current.roomPositionSeconds,
            startPolicy: input.startPolicy ?? current.startPolicy,
          });
          localUser = input.localUser;
          if (reconnect) {
            lifecycleGeneration += 1;
            const generation = lifecycleGeneration;
            yield* startLobbyFiber(input.room, input.localUser, generation);
          }
          return;
        }

        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        yield* interruptActive();
        localUser = input.localUser;
        yield* SubscriptionRef.set(
          state,
          lobby({
            room: input.room,
            participants: {},
            roomPositionSeconds: null,
            startPolicy: input.startPolicy,
          }),
        );
        yield* startLobbyFiber(input.room, input.localUser, generation);
      }).pipe(serializeLifecycle);

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

    const exitLobby = (options?: ExitLobbyOptions): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (
          current._tag !== "Lobby" ||
          (options?.expectedRoomId &&
            current.room.id !== options.expectedRoomId)
        ) {
          return;
        }
        lifecycleGeneration += 1;
        yield* interruptLobby();
        localUser = null;
        yield* SubscriptionRef.set(state, Idle);
        yield* Ref.set(lobbyContext, {
          canStart: false,
          playbackInput: null,
          leaving: false,
        });
      }).pipe(serializeLifecycle);

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
        // Callback evaluations fork replacement work into the rotation lifetime.
        const rotationScope = yield* Effect.scope;
        const visibleRooms = yield* Ref.make<ReadonlyArray<WatchTogetherRoom>>(
          [],
        );
        const discoveryRevision = yield* Ref.make(0);
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
        let pendingCreateRank: number | null = null;
        let prefetchTargetKey: string | null = null;
        let rotationTargetKey: string | null = null;
        let invalidRoomMissRevision: number | null = null;

        const interruptChild = (
          fiber: Fiber.Fiber<void, never> | null,
        ): Effect.Effect<void> =>
          fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;

        const stopCreate = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            yield* interruptChild(createFiber);
            createFiber = null;
            pendingCreateRank = null;
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
        type ScopedVoid = Effect.Effect<void>;
        let evaluateOnce: () => ScopedVoid = () => Effect.void;

        const ensureDiscovery = (): ScopedVoid =>
          Effect.gen(function* () {
            if (discoveryFiber) return;
            discoveryFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                yield* Effect.repeat(
                  Effect.gen(function* () {
                    const result = yield* api.listRooms().pipe(Effect.option);
                    if (Option.isSome(result)) {
                      yield* Ref.set(visibleRooms, result.value);
                      yield* Ref.update(
                        discoveryRevision,
                        (revision) => revision + 1,
                      );
                    }
                    yield* evaluateOnce();
                  }),
                  Schedule.spaced(`${DISCOVERY_POLL_MS} millis`),
                );
              }),
              rotationScope,
            );
          });

        const ensurePrefetch = (
          nextEpisode: NextEpisodeInfo,
          serverId: string,
        ): ScopedVoid =>
          Effect.gen(function* () {
            if (prefetchTargetKey === nextEpisode.ratingKey) return;
            yield* interruptChild(prefetchFiber);
            prefetchFiber = null;
            prefetchTargetKey = nextEpisode.ratingKey;
            yield* Ref.set(prefetchedMetadata, null);
            prefetchFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                const meta = yield* api
                  .getItemMetadata({
                    serverId,
                    ratingKey: nextEpisode.ratingKey,
                  })
                  .pipe(Effect.option);
                const value = Option.getOrUndefined(meta);
                if (value?.ratingKey === nextEpisode.ratingKey) {
                  yield* Ref.set(
                    prefetchedMetadata,
                    value as PrefetchedMetadata,
                  );
                }
              }).pipe(
                Effect.catch(() => Effect.void),
                Effect.ensuring(
                  Effect.sync(() => {
                    prefetchFiber = null;
                  }),
                ),
              ),
              rotationScope,
            );
          });

        const startCreate = (
          afterMs: number,
          nextEpisode: NextEpisodeInfo,
          currentRoom: WatchTogetherRoom,
          serverId: string,
          rank: number,
        ): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopCreate();
            yield* Ref.set(hasAttemptedCreate, true);
            pendingCreateRank = rank;
            const createGeneration = lifecycleGeneration;
            createFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                yield* Effect.sleep(`${afterMs} millis`);
                pendingCreateRank = null;
                const result = yield* api
                  .createRoom({
                    serverId,
                    ratingKey: nextEpisode.ratingKey,
                    key: nextEpisode.key,
                    title: nextEpisode.title || `Episode ${nextEpisode.index}`,
                    users: currentRoom.users.flatMap((roomUser) =>
                      roomUser.id === user.id ? [] : [roomUser.id],
                    ),
                  })
                  .pipe(Effect.exit);
                createFiber = null;
                if (Exit.isFailure(result)) {
                  yield* Effect.sleep(`${ROTATION_CREATE_RETRY_MS} millis`);
                  yield* Ref.set(hasAttemptedCreate, false);
                  yield* evaluateOnce();
                  return;
                }

                const session = yield* SubscriptionRef.get(state);
                const ctx = yield* Ref.get(rotationContext);
                if (
                  lifecycleGeneration !== createGeneration ||
                  session._tag !== "Playing" ||
                  session.room.id !== currentRoom.id ||
                  session.item.serverId !== serverId ||
                  rotationTargetKey !== nextEpisode.ratingKey ||
                  ctx.nextEpisode?.ratingKey !== nextEpisode.ratingKey ||
                  !ctx.autoPlayEnabled
                ) {
                  return;
                }

                const createdRoom = findNextEpisodeRoom({
                  rooms: [result.value],
                  serverId,
                  nextRatingKey: nextEpisode.ratingKey,
                  currentRoom: session.room,
                });
                if (!createdRoom) {
                  yield* Effect.sleep(`${ROTATION_CREATE_RETRY_MS} millis`);
                  yield* Ref.set(hasAttemptedCreate, false);
                  yield* evaluateOnce();
                  return;
                }

                // Treat the validated create response as immediate local
                // discovery. Polling stays active and can replace it with the
                // deterministic winner if another client raced this create.
                yield* Ref.update(visibleRooms, (rooms) => [
                  createdRoom,
                  ...rooms.filter((room) => room.id !== createdRoom.id),
                ]);
                yield* adoptRoom(createdRoom);
                invalidRoomMissRevision = null;
                yield* evaluateOnce();
              }),
              rotationScope,
            );
          });

        const startObserver = (nextRoom: WatchTogetherRoom): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopObserver();
            yield* Ref.set(gatheredParticipants, {});
            observerFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
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
                                    const session =
                                      yield* SubscriptionRef.get(state);
                                    if (
                                      session._tag !== "Playing" ||
                                      rotationNextRoom(session.rotation)?.id !==
                                        nextRoom.id
                                    ) {
                                      // A replaced room can still deliver a queued callback.
                                      return;
                                    }
                                    const gathered = yield* Ref.updateAndGet(
                                      gatheredParticipants,
                                      (prev) =>
                                        mergeParticipantState(
                                          prev,
                                          participant,
                                        ),
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
                                          Object.entries(gathered).flatMap(
                                            ([id, participantState]) =>
                                              participantState.isPresent ===
                                              true
                                                ? [id]
                                                : [],
                                          ),
                                        ),
                                      );
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
                      `${OBSERVER_RECONNECT_DELAY_MS} millis`,
                    );
                  }),
                );
              }),
              rotationScope,
            );
          });

        const startGrace = (): ScopedVoid =>
          Effect.gen(function* () {
            yield* stopGrace();
            yield* Ref.set(graceElapsed, false);
            graceFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                yield* Effect.sleep(`${EVERYONE_JOINED_GRACE_MS} millis`);
                yield* Ref.set(graceElapsed, true);
                yield* evaluateOnce();
              }),
              rotationScope,
            );
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
            if (
              currentItem.serverId !== current.item.serverId ||
              currentItem.ratingKey !== current.item.ratingKey
            ) {
              return;
            }

            const metadata = yield* Ref.get(prefetchedMetadata);
            const nextItem = buildNextItem(currentItem, nextEpisode, metadata);
            const previousRoomId = current.room.id;

            swapping = true;
            // Fork so swapTo's interrupt of this rotation fiber cannot cancel
            // the atomic swap or the best-effort previous-room delete.
            yield* Effect.gen(function* () {
              try {
                yield* swapTo({
                  room: nextRoom,
                  item: nextItem,
                  expectedCurrent: {
                    roomId: current.room.id,
                    serverId: current.item.serverId,
                    ratingKey: current.item.ratingKey,
                  },
                });
                const swapped = yield* SubscriptionRef.get(state);
                if (
                  swapped._tag === "Playing" &&
                  swapped.room.id === nextRoom.id &&
                  swapped.item.serverId === nextItem.serverId &&
                  swapped.item.ratingKey === nextItem.ratingKey &&
                  current.startPolicy._tag !== "HostControlled"
                ) {
                  yield* api.deleteRoom(previousRoomId).pipe(Effect.ignore);
                }
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
            readonly rank: number;
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
                rotationTargetKey = null;
                invalidRoomMissRevision = null;
              });
            case "arm":
              return Effect.gen(function* () {
                yield* Ref.set(hasAttemptedCreate, false);
                yield* Ref.set(graceElapsed, false);
                yield* Ref.set(gatheredParticipants, {});
                rotationTargetKey = ctx.nextEpisode.ratingKey;
                invalidRoomMissRevision = null;
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
                  ctx.rank,
                );
              });
            case "adopt_room":
              return Effect.gen(function* () {
                yield* ensureDiscovery();
                yield* ensurePrefetch(ctx.nextEpisode, ctx.serverId);
                yield* adoptRoom(decision.room);
                invalidRoomMissRevision = null;
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
            case "invalidate_room":
              return Effect.gen(function* () {
                yield* stopCreate();
                yield* stopObserver();
                yield* stopGrace();
                yield* Ref.set(hasAttemptedCreate, false);
                yield* Ref.set(graceElapsed, false);
                yield* Ref.set(gatheredParticipants, {});
                yield* updateRotationPhase(() => RotationArmed);
                invalidRoomMissRevision = null;
                yield* ensureDiscovery();
                yield* evaluateOnce();
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
                    rank: 0,
                  },
                );
              }
              return;
            }

            if (
              session.rotation._tag !== "None" &&
              rotationTargetKey !== nextEpisode.ratingKey
            ) {
              // Timers, gathering state, and metadata all belong to one target.
              yield* stopCreate();
              yield* stopObserver();
              yield* stopGrace();
              yield* Ref.set(hasAttemptedCreate, false);
              yield* Ref.set(graceElapsed, false);
              yield* Ref.set(gatheredParticipants, {});
              rotationTargetKey = nextEpisode.ratingKey;
              invalidRoomMissRevision = null;
              yield* updateRotationPhase(() => RotationArmed);
              yield* ensureDiscovery();
              yield* ensurePrefetch(nextEpisode, session.item.serverId);
              return yield* evaluateOnce();
            }

            if (session.rotation._tag !== "None") {
              yield* ensurePrefetch(nextEpisode, session.item.serverId);
            }

            const snap = player.snapshot();
            const durationSeconds = Math.max(
              snap.durationSeconds,
              session.item.durationSeconds ?? 0,
            );
            const currentTimeSeconds = getPartyProgressSeconds(
              session.participants,
              snap.currentTimeSeconds,
            );
            const timeRemainingSeconds =
              durationSeconds > 0
                ? durationSeconds - currentTimeSeconds
                : Number.POSITIVE_INFINITY;

            const rooms = yield* Ref.get(visibleRooms);
            const gathered = yield* Ref.get(gatheredParticipants);
            const grace = yield* Ref.get(graceElapsed);
            const rank = getAutoAdvanceRank(session.participants, user);
            if (
              session.rotation._tag === "Armed" &&
              pendingCreateRank !== null &&
              pendingCreateRank !== rank
            ) {
              // Re-elect while the create is still sleeping, not once in flight.
              yield* stopCreate();
              yield* Ref.set(hasAttemptedCreate, false);
            }
            const attempted = yield* Ref.get(hasAttemptedCreate);
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

            if (decision.kind === "invalidate_room") {
              const revision = yield* Ref.get(discoveryRevision);
              if (invalidRoomMissRevision === null) {
                invalidRoomMissRevision = revision;
                return;
              }
              // Wait for a second successful discovery response. Repeated
              // evaluation of one incomplete response is not confirmation.
              if (invalidRoomMissRevision === revision) {
                return;
              }
            } else {
              invalidRoomMissRevision = null;
            }

            yield* executeDecision(decision, {
              nextEpisode,
              currentRoom: session.room,
              serverId: session.item.serverId,
              rank,
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
        if (
          session.startPolicy._tag === "HostControlled" &&
          session.startPolicy.localRole === "Guest"
        ) {
          yield* interruptRotation();
          if (session.rotation._tag !== "None") {
            yield* updateRotationPhase(() => RotationNone);
          }
          return;
        }
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

    startPlaybackImpl = (input: StartPlaybackInput): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        if (input.expectedLobby) {
          if (
            lifecycleGeneration !== input.expectedLobby.generation ||
            input.room.id !== input.expectedLobby.roomId ||
            current._tag !== "Lobby" ||
            current.room.id !== input.expectedLobby.roomId
          ) {
            return false;
          }
        }

        // Capture lobby peers before interrupt tears the observer down so the
        // driver-connection toasts treat them as the starting cohort.
        const initialCohort =
          current._tag === "Lobby"
            ? cohortDeviceIds(current.participants, input.localUser)
            : new Set<string>();

        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        yield* interruptActive();
        localUser = input.localUser;
        // Starting a session clears auto-start suppression (matches old store).
        suppressedRoomId = null;

        const next = playing({
          room: input.room,
          item: toPlayingItem(input.item),
          participants: {},
          startPolicy:
            current._tag === "Lobby" ? current.startPolicy : undefined,
        });
        yield* SubscriptionRef.set(state, next);

        player.load(input.item, {
          resume: false,
          startPositionSeconds: input.startPositionSeconds,
        });

        yield* startConnection(
          input.room,
          input.localUser,
          generation,
          next.startPolicy,
          initialCohort,
        );
        yield* maybeStartRotation();
        return true;
      });

    const swapTo = (input: SwapToInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const user = localUser;
        if (!user) return;

        const current = yield* SubscriptionRef.get(state);
        if (input.expectedCurrent) {
          if (
            current._tag !== "Playing" ||
            current.room.id !== input.expectedCurrent.roomId ||
            current.item.serverId !== input.expectedCurrent.serverId ||
            current.item.ratingKey !== input.expectedCurrent.ratingKey
          ) {
            return;
          }
        }

        // Carry prior-room peers into the next connection's toast cohort so
        // the Syncplay reconnect after episode swap does not toast "joined".
        const initialCohort =
          current._tag === "Playing"
            ? cohortDeviceIds(current.participants, user)
            : new Set<string>();

        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        yield* interruptActive();

        yield* Effect.tryPromise(() => player.prepareForReplacement()).pipe(
          Effect.timeout(REPLACEMENT_PREPARATION_TIMEOUT),
          Effect.ignore,
        );

        // Load the next item before publishing the session swap so React never
        // observes Playing(item N+1) while the player is still on item N.
        player.load(input.item, { resume: false });

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
        // Prior-room toasts are disposed with the interrupted connection;
        // cohort seeding covers peers reconnecting on the next room.
        const swapped = yield* SubscriptionRef.get(state);
        if (swapped._tag !== "Playing") return;
        yield* startConnection(
          input.room,
          user,
          generation,
          swapped.startPolicy,
          initialCohort,
        );
        yield* maybeStartRotation();
      }).pipe(serializeLifecycle);

    const setRotationContext = (ctx: RotationContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.set(rotationContext, ctx);
        yield* maybeStartRotation();
      }).pipe(serializeLifecycle);

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
    } satisfies WatchTogetherSessionContract;
  });

/**
 * Client-side Watch Together session owner for the Playing path.
 *
 * Effect v4 (`4.0.0-beta.59`): `Context.Service` + `Layer.effect` (scoped;
 * replaces the missing `Effect.Service` / `Layer.scoped` helpers).
 */
export class WatchTogetherSession extends Context.Service<
  WatchTogetherSession,
  WatchTogetherSessionContract
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
