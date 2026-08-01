import { beforeEach, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  CREATE_BASE_DELAY_MS,
  CREATE_STAGGER_MS,
  DISCOVERY_POLL_MS,
  EVERYONE_JOINED_GRACE_MS,
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  type SyncplayParticipantState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { Effect, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";

import type { MediaPlayerItem, NextEpisodeInfo } from "~/types/media-player";

import { playerCommands } from "./player-atoms";
import {
  PlayerPort,
  type PlayerPortShape,
  type PlayerSnapshot,
} from "./player-port";
import {
  WatchTogetherSession,
  type MakeObserverConnection,
  type MakeSessionController,
  type ObserverConnectionLike,
  type SessionControllerLike,
  type WatchTogetherSessionShape,
} from "./session-service";
import {
  WatchTogetherApi,
  type WatchTogetherApiShape,
} from "./watch-together-api";

const NOW = Date.now();

const multiplexUser = (id: number, device = `device-${id}`): SyncplayUser => ({
  id,
  deviceIdentifier: device,
  deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
});

const localUser = multiplexUser(1);

const room = (
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
    updatedAt: Math.floor(NOW / 1000),
  });

const item = (ratingKey: string): MediaPlayerItem =>
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

const nextEpisode: NextEpisodeInfo = {
  ratingKey: "200",
  key: "/library/metadata/200",
  title: "Next Ep",
  index: 2,
  parentIndex: 1,
  duration: 1_200_000,
};

type StubController = SessionControllerLike & {
  readonly options: {
    onParticipant?: (p: SyncplayParticipantState) => void;
  };
};

const makeStubControllerFactory = () => {
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

type StubObserver = ObserverConnectionLike & {
  readonly options: {
    onParticipant: (p: SyncplayParticipantState) => void;
    onClose: () => void;
  };
  readonly roomId: string;
};

const makeStubObserverFactory = () => {
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

const makeControllablePlayer = (): PlayerPortShape & {
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
          typeof nextItem.duration === "number"
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

const makeStubApi = (overrides?: {
  rooms?: () => WatchTogetherRoom[];
  /** When provided, each call returns this Effect (for failure/retry tests). */
  createRoomEffect?: (
    input: Parameters<WatchTogetherApiShape["createRoom"]>[0],
  ) => Effect.Effect<WatchTogetherRoom, { _tag: string }>;
  listRoomsEffect?: () => Effect.Effect<
    WatchTogetherRoom[],
    { _tag: string; cause?: string; operation?: string }
  >;
  getItemMetadata?: WatchTogetherApiShape["getItemMetadata"];
}): {
  api: WatchTogetherApiShape;
  createRoom: ReturnType<typeof mock>;
  deleteRoom: ReturnType<typeof mock>;
  listRooms: ReturnType<typeof mock>;
  getItemMetadata: ReturnType<typeof mock>;
} => {
  const createRoom = mock(
    (
      input: Parameters<WatchTogetherApiShape["createRoom"]>[0],
    ): ReturnType<WatchTogetherApiShape["createRoom"]> => {
      if (overrides?.createRoomEffect) {
        // Test overrides may use a looser error channel than WatchTogetherApiError.
        return overrides.createRoomEffect(input) as ReturnType<
          WatchTogetherApiShape["createRoom"]
        >;
      }
      return Effect.succeed(room("r-created", "200"));
    },
  );
  const deleteRoom = mock(
    (
      _roomId: Parameters<WatchTogetherApiShape["deleteRoom"]>[0],
    ): ReturnType<WatchTogetherApiShape["deleteRoom"]> => Effect.void,
  );
  const listRooms = mock((): ReturnType<WatchTogetherApiShape["listRooms"]> => {
    if (overrides?.listRoomsEffect) {
      return overrides.listRoomsEffect() as ReturnType<
        WatchTogetherApiShape["listRooms"]
      >;
    }
    return Effect.succeed(overrides?.rooms ? overrides.rooms() : []);
  });
  const getItemMetadata = mock(
    (
      input: Parameters<WatchTogetherApiShape["getItemMetadata"]>[0],
    ): ReturnType<WatchTogetherApiShape["getItemMetadata"]> => {
      if (overrides?.getItemMetadata) {
        return overrides.getItemMetadata(input);
      }
      return Effect.succeed(
        fromPartial({
          ratingKey: input.ratingKey,
          key: `/library/metadata/${input.ratingKey}`,
          title: `Meta ${input.ratingKey}`,
          type: "episode",
          Media: [{ id: Number(input.ratingKey) }],
        }),
      );
    },
  );

  const api: WatchTogetherApiShape = {
    listRooms: () => listRooms(),
    createRoom: (input) => createRoom(input),
    deleteRoom: (roomId) => deleteRoom(roomId),
    getItemMetadata: (input) => getItemMetadata(input),
  };

  return { api, createRoom, deleteRoom, listRooms, getItemMetadata };
};

beforeEach(() => {
  playerCommands.closePlayer();
});

const withRotationSession = async <A>(
  f: (ctx: {
    session: WatchTogetherSessionShape;
    player: ReturnType<typeof makeControllablePlayer>;
    createRoom: ReturnType<typeof mock>;
    deleteRoom: ReturnType<typeof mock>;
    getItemMetadata: ReturnType<typeof mock>;
    observers: StubObserver[];
    controllers: StubController[];
    setRooms: (rooms: WatchTogetherRoom[]) => void;
    setListRoomsFailing: (failing: boolean) => void;
  }) => Effect.Effect<A>,
  options?: {
    rooms?: () => WatchTogetherRoom[];
    createRoomEffect?: (
      input: Parameters<WatchTogetherApiShape["createRoom"]>[0],
    ) => Effect.Effect<WatchTogetherRoom, { _tag: string }>;
  },
): Promise<A> => {
  const player = makeControllablePlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();
  let roomsFn = options?.rooms ?? (() => fromPartial<WatchTogetherRoom[]>([]));
  let listRoomsFailing = false;
  const { api, createRoom, deleteRoom, getItemMetadata } = makeStubApi({
    listRoomsEffect: () => {
      if (listRoomsFailing) {
        return Effect.fail({
          _tag: "WatchTogetherApiError",
          cause: "network blip",
          operation: "listRooms",
        });
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

const startArmed = (
  session: WatchTogetherSessionShape,
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
const waitUntil = (
  session: WatchTogetherSessionShape,
  pred: (snap: ReturnType<WatchTogetherSessionShape["snapshot"]>) => boolean,
  maxSeconds = 20,
) =>
  Effect.gen(function* () {
    for (let i = 0; i < maxSeconds; i++) {
      if (pred(session.snapshot())) return;
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
    }
    expect(pred(session.snapshot())).toBe(true);
  });

test("a host-controlled host owns room rotation for Guest Link sessions", async () => {
  await withRotationSession(({ session, player, createRoom }) =>
    Effect.gen(function* () {
      yield* session.enterLobby({
        room: room("guest-r1", "100"),
        localUser,
        startPolicy: {
          _tag: "HostControlled",
          localRole: "Host",
          hostUserId: 1,
          guestUserId: 2,
        },
      });
      yield* session.startPlayback({
        room: room("guest-r1", "100"),
        localUser,
        item: item("100"),
      });
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

      const snap = session.snapshot();
      expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");

      yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS + 100} millis`);
      yield* Effect.yieldNow;
      expect(createRoom).toHaveBeenCalledTimes(1);
    }),
  );
});

test("arm → create (rank 0) → discovery adopts → gathering → everyone-joined swap", async () => {
  const nextRoom = room("r2", "200");
  await withRotationSession(
    ({
      session,
      player,
      createRoom,
      deleteRoom,
      setRooms,
      observers,
      controllers,
    }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);

        let snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");

        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;
        expect(createRoom).toHaveBeenCalledTimes(1);
        expect(createRoom).toHaveBeenCalledWith(
          expect.objectContaining({
            serverId: "srv",
            ratingKey: "200",
            users: [2],
          }),
        );

        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r2");

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");
        expect(observers.length).toBeGreaterThanOrEqual(1);
        expect(observers[0]?.roomId).toBe("r2");
        expect(observers[0]?.setReady).toHaveBeenCalledWith(false);

        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;
        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.room.id).toBe("r1");

        observers[0]?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.room.id === "r2",
        );

        snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        expect(snap._tag === "Playing" && snap.room.id).toBe("r2");
        expect(snap._tag === "Playing" && snap.item.ratingKey).toBe("200");
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("None");
        expect(deleteRoom).toHaveBeenCalledWith("r1");
        expect(player.loads.at(-1)?.item.ratingKey).toBe("200");
      }),
  );
});

test("successful create adopts and gathers without room-list visibility", async () => {
  await withRotationSession(
    ({ session, player, createRoom, observers, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);

        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        expect(createRoom).toHaveBeenCalledTimes(1);
        let snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-created");

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "Gathering" &&
            s.rotation.nextRoom.id === "r-created",
        );

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");
        expect(observers.at(-1)?.roomId).toBe("r-created");
      }),
  );
});

test("discovery replaces a created room with the deterministic winner", async () => {
  const created = room("r-created", "200");
  created.updatedAt = Math.floor(NOW / 1000) - 10;
  const winner = room("r-winner", "200");

  await withRotationSession(
    ({ session, player, setRooms, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        let snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-created");

        setRooms([created, winner]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r-winner",
        );

        snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-winner");
      }),
    { createRoomEffect: () => Effect.succeed(created) },
  );
});

test("an old-target create response cannot pollute the current rotation", async () => {
  const alternate: NextEpisodeInfo = {
    ...nextEpisode,
    ratingKey: "300",
    key: "/library/metadata/300",
    title: "Alternate Next Ep",
    index: 3,
  };
  let resolveOldCreate: ((room: WatchTogetherRoom) => void) | undefined;

  await withRotationSession(
    ({ session, player, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(resolveOldCreate).toBeDefined();

        yield* session.setRotationContext({
          nextEpisode: alternate,
          autoPlayEnabled: true,
        });
        yield* Effect.sync(() => resolveOldCreate?.(room("r-stale", "200")));
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        let snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");

        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-current");
      }),
    {
      createRoomEffect: (input) => {
        if (input.ratingKey === "300") {
          return Effect.succeed(room("r-current", "300"));
        }
        return Effect.promise(
          () =>
            new Promise<WatchTogetherRoom>((resolve) => {
              resolveOldCreate = resolve;
            }),
        );
      },
    },
  );
});

test("a create response for stale invitees retries against the live party", async () => {
  const previousParty = [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ];
  const currentParty = [
    previousParty[0]!,
    { id: 3, title: "New Guest", username: "new-guest", thumb: null },
  ];
  let resolveFirstCreate: ((room: WatchTogetherRoom) => void) | undefined;
  let createAttempts = 0;

  await withRotationSession(
    ({ session, player, createRoom, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(resolveFirstCreate).toBeDefined();

        yield* session.updateLobbyRoom(room("r1", "100", currentParty));
        yield* Effect.sync(() =>
          resolveFirstCreate?.(room("r-stale-party", "200", previousParty)),
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        let snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");

        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        expect(createRoom).toHaveBeenCalledTimes(2);
        expect(createRoom.mock.calls.at(-1)?.[0]).toEqual(
          expect.objectContaining({ users: [3] }),
        );
        snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-current-party");
      }),
    {
      createRoomEffect: () => {
        createAttempts += 1;
        if (createAttempts > 1) {
          return Effect.succeed(room("r-current-party", "200", currentParty));
        }
        return Effect.promise(
          () =>
            new Promise<WatchTogetherRoom>((resolve) => {
              resolveFirstCreate = resolve;
            }),
        );
      },
    },
  );
});

test("a wrong-source create response is not adopted", async () => {
  await withRotationSession(
    ({ session, player, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");
      }),
    { createRoomEffect: () => Effect.succeed(room("r-wrong", "999")) },
  );
});

test("rotation does not build the next item from unrelated player media", async () => {
  const nextRoom = room("r2", "200");
  await withRotationSession(
    ({ session, player, setRooms, observers, controllers, deleteRoom }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );

        player.setPlayback({ currentTimeSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );

        player.load(item("999"), { resume: false });
        const loadsBeforeSwap = player.loads.length;
        observers.at(-1)?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.room.id).toBe("r1");
        expect(player.loads).toHaveLength(loadsBeforeSwap);
        expect(deleteRoom).not.toHaveBeenCalled();
      }),
  );
});

test("rank 1 stagger: no create before 9500ms", async () => {
  const rank1User = multiplexUser(2);
  await withRotationSession(({ session, player, createRoom, controllers }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser: rank1User,
        item: item("100"),
      });
      controllers[0]?.options.onParticipant?.({
        user: localUser,
        isPresent: true,
      });
      yield* Effect.yieldNow;

      player.setPlayback({
        currentTimeSeconds: 1160,
        durationSeconds: 1200,
      });
      yield* session.setRotationContext({
        nextEpisode,
        autoPlayEnabled: true,
      });
      yield* Effect.yieldNow;

      const delay = CREATE_BASE_DELAY_MS + CREATE_STAGGER_MS;
      yield* TestClock.adjust(`${delay - 100} millis`);
      yield* Effect.yieldNow;
      expect(createRoom).toHaveBeenCalledTimes(0);

      const snap = session.snapshot();
      expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Armed");
    }),
  );
});

test("rank 1 discovery adoption cancels pending create", async () => {
  const nextRoom = room("r2", "200");
  const rank1User = multiplexUser(2);
  await withRotationSession(
    ({ session, player, createRoom, controllers, setRooms }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser: rank1User,
          item: item("100"),
        });
        controllers[0]?.options.onParticipant?.({
          user: localUser,
          isPresent: true,
        });
        yield* Effect.yieldNow;

        player.setPlayback({
          currentTimeSeconds: 1160,
          durationSeconds: 1200,
        });
        // Room already visible before arming so discovery adopts on first poll
        // and the rank-1 create never schedules.
        setRooms([nextRoom]);
        yield* session.setRotationContext({
          nextEpisode,
          autoPlayEnabled: true,
        });
        yield* Effect.yieldNow;
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "RoomKnown",
          10,
        );

        const snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");
        expect(createRoom).toHaveBeenCalledTimes(0);
      }),
  );
});

test("a pending create is rescheduled when participant rank changes", async () => {
  const rank1User = multiplexUser(2);
  await withRotationSession(({ session, player, createRoom, controllers }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser: rank1User,
        item: item("100"),
      });
      controllers[0]?.options.onParticipant?.({
        user: localUser,
        isPresent: true,
      });
      yield* Effect.yieldNow;
      player.setPlayback({
        currentTimeSeconds: 1160,
        durationSeconds: 1200,
      });
      yield* session.setRotationContext({
        nextEpisode,
        autoPlayEnabled: true,
      });
      yield* Effect.yieldNow;

      controllers[0]?.options.onParticipant?.({
        user: localUser,
        isPresent: false,
      });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;
      yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
      yield* Effect.yieldNow;

      expect(createRoom).toHaveBeenCalledTimes(1);
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({ ratingKey: "200" }),
      );
    }),
  );
});

test("create failure retries after re-arming the staggered delay", async () => {
  let attempts = 0;
  await withRotationSession(
    ({ session, player, createRoom: create, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);

        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;
        expect(create).toHaveBeenCalledTimes(1);

        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;
        expect(create).toHaveBeenCalledTimes(2);
      }),
    {
      createRoomEffect: () => {
        attempts += 1;
        if (attempts === 1) {
          return Effect.fail({
            _tag: "WatchTogetherApiError",
            cause: "transient",
            operation: "createRoom",
          });
        }
        return Effect.succeed(room("r-created", "200"));
      },
    },
  );
});

test("grace path: gathering with missing participant swaps after grace", async () => {
  const nextRoom = room("r2", "200");
  await withRotationSession(
    ({ session, player, deleteRoom, setRooms, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );

        let snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");

        yield* TestClock.adjust(`${EVERYONE_JOINED_GRACE_MS - 500} millis`);
        yield* Effect.yieldNow;
        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.room.id).toBe("r1");

        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.room.id === "r2",
          15,
        );

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.room.id).toBe("r2");
        expect(deleteRoom).toHaveBeenCalledWith("r1");
      }),
  );
});

test("duplicate convergence: adopted room replaced by deterministic winner resets gathering", async () => {
  const early = room("r-early", "200");
  early.updatedAt = Math.floor(NOW / 1000) - 10;
  const winner = room("r-winner", "200");
  winner.updatedAt = Math.floor(NOW / 1000);

  await withRotationSession(
    ({ session, player, setRooms, observers, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        setRooms([early]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r-early",
        );

        let snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-early");

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );
        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");
        const observersBefore = observers.length;

        setRooms([early, winner]);
        // At end, adopt_room immediately re-enters Gathering for the winner.
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "Gathering" &&
            s.rotation.nextRoom.id === "r-winner",
        );

        snap = session.snapshot();
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "Gathering" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-winner");
        expect(observers.length).toBeGreaterThan(observersBefore);

        observers[0]?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const afterStaleCallback = session.snapshot();
        expect(
          afterStaleCallback._tag === "Playing" && afterStaleCallback.room.id,
        ).toBe("r1");

        observers.at(-1)?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.room.id === "r-winner",
        );
      }),
  );
});

test("opt-out: autoPlayEnabled false → no arm, no create", async () => {
  await withRotationSession(({ session, player, createRoom }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });
      yield* session.setRotationContext({
        nextEpisode,
        autoPlayEnabled: false,
      });
      player.setPlayback({
        currentTimeSeconds: 1160,
        durationSeconds: 1200,
      });
      yield* TestClock.adjust("5 seconds");
      yield* Effect.yieldNow;

      const snap = session.snapshot();
      expect(snap._tag === "Playing" && snap.rotation._tag).toBe("None");
      expect(createRoom).toHaveBeenCalledTimes(0);
    }),
  );
});

test("observer reconnect resets gathered participants", async () => {
  const nextRoom = room("r2", "200");
  // Two peers so reporting only device-2 does not satisfy everyoneJoined.
  const peers = [multiplexUser(2), multiplexUser(3)];
  await withRotationSession(
    ({ session, player, setRooms, observers, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers, peers);
        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );

        const first = observers[0];
        expect(first).toBeDefined();
        first?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* Effect.yieldNow;

        let snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "Gathering" &&
            snap.rotation.gatheredDeviceIds.has("device-2"),
        ).toBe(true);
        expect(snap._tag === "Playing" && snap.room.id).toBe("r1");

        first?.options.onClose();
        yield* Effect.yieldNow;
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("Gathering");
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "Gathering" &&
            snap.rotation.gatheredDeviceIds.has("device-2"),
        ).toBe(false);
        expect(observers.length).toBeGreaterThanOrEqual(2);
        expect(first?.disconnect).toHaveBeenCalled();
      }),
  );
});

test("changing nextEpisode resets target-specific work and prefetch", async () => {
  const alternate: NextEpisodeInfo = {
    ratingKey: "300",
    key: "/library/metadata/300",
    title: "Alternate Next Ep",
    index: 3,
    parentIndex: 1,
    duration: 1_200_000,
  };
  const alternateRoom = room("r3", "300");

  await withRotationSession(
    ({
      session,
      player,
      createRoom,
      getItemMetadata,
      setRooms,
      controllers,
      observers,
    }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        yield* session.setRotationContext({
          nextEpisode: alternate,
          autoPlayEnabled: true,
        });
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        expect(
          createRoom.mock.calls.some(
            (call) => (call[0] as { ratingKey: string }).ratingKey === "100",
          ),
        ).toBe(false);
        expect(
          createRoom.mock.calls.some(
            (call) => (call[0] as { ratingKey: string }).ratingKey === "200",
          ),
        ).toBe(false);
        expect(
          createRoom.mock.calls.some(
            (call) => (call[0] as { ratingKey: string }).ratingKey === "300",
          ),
        ).toBe(true);
        expect(
          getItemMetadata.mock.calls.some(
            (call) => (call[0] as { ratingKey: string }).ratingKey === "300",
          ),
        ).toBe(true);

        setRooms([alternateRoom]);
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "RoomKnown",
        );
        player.setPlayback({
          currentTimeSeconds: 1200,
          durationSeconds: 1200,
        });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Gathering",
        );
        observers.at(-1)?.options.onParticipant({
          user: multiplexUser(2),
          isPresent: true,
        });
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.room.id === "r3",
        );

        const loaded = player.loads.at(-1)?.item;
        expect(loaded?.ratingKey).toBe("300");
        expect(loaded?.Media?.[0]?.id).toBe(300);
        expect(loaded?.title).toBe("Alternate Next Ep");
      }),
  );
});

test("two empty discovery responses invalidate an adopted room and recreate", async () => {
  const nextRoom = room("r2", "200");
  await withRotationSession(
    ({ session, player, createRoom, setRooms, controllers }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );
        const createsBefore = createRoom.mock.calls.length;

        setRooms([]);
        yield* TestClock.adjust(`${DISCOVERY_POLL_MS + 100} millis`);
        yield* Effect.yieldNow;
        const afterFirstMiss = session.snapshot();
        expect(
          afterFirstMiss._tag === "Playing" && afterFirstMiss.rotation._tag,
        ).toBe("RoomKnown");

        yield* TestClock.adjust(`${DISCOVERY_POLL_MS + 100} millis`);
        yield* Effect.yieldNow;
        yield* waitUntil(
          session,
          (s) => s._tag === "Playing" && s.rotation._tag === "Armed",
          15,
        );
        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS} millis`);
        yield* Effect.yieldNow;

        expect(createRoom.mock.calls.length).toBeGreaterThan(createsBefore);
      }),
  );
});

test("failed discovery retains the last adopted room", async () => {
  const nextRoom = room("r2", "200");
  await withRotationSession(
    ({
      session,
      player,
      createRoom,
      setRooms,
      setListRoomsFailing,
      controllers,
    }) =>
      Effect.gen(function* () {
        yield* startArmed(session, player, controllers);
        setRooms([nextRoom]);
        yield* waitUntil(
          session,
          (s) =>
            s._tag === "Playing" &&
            s.rotation._tag === "RoomKnown" &&
            s.rotation.nextRoom.id === "r2",
        );
        const createsBefore = createRoom.mock.calls.length;

        setListRoomsFailing(true);
        yield* TestClock.adjust(`${DISCOVERY_POLL_MS + 2_000} millis`);
        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r2");
        expect(createRoom.mock.calls.length).toBe(createsBefore);
      }),
  );
});
