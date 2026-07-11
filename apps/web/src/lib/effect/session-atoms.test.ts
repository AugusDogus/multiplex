import { expect, mock, test } from "bun:test";
import type {
  SessionState,
  SyncplaySessionControllerOptions,
  SyncplayUser,
  WatchTogetherRoom,
} from "@multiplex/plex-query";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { MediaPlayerItem } from "~/types/media-player";

import { makeSessionLifecycleCommands } from "./session-atoms";
import { makePlayerPort, PlayerPort } from "./player-port";
import { createPlayerService } from "./player-service";
import {
  WatchTogetherSession,
  type MakeObserverConnection,
  type MakeSessionController,
} from "./session-service";

const room: WatchTogetherRoom = {
  id: "room-1",
  sourceUri: "server://srv/com.plexapp.plugins.library/library/metadata/100",
  title: "Room 1",
  type: "video",
  syncplayHost: "syncplay.example.com",
  syncplayPort: 443,
  users: [
    { id: 1, title: "Host", username: "host", thumb: null },
    { id: 2, title: "Guest", username: "guest", thumb: null },
  ],
};

const localUser: SyncplayUser = {
  id: 1,
  deviceIdentifier: "device-1",
  deviceName: "Multiplex Web",
};

const item = {
  ratingKey: "100",
  key: "/library/metadata/100",
  title: "Item 100",
  type: "episode",
  hubTitle: "TV",
  hubType: "metadata",
  serverId: "srv",
  serverUrl: "https://plex.example",
  authToken: "token",
  duration: 600_000,
} as MediaPlayerItem;

const makeController: MakeSessionController = (
  _options: SyncplaySessionControllerOptions,
) => ({
  connect: mock(() => undefined),
  disconnect: mock(() => undefined),
  setReady: mock(() => undefined),
  handleLocalPlaybackChange: mock(() => undefined),
  handleLocalSeeked: mock(() => undefined),
});

const makeObserver: MakeObserverConnection = () => ({
  connect: mock(() => undefined),
  disconnect: mock(() => undefined),
  setReady: mock(() => undefined),
});

const withCommands = async (
  run: (context: {
    commands: ReturnType<typeof makeSessionLifecycleCommands>;
    snapshot: () => SessionState;
  }) => Promise<void>,
) => {
  const player = makePlayerPort(createPlayerService());
  const layer = WatchTogetherSession.layer({
    player,
    makeController,
    makeObserver,
  }).pipe(Layer.provideMerge(Layer.succeed(PlayerPort)(player)));
  const runtime = ManagedRuntime.make(layer);

  try {
    const session = runtime.runSync(
      Effect.gen(function* () {
        return yield* WatchTogetherSession;
      }),
    );
    await run({
      commands: makeSessionLifecycleCommands(runtime, session),
      snapshot: session.snapshot,
    });
  } finally {
    await runtime.dispose();
  }
};

test("facade queues exit behind a pending enter", async () => {
  await withCommands(async ({ commands, snapshot }) => {
    const entering = commands.enterLobby({ room, localUser }).completion;
    const exiting = commands.exitLobby({
      expectedRoomId: room.id,
    }).completion;

    await Promise.all([entering, exiting]);

    expect(snapshot()).toEqual({ _tag: "Idle" });
  });
});

test("facade queues leave behind a pending start", async () => {
  await withCommands(async ({ commands, snapshot }) => {
    const starting = commands.startPlayback({
      room,
      localUser,
      item,
    }).completion;
    const leaving = commands.leave({
      suppressAutoStart: false,
      expectedRoomId: room.id,
    }).completion;

    expect(await starting).toBe(true);
    await leaving;

    expect(snapshot()).toEqual({ _tag: "Idle" });
  });
});
