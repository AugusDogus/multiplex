import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { TRPCClient } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import type { SyncEngineCollections } from "./collections";
import { refetchSyncedContinueWatching } from "./refetch-shell";
import { setActiveSyncEngineCollections } from "./registry";
import * as trpcClient from "./trpc-client";

afterEach(() => {
  setActiveSyncEngineCollections(null);
  mock.restore();
});

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
