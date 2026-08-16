import { expect, mock, type Mock } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  type ItemMetadata,
  type SyncplayParticipantState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { Effect, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";

import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

import {
  PlayerPort,
  type PlayerPortContract,
  type PlayerSnapshot,
} from "./player-port";
import {
  WatchTogetherSession,
  type MakeObserverConnection,
  type MakeSessionController,
  type ObserverConnectionLike,
  type SessionControllerLike,
  type WatchTogetherSessionContract,
} from "./session-service";
import {
  WatchTogetherApi,
  WatchTogetherApiError,
  type WatchTogetherApiContract,
} from "./watch-together-api";

/** Wall-clock ms for room freshness fixtures (policy defaults to `Date.now()`). */
export const nowMs = (): number => Date.now();

export const multiplexUser = (
  id: number,
  device = `device-${id}`,
): SyncplayUser => ({
  id,
  deviceIdentifier: device,
  deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
});

export const localUser = multiplexUser(1);

export const room = (
  id: string,
  ratingKey: string,
  users: WatchTogetherRoom["users"] = [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
): WatchTogetherRoom =>
  fromPartial<WatchTogetherRoom>({
    id,
    sourceUri: `server://srv/com.plexapp.plugins.library/library/metadata/${ratingKey}`,
    title: `Room ${id}`,
    type: "video",
    syncplayHost: "syncplay.example.com",
    syncplayPort: 443,
    users,
    updatedAt: Math.floor(nowMs() / 1000),
  });

export const item = (ratingKey: string): MediaPlayerItem =>
  fromPartial<MediaPlayerItem>({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    title: `Item ${ratingKey}`,
    type: "episode",
    hubTitle: "TV",
    hubType: "metadata",
    serverId: "srv",
    serverUrl: "https://plex.example",
    authToken: "token",
    duration: 1_200_000,
    index: 1,
    parentIndex: 1,
  });

export const nextEpisode: NextEpisodeInfo = {
  ratingKey: "200",
  key: "/library/metadata/200",
  title: "Next Ep",
  index: 2,
  parentIndex: 1,
  duration: 1_200_000,
};

export type StubController = SessionControllerLike & {
  readonly options: {
    onParticipant?: (p: SyncplayParticipantState) => void;
  };
};

export const makeStubControllerFactory = () => {
  const controllers: StubController[] = [];
  const makeController: MakeSessionController = (options) => {
    const controller: StubController = {
      options,
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
      setReady: mock(() => undefined),
      handleLocalPlaybackChange: mock(() => undefined),
      handleLocalSeeked: mock(() => undefined),
    };
    controllers.push(controller);
    return controller;
  };
  return { makeController, controllers };
};

export type StubObserver = ObserverConnectionLike & {
  readonly options: {
    onParticipant: (p: SyncplayParticipantState) => void;
    onClose: () => void;
  };
  readonly roomId: string;
};

export const makeStubObserverFactory = () => {
  const observers: StubObserver[] = [];
  const makeObserver: MakeObserverConnection = (options) => {
    const observer: StubObserver = {
      options: {
        onParticipant: options.onParticipant,
        onClose: options.onClose,
      },
      roomId: options.room.id,
      connect: mock(() => undefined),
      disconnect: mock(() => undefined),
      setReady: mock(() => undefined),
    };
    observers.push(observer);
    return observer;
  };
  return { makeObserver, observers };
};

export const makeControllablePlayer = (): PlayerPortContract & {
  setPlayback: (partial: Partial<PlayerSnapshot>) => void;
  loads: Array<{ item: MediaPlayerItem; opts: unknown }>;
} => {
  const loads: Array<{ item: MediaPlayerItem; opts: unknown }> = [];
  let snap: PlayerSnapshot = {
    isPlaying: true,
    currentTimeSeconds: 0,
    durationSeconds: 1200,
    canPlay: true,
    isLoading: false,
    error: null,
  };
  let current: MediaPlayerItem | null = null;
  const listeners = new Set<(s: PlayerSnapshot) => void>();

  return {
    loads,
    load: (nextItem, opts) => {
      loads.push({ item: nextItem, opts });
      current = nextItem;
      snap = {
        ...snap,
        currentTimeSeconds: opts.startPositionSeconds ?? 0,
        durationSeconds:
          nextItem.duration !== undefined
            ? nextItem.duration / 1000
            : snap.durationSeconds,
      };
      for (const listener of listeners) listener(snap);
    },
    close: () => {
      current = null;
    },
    snapshot: () => snap,
    currentItem: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registerActions: () => () => undefined,
    prepareForReplacement: () => Promise.resolve(),
    play: () => true,
    pause: () => undefined,
    seek: () => "direct" as const,
    setPlayback: (partial) => {
      snap = { ...snap, ...partial };
      for (const listener of listeners) listener(snap);
    },
  };
};

export const makeStubApi = (overrides?: {
  rooms?: () => WatchTogetherRoom[];
  /** When provided, each call returns this Effect (for failure/retry tests). */
  createRoomEffect?: (
    input: Parameters<WatchTogetherApiContract["createRoom"]>[0],
  ) => ReturnType<WatchTogetherApiContract["createRoom"]>;
  listRoomsEffect?: () => ReturnType<WatchTogetherApiContract["listRooms"]>;
  getItemMetadata?: WatchTogetherApiContract["getItemMetadata"];
}) => {
  const createRoom: Mock<WatchTogetherApiContract["createRoom"]> = mock(
    (input) => {
      if (overrides?.createRoomEffect) {
        return overrides.createRoomEffect(input);
      }
      return Effect.succeed(room("r-created", "200"));
    },
  );
  const deleteRoom: Mock<WatchTogetherApiContract["deleteRoom"]> = mock(
    () => Effect.void,
  );
  const listRooms: Mock<WatchTogetherApiContract["listRooms"]> = mock(() => {
    if (overrides?.listRoomsEffect) {
      return overrides.listRoomsEffect();
    }
    return Effect.succeed(overrides?.rooms ? overrides.rooms() : []);
  });
  const getItemMetadata: Mock<WatchTogetherApiContract["getItemMetadata"]> = mock(
    (input) => {
      if (overrides?.getItemMetadata) {
        return overrides.getItemMetadata(input);
      }
      return Effect.succeed(
        fromPartial<ItemMetadata>({
          ratingKey: input.ratingKey,
          key: `/library/metadata/${input.ratingKey}`,
          title: `Meta ${input.ratingKey}`,
          type: "episode",
          Media: [{ id: Number(input.ratingKey) }],
        }),
      );
    },
  );

  const api: WatchTogetherApiContract = {
    listRooms: () => listRooms(),
    createRoom: (input) => createRoom(input),
    deleteRoom: (roomId) => deleteRoom(roomId),
    getItemMetadata: (input) => getItemMetadata(input),
  };

  return { api, createRoom, deleteRoom, listRooms, getItemMetadata };
};

export const withRotationSession = async <A>(
  f: (ctx: {
    session: WatchTogetherSessionContract;
    player: ReturnType<typeof makeControllablePlayer>;
    createRoom: Mock<WatchTogetherApiContract["createRoom"]>;
    deleteRoom: Mock<WatchTogetherApiContract["deleteRoom"]>;
    getItemMetadata: Mock<WatchTogetherApiContract["getItemMetadata"]>;
    observers: StubObserver[];
    controllers: StubController[];
    setRooms: (rooms: WatchTogetherRoom[]) => void;
    setListRoomsFailing: (failing: boolean) => void;
  }) => Effect.Effect<A>,
  options?: {
    rooms?: () => WatchTogetherRoom[];
    createRoomEffect?: (
      input: Parameters<WatchTogetherApiContract["createRoom"]>[0],
    ) => ReturnType<WatchTogetherApiContract["createRoom"]>;
  },
): Promise<A> => {
  const player = makeControllablePlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();
  const emptyRooms: WatchTogetherRoom[] = [];
  let roomsFn = options?.rooms ?? (() => emptyRooms);
  let listRoomsFailing = false;
  const { api, createRoom, deleteRoom, getItemMetadata } = makeStubApi({
    listRoomsEffect: () => {
      if (listRoomsFailing) {
        return Effect.fail(
          new WatchTogetherApiError({
            cause: "network blip",
            operation: "listRooms",
          }),
        );
      }
      return Effect.succeed(roomsFn());
    },
    createRoomEffect: options?.createRoomEffect,
  });

  const layer = WatchTogetherSession.layer({
    player,
    api,
    makeController,
    makeObserver,
  }).pipe(
    Layer.provideMerge(Layer.succeed(PlayerPort)(player)),
    Layer.provideMerge(Layer.succeed(WatchTogetherApi)(api)),
    // TestClock must be in the ManagedRuntime so forkDetach children see it.
    Layer.provideMerge(TestClock.layer()),
  );

  const runtime = ManagedRuntime.make(layer);
  try {
    // Outer Scope so TestClock.adjust / Schedule sleeps can resolve.
    return await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* WatchTogetherSession;
          return yield* f({
            session,
            player,
            createRoom,
            deleteRoom,
            getItemMetadata,
            observers,
            controllers,
            setRooms: (rooms) => {
              roomsFn = () => rooms;
            },
            setListRoomsFailing: (failing) => {
              listRoomsFailing = failing;
            },
          });
        }),
      ),
    );
  } finally {
    await runtime.dispose();
  }
};

export const startArmed = (
  session: WatchTogetherSessionContract,
  player: ReturnType<typeof makeControllablePlayer>,
  controllers: StubController[],
  peers: SyncplayUser[] = [multiplexUser(2)],
) =>
  Effect.gen(function* () {
    yield* session.startPlayback({
      room: room("r1", "100"),
      localUser,
      item: item("100"),
    });
    for (const peer of peers) {
      controllers[0]?.options.onParticipant?.({
        user: peer,
        isPresent: true,
      });
    }
    yield* Effect.yieldNow;
    // Enter the lead window before starting the rotation fiber so the first
    // evaluateOnce arms immediately.
    player.setPlayback({
      currentTimeSeconds: 1160,
      durationSeconds: 1200,
    });
    yield* session.setRotationContext({
      nextEpisode,
      autoPlayEnabled: true,
    });
    yield* Effect.yieldNow;
    yield* TestClock.adjust("0 millis");
    yield* Effect.yieldNow;
  });

/** Advance TestClock until `pred` holds (1s steps), for discovery/grace races. */
export const waitUntil = (
  session: WatchTogetherSessionContract,
  pred: (snap: ReturnType<WatchTogetherSessionContract["snapshot"]>) => boolean,
  maxSeconds = 20,
  label = "waitUntil predicate",
) =>
  Effect.gen(function* () {
    for (let i = 0; i < maxSeconds; i++) {
      if (pred(session.snapshot())) return;
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
    }
    expect(
      pred(session.snapshot()),
      `${label} did not hold within ${maxSeconds}s; snapshot: ${JSON.stringify(session.snapshot())}`,
    ).toBe(true);
  });
