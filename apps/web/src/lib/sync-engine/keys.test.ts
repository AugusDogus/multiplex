import { describe, expect, test } from "bun:test";

import {
  continueWatchingRowKey,
  homeHubRowKey,
  mediaItemRowKey,
  parseCompositeKey,
  serverLibraryRowKey,
  serverRowKey,
} from "./keys";

describe("sync-engine keys", () => {
  test("builds stable composite keys", () => {
    expect(serverRowKey("abc")).toBe("abc");
    expect(serverLibraryRowKey("abc")).toBe("abc");
    expect(continueWatchingRowKey("srv", "42")).toBe("srv:42");
    expect(homeHubRowKey("srv", "/hubs/home")).toBe("srv:/hubs/home");
    expect(mediaItemRowKey("srv", "99")).toBe("srv:99");
  });

  test("parseCompositeKey splits on the first colon only", () => {
    expect(parseCompositeKey("srv:/hubs/home:continue")).toEqual({
      serverId: "srv",
      localKey: "/hubs/home:continue",
    });
    expect(parseCompositeKey("")).toBeNull();
    expect(parseCompositeKey(":nope")).toBeNull();
    expect(parseCompositeKey("nope:")).toBeNull();
    expect(parseCompositeKey("nocolon")).toBeNull();
  });
});
