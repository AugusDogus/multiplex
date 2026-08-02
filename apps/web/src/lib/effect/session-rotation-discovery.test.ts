import { beforeEach, expect, test } from "bun:test";
import {
  CREATE_BASE_DELAY_MS,
  DISCOVERY_POLL_MS,
  EVERYONE_JOINED_GRACE_MS,
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

beforeEach(() => {
  playerCommands.closePlayer();
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
