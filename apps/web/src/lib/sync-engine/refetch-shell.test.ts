import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { TRPCClient } from "@trpc/client";
import type { HubWithServer } from "@multiplex/plex-query";
import type { AppRouter } from "~/server/api/root";
import { warmLibraryHubs, type SyncEngineCollections } from "./collections";
import { refetchSyncedContinueWatching } from "./refetch-shell";
import { setActiveSyncEngineCollections } from "./registry";
import * as trpcClient from "./trpc-client";

afterEach(() => {
  setActiveSyncEngineCollections(null);
  mock.restore();
});

test.each([false, true])(
  "removal refreshes a pending library load (cached: %s) without duplicate requests",
  async (cached) => {
    const older = Promise.withResolvers<HubWithServer[]>();
    const query = mock()
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValue([]);
    const client = fromPartial<TRPCClient<AppRouter>>({
      plex: { getLibraryHubs: { query } },
    });
    spyOn(trpcClient, "getSyncEngineTrpcClient").mockReturnValue(client);
    const writeUpsert = mock();
    const input = { machineIdentifier: "server-1", sectionId: "1" };
    const snapshot = { id: "server-1:1", ...input, hubs: [] };
    const collections = fromPartial<SyncEngineCollections>({
      continueWatching: { utils: { refetch: mock(async () => undefined) } },
      libraryHubs: {
        status: "ready",
        toArray: cached ? [snapshot] : [],
        utils: { writeUpsert },
      },
    });
    setActiveSyncEngineCollections(collections);
    const initialLoad = warmLibraryHubs(collections, client, input);

    await refetchSyncedContinueWatching("server-1");
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
    await initialLoad;

    expect(query.mock.calls).toEqual([[input], [input]]);
    expect(writeUpsert.mock.calls).toEqual([[snapshot]]);
  },
);

test("removal refreshes home and cached Recommended rows on the affected server", async () => {
  const refetch = mock(async () => undefined);
  const writeUpsert = mock();
  const query = mock(
    async (_input: { machineIdentifier: string; sectionId: string }) => [],
  );
  spyOn(trpcClient, "getSyncEngineTrpcClient").mockReturnValue(
    fromPartial<TRPCClient<AppRouter>>({ plex: { getLibraryHubs: { query } } }),
  );
  setActiveSyncEngineCollections(
    fromPartial<SyncEngineCollections>({
      continueWatching: { utils: { refetch } },
      libraryHubs: {
        status: "ready",
        toArray: [
          {
            id: "server-1:1",
            machineIdentifier: "server-1",
            sectionId: "1",
            hubs: [],
          },
          {
            id: "server-1:2",
            machineIdentifier: "server-1",
            sectionId: "2",
            hubs: [],
          },
          {
            id: "server-2:1",
            machineIdentifier: "server-2",
            sectionId: "1",
            hubs: [],
          },
        ],
        utils: { writeUpsert },
      },
    }),
  );

  await refetchSyncedContinueWatching("server-1");

  expect(refetch).toHaveBeenCalledTimes(1);
  expect(refetch).toHaveBeenCalledWith({ throwOnError: true });
  expect(query.mock.calls).toEqual([
    [{ machineIdentifier: "server-1", sectionId: "1" }],
    [{ machineIdentifier: "server-1", sectionId: "2" }],
  ]);
  expect(writeUpsert.mock.calls).toEqual([
    [
      {
        id: "server-1:1",
        machineIdentifier: "server-1",
        sectionId: "1",
        hubs: [],
      },
    ],
    [
      {
        id: "server-1:2",
        machineIdentifier: "server-1",
        sectionId: "2",
        hubs: [],
      },
    ],
  ]);
});

test("removal reports refresh failures instead of treating stale rows as refreshed", async () => {
  const failure = new Error("Plex is unavailable");
  setActiveSyncEngineCollections(
    fromPartial<SyncEngineCollections>({
      continueWatching: {
        utils: { refetch: mock().mockRejectedValue(failure) },
      },
      libraryHubs: { toArray: [] },
    }),
  );

  const result = await Promise.allSettled([
    refetchSyncedContinueWatching("server-1"),
  ]);
  expect(result).toEqual([{ status: "rejected", reason: failure }]);
});
