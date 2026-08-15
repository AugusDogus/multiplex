import { describe, expect, test } from "bun:test";

import {
  consumeReloadPlaybackSession,
  storeReloadPlaybackSession,
  type ReloadPlaybackSession,
} from "./reload-playback-session";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const SESSION: ReloadPlaybackSession = {
  serverId: "server-1",
  ratingKey: "episode-1",
  streamSessionId: "playback123",
  transcodeSessionId: "transcode123",
  streamOffset: 420,
  transcodeAttempt: 2,
  savedAt: 1_000,
};

describe("reload playback session", () => {
  test("restores the exact transcode identity once after a reload", () => {
    const storage = makeStorage();
    expect(storeReloadPlaybackSession(storage, SESSION)).toBe(true);

    expect(
      consumeReloadPlaybackSession(
        storage,
        { serverId: "server-1", ratingKey: "episode-1" },
        2_000,
      ),
    ).toEqual(SESSION);
    expect(
      consumeReloadPlaybackSession(
        storage,
        { serverId: "server-1", ratingKey: "episode-1" },
        2_000,
      ),
    ).toBeNull();
  });

  test("rejects malformed, stale, and different-item records", () => {
    const malformed = makeStorage();
    malformed.setItem("multiplex:reload-playback-session", "not-json");
    expect(
      consumeReloadPlaybackSession(
        malformed,
        { serverId: "server-1", ratingKey: "episode-1" },
        2_000,
      ),
    ).toBeNull();

    const stale = makeStorage();
    storeReloadPlaybackSession(stale, SESSION);
    expect(
      consumeReloadPlaybackSession(
        stale,
        { serverId: "server-1", ratingKey: "episode-1" },
        62_000,
      ),
    ).toBeNull();

    const differentItem = makeStorage();
    storeReloadPlaybackSession(differentItem, SESSION);
    expect(
      consumeReloadPlaybackSession(
        differentItem,
        { serverId: "server-1", ratingKey: "episode-2" },
        2_000,
      ),
    ).toBeNull();
  });
});
