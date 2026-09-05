import { beforeEach, expect, test } from "bun:test";
import { CREATE_BASE_DELAY_MS } from "@multiplex/plex-query";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { playerCommands } from "./player-atoms";
import {
  item,
  localUser,
  multiplexUser,
  nextEpisode,
  room,
  startArmed,
  waitUntil,
  withRotationSession,
} from "./session-rotation-harness";

beforeEach(() => {
  playerCommands.closePlayer();
});

test("a host-controlled host owns room rotation for Guest Link sessions", async () => {
  await withRotationSession(
    ({ session, player, createRoom, deleteRoom, observers }) =>
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
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");
        expect(
          snap._tag === "Playing" &&
            snap.rotation._tag === "RoomKnown" &&
            snap.rotation.nextRoom.id,
        ).toBe("r-created");

        yield* TestClock.adjust(`${CREATE_BASE_DELAY_MS + 100} millis`);
        yield* Effect.yieldNow;
        expect(createRoom).toHaveBeenCalledTimes(1);

        player.setPlayback({ currentTimeSeconds: 1200, durationSeconds: 1200 });
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;

        const completed = session.snapshot();
        expect(completed._tag === "Playing" && completed.room.id).toBe(
          "r-created",
        );
        expect(observers.length).toBeGreaterThanOrEqual(1);
        expect(deleteRoom).not.toHaveBeenCalled();
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
        expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");

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

test("a stalled viewer arms rotation from a present peer's room progress", async () => {
  await withRotationSession(({ session, player, controllers }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });
      player.setPlayback({
        currentTimeSeconds: 400,
        durationSeconds: 1200,
      });
      yield* session.setRotationContext({
        nextEpisode,
        autoPlayEnabled: true,
      });

      controllers[0]?.options.onParticipant?.({
        user: multiplexUser(2),
        isPresent: true,
        positionSeconds: 1160,
      });
      yield* TestClock.adjust("1 second");
      yield* Effect.yieldNow;

      const snap = session.snapshot();
      expect(snap._tag === "Playing" && snap.rotation._tag).toBe("RoomKnown");
      expect(
        snap._tag === "Playing" &&
          snap.rotation._tag === "RoomKnown" &&
          snap.rotation.nextRoom.id,
      ).toBe("r-created");
    }),
  );
});

test("an abrupt EOF seek arms rotation within the final half-second", async () => {
  await withRotationSession(({ session, player, createRoom }) =>
    Effect.gen(function* () {
      yield* session.startPlayback({
        room: room("r1", "100"),
        localUser,
        item: item("100"),
      });
      player.setPlayback({
        currentTimeSeconds: 400,
        durationSeconds: 1200,
      });
      yield* session.setRotationContext({
        nextEpisode,
        autoPlayEnabled: true,
      });
      yield* Effect.yieldNow;

      const beforeEof = session.snapshot();
      expect(beforeEof._tag === "Playing" && beforeEof.rotation._tag).toBe(
        "None",
      );

      player.setPlayback({ currentTimeSeconds: 1199.5 });
      yield* TestClock.adjust("250 millis");
      yield* Effect.yieldNow;

      const armed = session.snapshot();
      expect(armed._tag === "Playing" && armed.rotation._tag).not.toBe("None");
      expect(createRoom).toHaveBeenCalledTimes(1);

      // Once armed, a media element briefly resetting after EOF must not
      // cancel target-specific room creation and discovery work.
      player.setPlayback({ currentTimeSeconds: 0 });
      yield* TestClock.adjust("250 millis");
      yield* Effect.yieldNow;

      const latched = session.snapshot();
      expect(latched._tag === "Playing" && latched.rotation._tag).not.toBe(
        "None",
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
