import { beforeEach, expect, test } from "bun:test";
import {
  CREATE_BASE_DELAY_MS,
  CREATE_STAGGER_MS,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import type { NextEpisodeInfo } from "~/types/media-player";

import { playerCommands } from "./player-atoms";
import {
  item,
  localUser,
  multiplexUser,
  nextEpisode,
  NOW,
  room,
  startArmed,
  waitUntil,
  withRotationSession,
} from "./session-rotation-harness";
import { WatchTogetherApiError } from "./watch-together-api";

beforeEach(() => {
  playerCommands.closePlayer();
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
          return Effect.fail(
            new WatchTogetherApiError({
              cause: "transient",
              operation: "createRoom",
            }),
          );
        }
        return Effect.succeed(room("r-created", "200"));
      },
    },
  );
});
