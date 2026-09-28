import { expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { TRPCClient } from "@trpc/client";
import type { HubWithServer } from "@multiplex/plex-query";

import type { AppRouter } from "~/server/api/root";
import {
  warmLibraryHubs,
  warmMediaItem,
  type SyncEngineCollections,
} from "./collections";

test("an older library refresh cannot restore items after a newer removal refresh", async () => {
  const older = Promise.withResolvers<HubWithServer[]>();
  const newer = Promise.withResolvers<HubWithServer[]>();
  const writeUpsert = mock();
  const collections = fromPartial<SyncEngineCollections>({
    libraryHubs: { status: "ready", utils: { writeUpsert } },
  });
  const trpc = fromPartial<TRPCClient<AppRouter>>({
    plex: {
      getLibraryHubs: {
        query: mock()
          .mockImplementationOnce(() => older.promise)
          .mockImplementationOnce(() => newer.promise),
      },
    },
  });
  const input = { machineIdentifier: "server-1", sectionId: "1" };
  const olderRefresh = warmLibraryHubs(collections, trpc, input);
  const newerRefresh = warmLibraryHubs(collections, trpc, input);

  newer.resolve([]);
  await newerRefresh;
  older.resolve([
    {
      serverId: "server-1",
      key: "/hubs/continueWatching",
      title: "Continue Watching",
      type: "movie",
      hubIdentifier: "home.continue",
      size: 1,
      items: [
        {
          serverId: "server-1",
          ratingKey: "42",
          key: "/library/metadata/42",
          type: "movie",
          title: "Removed movie",
        },
      ],
    },
  ]);
  await olderRefresh;

  expect(writeUpsert).toHaveBeenCalledTimes(1);
  expect(writeUpsert).toHaveBeenCalledWith({
    id: "server-1:1",
    ...input,
    hubs: [],
  });
});

test("warmMediaItem evicts cached details after an authoritative miss", async () => {
  const events: string[] = [];
  const preload = mock(async () => {
    events.push("preload");
  });
  const writeDelete = mock();
  const collections = fromPartial<SyncEngineCollections>({
    mediaItems: {
      status: "loading",
      preload,
      utils: {
        writeDelete: (key: string) => {
          events.push(`delete:${key}`);
          writeDelete(key);
        },
      },
    },
  });
  const trpc = fromPartial<TRPCClient<AppRouter>>({
    plex: {
      getItemDetails: {
        query: mock().mockResolvedValue(null),
      },
    },
  });

  const result = await warmMediaItem(collections, trpc, {
    serverId: "server-1",
    ratingKey: "100",
  });

  expect(result).toBeNull();
  expect(events).toEqual(["preload", "delete:server-1:100"]);
  expect(writeDelete).toHaveBeenCalledWith("server-1:100");
});

test("warmMediaItem propagates an authoritative eviction failure", async () => {
  const writeDelete = mock();
  const collections = fromPartial<SyncEngineCollections>({
    mediaItems: {
      status: "loading",
      preload: mock().mockRejectedValue(new Error("persistence unavailable")),
      utils: { writeDelete },
    },
  });
  const trpc = fromPartial<TRPCClient<AppRouter>>({
    plex: {
      getItemDetails: {
        query: mock().mockResolvedValue(null),
      },
    },
  });

  const error = await captureFailure(
    warmMediaItem(collections, trpc, {
      serverId: "server-1",
      ratingKey: "100",
    }),
  );
  expect(error).toEqual(new Error("persistence unavailable"));
  expect(writeDelete).not.toHaveBeenCalled();
});

async function captureFailure(
  operation: Promise<unknown>,
): Promise<Error | null> {
  try {
    await operation;
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause : new Error("Non-Error rejection");
  }
}
