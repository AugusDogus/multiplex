import { beforeEach, expect, mock, test } from "bun:test";
import type {
  SessionState,
  SyncplayParticipantState,
  SyncplaySessionControllerOptions,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import {
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Stream,
  SubscriptionRef,
} from "effect";

import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerItem } from "~/types/media-player";

import {
  makePlayerPort,
  PlayerPort,
  type PlayerPortShape,
} from "./player-port";
import {
  makeWatchTogetherSession,
  WatchTogetherSession,
  type MakeSessionController,
  type SessionControllerLike,
  type SessionMirror,
  type WatchTogetherSessionShape,
} from "./session-service";

const room = (id: string, ratingKey: string): WatchTogetherRoom =>
  ({
    id,
    sourceUri: `server://srv/com.plexapp.plugins.library/library/metadata/${ratingKey}`,
    title: `Room ${id}`,
    type: "video",
    syncplayHost: "syncplay.example.com",
    syncplayPort: 443,
    users: [],
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
  deviceName: "Multiplex",
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

const makeStubPlayer = (): PlayerPortShape & {
  loads: Array<{ item: MediaPlayerItem; opts: unknown }>;
} => {
  const loads: Array<{ item: MediaPlayerItem; opts: unknown }> = [];
  const base = makePlayerPort();
  return {
    ...base,
    loads,
    load: (nextItem, opts) => {
      loads.push({ item: nextItem, opts });
      base.load(nextItem, opts);
    },
  };
};

const makeMirror = (): SessionMirror & {
  events: string[];
} => {
  const events: string[] = [];
  return {
    events,
    setPlaying: (session) => {
      events.push(`setPlaying:${session.room.id}`);
      useWatchTogetherStore.getState().setSession(session);
    },
    clear: () => {
      events.push("clear");
      useWatchTogetherStore.getState().clearSession();
    },
    leave: () => {
      events.push("leave");
      useWatchTogetherStore.getState().leaveSession();
    },
    updateParticipant: (participant) => {
      events.push(`participant:${participant.user.deviceIdentifier}`);
      useWatchTogetherStore.getState().updateParticipant(participant);
    },
  };
};

beforeEach(() => {
  useWatchTogetherStore.setState({
    session: null,
    participants: {},
    autoStartSuppressedRoomId: null,
  });
});

const withSession = async <A>(
  f: (session: WatchTogetherSessionShape) => Effect.Effect<A>,
  options?: {
    makeController?: MakeSessionController;
    player?: PlayerPortShape;
    mirror?: SessionMirror;
  },
): Promise<A> => {
  const player = options?.player ?? makeStubPlayer();
  const { makeController } = options?.makeController
    ? { makeController: options.makeController }
    : makeStubControllerFactory();
  const mirror = options?.mirror ?? makeMirror();

  const layer = WatchTogetherSession.layer({
    player,
    makeController,
    mirror,
  }).pipe(Layer.provideMerge(Layer.succeed(PlayerPort)(player)));

  const runtime = ManagedRuntime.make(layer);
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const session = yield* WatchTogetherSession;
        return yield* f(session);
      }),
    );
  } finally {
    await runtime.dispose();
  }
};

test("startPlayback transitions to Playing and loads the player", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const mirror = makeMirror();

  await withSession(
    (session) =>
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
        expect(mirror.events).toContain("setPlaying:r1");
        expect(useWatchTogetherStore.getState().session?.room.id).toBe("r1");
      }),
    { player, makeController, mirror },
  );
});

test("swapTo is a single atomic state change with no mismatched intermediate", async () => {
  const player = makeStubPlayer();
  const { makeController, controllers } = makeStubControllerFactory();
  const mirror = makeMirror();

  await withSession(
    (session) =>
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

        // Drop the initial current-value emission before swapping.
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
          // THE regression: room and item must never disagree.
          const roomKey = s.room.sourceUri.split("/").pop() ?? "";
          expect(s.item.ratingKey).toBe(roomKey);
        }

        const final = session.snapshot();
        expect(final._tag).toBe("Playing");
        if (final._tag === "Playing") {
          expect(final.room.id).toBe("r2");
          expect(final.item.ratingKey).toBe("200");
        }

        // Old socket torn down, new one started.
        expect(controllers.length).toBe(2);
        expect(controllers[0]?.disconnectCount.n).toBe(1);
        expect(controllers[1]?.connect).toHaveBeenCalledTimes(1);
        expect(player.loads).toHaveLength(2);
        expect(player.loads[1]?.opts).toEqual({ resume: false });
        expect(mirror.events.filter((e) => e.startsWith("setPlaying"))).toEqual(
          ["setPlaying:r1", "setPlaying:r2"],
        );
      }),
    { player, makeController, mirror },
  );
});

test("leave clears state, interrupts the controller, and can suppress auto-start", async () => {
  const { makeController, controllers } = makeStubControllerFactory();
  const mirror = makeMirror();

  await withSession(
    (session) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });
        yield* session.leave({ suppressAutoStart: true });

        expect(session.snapshot()._tag).toBe("Idle");
        expect(controllers[0]?.disconnectCount.n).toBe(1);
        expect(mirror.events).toContain("leave");
        expect(useWatchTogetherStore.getState().session).toBeNull();
        expect(useWatchTogetherStore.getState().autoStartSuppressedRoomId).toBe(
          "r1",
        );
      }),
    { makeController, mirror },
  );
});

test("local playback and seek forward to the live controller", async () => {
  const { makeController, controllers } = makeStubControllerFactory();

  await withSession(
    (session) =>
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
  const mirror = makeMirror();

  await withSession(
    (session) =>
      Effect.gen(function* () {
        yield* session.startPlayback({
          room: room("r1", "100"),
          localUser,
          item: item("100"),
        });

        const onFatal = controllers[0]?.options.onFatalError;
        expect(onFatal).toBeDefined();
        onFatal?.(new Error("socket dead"));

        // Fatal leave is forked; give it a turn to settle.
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        expect(session.snapshot()._tag).toBe("Idle");
        expect(mirror.events).toContain("clear");
        expect(mirror.events).not.toContain("leave");
        expect(
          useWatchTogetherStore.getState().autoStartSuppressedRoomId,
        ).toBeNull();
      }),
    { makeController, mirror },
  );
});

test("participant events mirror into the Zustand store", async () => {
  const { makeController, controllers } = makeStubControllerFactory();
  const mirror = makeMirror();

  await withSession(
    (session) =>
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

        expect(mirror.events).toContain("participant:device-2");
        expect(
          useWatchTogetherStore.getState().participants["device-2"],
        ).toMatchObject({ isPresent: true, isReady: true });

        const snap = session.snapshot();
        expect(snap._tag).toBe("Playing");
        if (snap._tag === "Playing") {
          expect(snap.participants["device-2"]).toMatchObject({
            isPresent: true,
            isReady: true,
          });
        }
      }),
    { makeController, mirror },
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
          mirror: makeMirror(),
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
