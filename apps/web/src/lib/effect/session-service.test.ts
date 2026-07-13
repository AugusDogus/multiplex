import { expect, mock, test } from "bun:test";
import type {
  SessionState,
  SyncplayParticipantState,
  SyncplaySessionControllerOptions,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { PRESENCE_GRACE_MS } from "@multiplex/plex-query";
import {
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Stream,
  SubscriptionRef,
} from "effect";
import { TestClock } from "effect/testing";

import type { MediaPlayerItem } from "~/types/media-player";

import {
  makePlayerPort,
  PlayerPort,
  type PlayerPortShape,
} from "./player-port";
import { createPlayerService } from "./player-service";
import {
  makeWatchTogetherSession,
  WatchTogetherSession,
  type MakeObserverConnection,
  type MakeSessionController,
  type ObserverConnectionLike,
  type SessionControllerLike,
  type WatchTogetherSessionShape,
} from "./session-service";

const room = (
  id: string,
  ratingKey: string,
  users: WatchTogetherRoom["users"] = [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
): WatchTogetherRoom =>
  ({
    id,
    sourceUri: `server://srv/com.plexapp.plugins.library/library/metadata/${ratingKey}`,
    title: `Room ${id}`,
    type: "video",
    syncplayHost: "syncplay.example.com",
    syncplayPort: 443,
    users,
  }) as WatchTogetherRoom;

const item = (ratingKey: string): MediaPlayerItem =>
  ({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    title: `Item ${ratingKey}`,
    type: "episode",
    hubTitle: "TV",
    hubType: "metadata",
    serverId: "srv",
    serverUrl: "https://plex.example",
    authToken: "token",
    duration: 600_000,
    index: 1,
    parentIndex: 1,
  }) as MediaPlayerItem;

const localUser: SyncplayUser = {
  id: 1,
  deviceIdentifier: "device-1",
  deviceName: "Multiplex Web",
};

type StubController = SessionControllerLike & {
  readonly options: SyncplaySessionControllerOptions;
  readonly disconnectCount: { n: number };
};

const makeStubControllerFactory = () => {
  const controllers: StubController[] = [];
  const makeController: MakeSessionController = (options) => {
    const disconnectCount = { n: 0 };
    const controller: StubController = {
      options,
      disconnectCount,
      connect: mock(() => undefined),
      disconnect: mock(() => {
        disconnectCount.n += 1;
      }),
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
    onRoomState?: (state: { paused: boolean; positionSeconds: number }) => void;
  };
  readonly roomId: string;
  readonly disconnectCount: { n: number };
};

const makeStubObserverFactory = () => {
  const observers: StubObserver[] = [];
  const makeObserver: MakeObserverConnection = (options) => {
    const disconnectCount = { n: 0 };
    const observer: StubObserver = {
      options: {
        onParticipant: options.onParticipant,
        onClose: options.onClose,
        onRoomState: options.onRoomState,
      },
      roomId: options.room.id,
      disconnectCount,
      connect: mock(() => undefined),
      disconnect: mock(() => {
        disconnectCount.n += 1;
      }),
      setReady: mock(() => undefined),
    };
    observers.push(observer);
    return observer;
  };
  return { makeObserver, observers };
};

const makeStubPlayer = (): PlayerPortShape & {
  loads: Array<{ item: MediaPlayerItem; opts: unknown }>;
  events: string[];
} => {
  const loads: Array<{ item: MediaPlayerItem; opts: unknown }> = [];
  const events: string[] = [];
  const base = makePlayerPort(createPlayerService());
  return {
    ...base,
    loads,
    events,
    load: (nextItem, opts) => {
      events.push(`load:${nextItem.ratingKey}`);
      loads.push({ item: nextItem, opts });
      base.load(nextItem, opts);
    },
  };
};

const withSession = async <A>(
  f: (ctx: {
    session: WatchTogetherSessionShape;
    controllers: StubController[];
    observers: StubObserver[];
    player: ReturnType<typeof makeStubPlayer>;
  }) => Effect.Effect<A>,
  options?: {
    makeController?: MakeSessionController;
    makeObserver?: MakeObserverConnection;
    player?: PlayerPortShape;
    withTestClock?: boolean;
  },
): Promise<A> => {
  const player =
    (options?.player as ReturnType<typeof makeStubPlayer> | undefined) ??
    makeStubPlayer();
  const { makeController, controllers } = options?.makeController
    ? {
        makeController: options.makeController,
        controllers: [] as StubController[],
      }
    : makeStubControllerFactory();
  const { makeObserver, observers } = options?.makeObserver
    ? { makeObserver: options.makeObserver, observers: [] as StubObserver[] }
    : makeStubObserverFactory();

  let layer = WatchTogetherSession.layer({
    player,
    makeController,
    makeObserver,
  }).pipe(Layer.provideMerge(Layer.succeed(PlayerPort)(player)));

  if (options?.withTestClock) {
    layer = layer.pipe(Layer.provideMerge(TestClock.layer()));
  }

  const runtime = ManagedRuntime.make(layer);
  try {
    return await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* WatchTogetherSession;
          return yield* f({ session, controllers, observers, player });
        }),
      ),
    );
  } finally {
    await runtime.dispose();
  }
};

test("startPlayback transitions to Playing and loads the player", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
          startPositionSeconds: 12,
        });

        const snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        if (snap._tag !== "Playing") return;

        expect(snap.room.id).toBe("r1");
        expect(snap.item.ratingKey).toBe("100");
        expect(snap.rotation._tag).toBe("None");
        expect(Object.keys(snap.participants)).toEqual([]);

        expect(player.loads).toHaveLength(1);
        expect(player.loads[0]?.item.ratingKey).toBe("100");
        expect(player.loads[0]?.opts).toEqual({
          resume: false,
          startPositionSeconds: 12,
        });

        expect(controllers).toHaveLength(1);
        expect(controllers[0]?.connect).toHaveBeenCalledTimes(1);
      }),
    { player, makeController },
  );
});

test("swapTo is a single atomic state change with no mismatched intermediate", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });

        const seen: SessionState[] = [];
        const collectFiber = yield* Stream.runForEach(
          SubscriptionRef.changes(session.state),
          (s) =>
            Effect.sync(() => {
              seen.push(s);
            }),
        ).pipe(Effect.forkDetach({ startImmediately: true }));

        seen.length = 0;

        yield* session.swapTo({
          room: room("r2", "200"),
          item: item("200"),
        });

        yield* Fiber.interrupt(collectFiber);

        expect(seen.length).toBeGreaterThanOrEqual(1);
        for (const s of seen) {
          if (s._tag !== "Playing") {
            expect(s._tag).not.toBe("Playing");
            continue;
          }
          const roomKey = s.room.sourceUri.split("/").pop() ?? "";
          expect(s.item.ratingKey).toBe(roomKey);
        }

        const final = session.snapshot();
        expect(final._tag).toBe("Playing");
        if (final._tag === "Playing") {
          expect(final.room.id).toBe("r2");
          expect(final.item.ratingKey).toBe("200");
        }

        expect(controllers.length).toBe(2);
        expect(controllers[0]?.disconnectCount.n).toBe(1);
        expect(controllers[1]?.connect).toHaveBeenCalledTimes(1);
        expect(player.loads).toHaveLength(2);
        expect(player.loads[1]?.opts).toEqual({ resume: false });
      }),
    { player, makeController },
  );
});

test("swapTo prepares the old playback before loading its replacement", async () => {
  const player = makeStubPlayer();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        player.registerActions({
          play: () => true,
          pause: () => undefined,
          seek: () => "direct",
          prepareForReplacement: async () => {
            player.events.push("prepare");
          },
        });

        yield* session.swapTo({
          room: room("r2", "200"),
          item: item("200"),
        });

        expect(player.events).toEqual(["load:100", "prepare", "load:200"]);
      }),
    { player },
  );
});

test("swapTo ignores replacement preparation failure", async () => {
  const player = makeStubPlayer();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        player.registerActions({
          play: () => true,
          pause: () => undefined,
          seek: () => "direct",
          prepareForReplacement: () =>
            Promise.reject(new Error("cleanup failed")),
        });

        yield* session.swapTo({
          room: room("r2", "200"),
          item: item("200"),
        });

        expect(player.loads.at(-1)?.item.ratingKey).toBe("200");
      }),
    { player },
  );
});

test("swapTo bounds replacement preparation before loading", async () => {
  const player = makeStubPlayer();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        player.registerActions({
          play: () => true,
          pause: () => undefined,
          seek: () => "direct",
          prepareForReplacement: () => new Promise(() => undefined),
        });

        const swapFiber = yield* session
          .swapTo({ room: room("r2", "200"), item: item("200") })
          .pipe(Effect.forkDetach({ startImmediately: true }));
        yield* Effect.yieldNow;
        expect(player.loads).toHaveLength(1);

        yield* TestClock.adjust("2 seconds");
        yield* Fiber.join(swapFiber);
        expect(player.loads.at(-1)?.item.ratingKey).toBe("200");
      }),
    { player, withTestClock: true },
  );
});

test("a leave queued behind swapTo is the final lifecycle transition", async () => {
  await withSession(({ session }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });

      const swapFiber = yield* session
        .swapTo({ room: room("r2", "200"), item: item("200") })
        .pipe(Effect.forkDetach({ startImmediately: true }));
      yield* Effect.yieldNow;
      const leaveFiber = yield* session
        .leave({ suppressAutoStart: true })
        .pipe(Effect.forkDetach({ startImmediately: true }));

      yield* Fiber.join(swapFiber);
      yield* Fiber.join(leaveFiber);
      expect(session.snapshot()._tag).toBe("Idle");
    }),
  );
});

test("swapTo queued after leave cannot resurrect an idle session", async () => {
  await withSession(({ session }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });

      const leaveFiber = yield* session
        .leave({ suppressAutoStart: true })
        .pipe(Effect.forkDetach({ startImmediately: true }));
      yield* Effect.yieldNow;
      const swapFiber = yield* session
        .swapTo({ room: room("r2", "200"), item: item("200") })
        .pipe(Effect.forkDetach({ startImmediately: true }));

      yield* Fiber.join(leaveFiber);
      yield* Fiber.join(swapFiber);
      expect(session.snapshot()._tag).toBe("Idle");
    }),
  );
});

test("a stale rotation swap cannot replace a newer playback session", async () => {
  await withSession(({ session }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });
      yield* session.startPlayback({
        room: room("r-new", "300"),
        localUser,
        item: item("300"),
      });

      yield* session.swapTo({
        room: room("r2", "200"),
        item: item("200"),
        expectedCurrent: {
          roomId: "r1",
          serverId: "srv",
          ratingKey: "100",
        },
      });

      const snap = session.snapshot();
      expect(snap._tag === "Playing" && snap.room.id).toBe("r-new");
      expect(snap._tag === "Playing" && snap.item.ratingKey).toBe("300");
    }),
  );
});

test("leave clears state, interrupts the controller, and can suppress auto-start", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        yield* session.leave({ suppressAutoStart: true });

        expect(session.snapshot()._tag).toBe("Idle");
        expect(controllers[0]?.disconnectCount.n).toBe(1);
        expect(session.getSuppressedRoomId()).toBe("r1");
      }),
    { makeController },
  );
});

test("local playback and seek forward to the live controller", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        yield* session.handleLocalPlaybackChange(true);
        yield* session.handleLocalSeeked(42);

        expect(controllers[0]?.handleLocalPlaybackChange).toHaveBeenCalledWith(
          true,
        );
        expect(controllers[0]?.handleLocalSeeked).toHaveBeenCalledWith(42);
      }),
    { makeController },
  );
});

test("fatal controller error leaves Idle without auto-start suppression", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });

        const onFatal = controllers[0]?.options.onFatalError;
        expect(onFatal).toBeDefined();
        onFatal?.(new Error("socket dead"));

        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Idle");
        expect(session.getSuppressedRoomId()).toBeNull();
      }),
    { makeController },
  );
});

test("participant events merge into Playing session state", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });

        const participant: SyncplayParticipantState = {
          user: {
            id: 2,
            deviceIdentifier: "device-2",
            deviceName: "Friend",
          },
          isPresent: true,
          isReady: true,
        };
        controllers[0]?.options.onParticipant?.(participant);

        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        if (snap._tag === "Playing") {
          expect(snap.participants["device-2"]).toMatchObject({
            isPresent: true,
            isReady: true,
          });
        }
      }),
    { makeController },
  );
});

test("stale controller callbacks cannot affect a newer playback session", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        yield* session.startPlayback({
          room: room("r2", "200"),
          localUser,
          item: item("200"),
        });

        controllers[0]?.options.onParticipant?.({
          user: {
            id: 2,
            deviceIdentifier: "stale-device",
            deviceName: "Friend",
          },
          isPresent: true,
          isReady: true,
        });
        controllers[0]?.options.onFatalError?.(new Error("stale socket dead"));
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        if (snap._tag === "Playing") {
          expect(snap.room.id).toBe("r2");
          expect(snap.item.ratingKey).toBe("200");
          expect(snap.participants["stale-device"]).toBeUndefined();
        }
      }),
    { makeController },
  );
});

test("enterLobby starts observer, merges participants, and tracks room position", async () => {
  await withSession(
    ({ session, observers }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const snap = session.snapshot();
        expect(snap._tag).toBe("Lobby");
        if (snap._tag !== "Lobby") return;
        expect(snap.room.id).toBe("r1");
        expect(snap.roomPositionSeconds).toBeNull();

        expect(observers.length).toBeGreaterThanOrEqual(1);
        expect(observers[0]?.connect).toHaveBeenCalled();
        expect(observers[0]?.setReady).toHaveBeenCalledWith(false);

        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "device-2",
            deviceName: "Multiplex Web",
          },
          isPresent: true,
        });
        yield* Effect.yieldNow;

        observers[0]?.options.onRoomState?.({
          paused: true,
          positionSeconds: 33,
        });
        yield* Effect.yieldNow;

        const after = session.snapshot();
        expect(after._tag).toBe("Lobby");
        if (after._tag === "Lobby") {
          expect(after.participants["device-2"]).toMatchObject({
            isPresent: true,
          });
          expect(after.roomPositionSeconds).toBe(33);
        }
      }),
    { withTestClock: true },
  );
});

test("enterLobby is idempotent by room id (refetch does not reconnect)", async () => {
  await withSession(
    ({ session, observers }) =>
      Effect.gen(function* () {
        const r1 = room("r1", "100");
        yield* session.enterLobby({ room: r1, localUser });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const countAfterEnter = observers.length;

        yield* session.enterLobby({
          room: { ...r1, title: "Updated title" },
          localUser,
        });
        yield* Effect.yieldNow;

        expect(observers.length).toBe(countAfterEnter);
        const snap = session.snapshot();
        expect(snap._tag).toBe("Lobby");
        if (snap._tag === "Lobby") {
          expect(snap.room.title).toBe("Updated title");
        }
      }),
    { withTestClock: true },
  );
});

test("exitLobby returns to Idle and disconnects the observer", async () => {
  await withSession(
    ({ session, observers }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        yield* session.exitLobby();
        expect(session.snapshot()._tag).toBe("Idle");
        expect(observers[0]?.disconnectCount.n).toBeGreaterThanOrEqual(1);
      }),
    { withTestClock: true },
  );
});

test("startPlayback from Lobby interrupts observer and starts driver", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(observers.length).toBeGreaterThanOrEqual(1);

        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });

        expect(session.snapshot()._tag).toBe("Playing");
        expect(observers[0]?.disconnectCount.n).toBeGreaterThanOrEqual(1);
        expect(controllers).toHaveLength(1);
        expect(controllers[0]?.connect).toHaveBeenCalled();
        expect(player.loads).toHaveLength(1);
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("stale detached lobby auto-start cannot replace a switched lobby or session", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* session.enterLobby({
          room: room("r2", "200"),
          localUser,
        });

        const staleAutoStart = {
          room: room("r1", "100"),
          localUser,
          item: item("100"),
          resume: false as const,
          expectedLobby: { generation: 1, roomId: "r1" },
        };
        const staleLobbyFiber = yield* session
          .startPlayback(staleAutoStart)
          .pipe(Effect.forkDetach({ startImmediately: true }));
        yield* Fiber.join(staleLobbyFiber);

        let snap = session.snapshot();
        expect(snap._tag === "Lobby" && snap.room.id).toBe("r2");
        expect(player.loads).toHaveLength(0);
        expect(controllers).toHaveLength(0);

        yield* session.startPlayback({
          room: room("r3", "300"),
          localUser,
          item: item("300"),
        });
        const staleSessionFiber = yield* session
          .startPlayback(staleAutoStart)
          .pipe(Effect.forkDetach({ startImmediately: true }));
        yield* Fiber.join(staleSessionFiber);

        snap = session.snapshot();
        expect(snap._tag === "Playing" && snap.room.id).toBe("r3");
        expect(snap._tag === "Playing" && snap.item.ratingKey).toBe("300");
        expect(player.loads).toHaveLength(1);
        expect(controllers).toHaveLength(1);
      }),
    { player, makeController, withTestClock: true },
  );
});

test("auto-start fires after stability + delay via TestClock", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        const r = room("r1", "100");
        yield* session.enterLobby({ room: r, localUser });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "device-2",
            deviceName: "Multiplex Web",
          },
          isPresent: true,
        });
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Lobby");

        // Advance past AUTO_START_DELAY_MS (1200) with lobby 100ms ticks.
        yield* TestClock.adjust("1300 millis");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Playing");
        expect(controllers).toHaveLength(1);
        expect(player.loads[0]?.opts).toEqual({ resume: false });
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("a host-controlled host stays in Lobby until Start is pressed", async () => {
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("guest-link", "100"),
          localUser,
          startPolicy: {
            _tag: "HostControlled",
            localRole: "Host",
            hostUserId: 1,
            guestUserId: 2,
          },
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "guest-device",
            deviceName: "Multiplex Guest · Alex",
          },
          isPresent: true,
        });
        yield* TestClock.adjust("3 seconds");
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Lobby");
      }),
    { makeObserver, withTestClock: true },
  );
});

test("a host-controlled guest follows only the ready host at the live position", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();
  const guestUser: SyncplayUser = {
    id: 2,
    deviceIdentifier: "guest-device-a",
    deviceName: "Multiplex Guest · Alex",
  };

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("guest-link", "100"),
          localUser: guestUser,
          startPolicy: {
            _tag: "HostControlled",
            localRole: "Guest",
            hostUserId: 1,
            guestUserId: 2,
          },
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        // Another device on the shared Guest profile must not become host.
        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "guest-device-b",
            deviceName: "Multiplex Guest · Sam",
          },
          isPresent: true,
          isReady: true,
        });
        observers[0]?.options.onRoomState?.({
          paused: true,
          positionSeconds: 37,
        });
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;
        expect(session.snapshot()._tag).toBe("Lobby");

        observers[0]?.options.onParticipant({
          user: {
            id: 1,
            deviceIdentifier: "host-device",
            deviceName: "Multiplex Web",
          },
          isPresent: true,
          isReady: true,
        });
        yield* TestClock.adjust("1300 millis");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const state = session.snapshot();
        expect(state._tag).toBe("Playing");
        expect(state._tag === "Playing" && state.startPolicy._tag).toBe(
          "HostControlled",
        );
        expect(player.loads[0]?.opts).toEqual({
          resume: false,
          startPositionSeconds: 37,
        });
        expect(controllers).toHaveLength(1);
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("auto-start respects suppression and clears it on startPlayback", async () => {
  const player = makeStubPlayer();
  const { makeController } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        yield* session.leave({ suppressAutoStart: true });
        expect(session.getSuppressedRoomId()).toBe("r1");

        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "device-2",
            deviceName: "Multiplex Web",
          },
          isPresent: true,
        });
        yield* TestClock.adjust("2000 millis");
        yield* Effect.yieldNow;

        // Suppressed — still Lobby.
        expect(session.snapshot()._tag).toBe("Lobby");

        // Manual start clears suppression.
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        expect(session.getSuppressedRoomId()).toBeNull();
        expect(session.snapshot()._tag).toBe("Playing");
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("auto-start waits for known room position when joining in progress", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        observers[0]?.options.onParticipant({
          user: {
            id: 2,
            deviceIdentifier: "device-2",
            deviceName: "Multiplex Web",
          },
          isPresent: true,
          isReady: true,
        });
        yield* TestClock.adjust("2000 millis");
        yield* Effect.yieldNow;
        expect(session.snapshot()._tag).toBe("Lobby");

        observers[0]?.options.onRoomState?.({
          paused: false,
          positionSeconds: 55,
        });
        yield* TestClock.adjust("1300 millis");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Playing");
        expect(controllers).toHaveLength(1);
        expect(player.loads[0]?.opts).toEqual({
          resume: false,
          startPositionSeconds: 55,
        });
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("auto-start does not fire for solo rooms", async () => {
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100", [
            { id: 1, title: "Host", username: "host", thumb: null },
          ]),
          localUser,
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("2000 millis");
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Lobby");
        expect(observers[0]?.connect).toHaveBeenCalled();
      }),
    { makeObserver, withTestClock: true },
  );
});

test("observer presence drop keeps the lobby grace timer alive", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const { makeObserver, observers } = makeStubObserverFactory();

  await withSession(
    ({ session }) =>
      Effect.gen(function* () {
        yield* session.enterLobby({
          room: room("r1", "100"),
          localUser,
        });
        yield* session.setLobbyContext({
          canStart: true,
          playbackInput: { item: item("100") },
          leaving: false,
        });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        const guest = {
          id: 2,
          deviceIdentifier: "device-2",
          deviceName: "Multiplex Web",
        };
        observers[0]?.options.onParticipant({
          user: guest,
          isPresent: true,
        });
        yield* Effect.yieldNow;
        const present = session.snapshot();
        expect(present._tag === "Lobby" && present.everyonePresentSticky).toBe(
          true,
        );
        observers[0]?.options.onParticipant({
          user: guest,
          isPresent: false,
        });
        yield* Effect.yieldNow;
        const withinGrace = session.snapshot();
        expect(
          withinGrace._tag === "Lobby" && withinGrace.everyonePresentSticky,
        ).toBe(true);

        yield* TestClock.adjust(`${PRESENCE_GRACE_MS + 200} millis`);
        yield* Effect.yieldNow;
        expect(session.snapshot()._tag).toBe("Lobby");
        expect(controllers).toHaveLength(0);

        observers[0]?.options.onParticipant({
          user: guest,
          isPresent: true,
        });
        yield* TestClock.adjust("1300 millis");
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Playing");
        expect(controllers).toHaveLength(1);
      }),
    { player, makeController, makeObserver, withTestClock: true },
  );
});

test("makeWatchTogetherSession works without ManagedRuntime for unit isolation", async () => {
  const player = makeStubPlayer();
  const { makeController } = makeStubControllerFactory();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* makeWatchTogetherSession({
          player,
          makeController,
        });

        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        expect(session.snapshot()._tag).toBe("Playing");
        yield* session.leave({ suppressAutoStart: false });
        expect(session.snapshot()._tag).toBe("Idle");
      }),
    ),
  );
});
