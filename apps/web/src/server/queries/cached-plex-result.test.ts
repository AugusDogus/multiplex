import { describe, expect, test } from "bun:test";
import { PlexAPIError } from "@multiplex/plex-query";

import {
  CachedPlexResult,
  isPlexAuthExpired,
} from "~/server/queries/cached-plex-result";

describe("CachedPlexResult", () => {
  test("capture wraps a successful value", async () => {
    const result = await CachedPlexResult.capture(async () => 42);

    expect(result).toEqual({ kind: "ok", value: 42 });
  });

  test("capture encodes a Plex 401 as auth-expired data", async () => {
    const result = await CachedPlexResult.capture(async () => {
      throw new PlexAPIError("expired", 401);
    });

    expect(result).toEqual({ kind: "auth-expired" });
  });

  test("capture rethrows non-auth failures untouched", async () => {
    const failure = new PlexAPIError("boom", 500);

    let caught: unknown;
    try {
      await CachedPlexResult.capture(async () => {
        throw failure;
      });
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBe(failure);
  });

  test("unwrap returns the ok value", () => {
    expect(CachedPlexResult.unwrap({ kind: "ok", value: "servers" })).toBe(
      "servers",
    );
  });

  test("unwrap re-raises auth-expired as a classifiable PlexAPIError", () => {
    let caught: unknown;
    try {
      CachedPlexResult.unwrap({ kind: "auth-expired" });
    } catch (cause) {
      caught = cause;
    }

    expect(isPlexAuthExpired(caught)).toBe(true);
  });

  test("isPlexAuthExpired ignores Flight-reconstructed plain errors", () => {
    // What a caller sees after a thrown PlexAPIError crosses "use cache".
    expect(isPlexAuthExpired(new Error("Plex authentication failed."))).toBe(
      false,
    );
    expect(isPlexAuthExpired(new PlexAPIError("not found", 404))).toBe(false);
  });
});
