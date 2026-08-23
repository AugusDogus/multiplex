import { expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import type { TRPCClient } from "@trpc/client";

import type { AppRouter } from "~/server/api/root";
import { warmMediaItem, type SyncEngineCollections } from "./collections";

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
