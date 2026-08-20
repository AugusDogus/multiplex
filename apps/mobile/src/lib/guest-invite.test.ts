import { describe, expect, test } from "bun:test";

import { parseGuestCapability } from "./guest-invite-url";

describe("parseGuestCapability", () => {
  test("reads web guest links", () => {
    expect(parseGuestCapability("https://multiplex.example/watch-together/guest/a%2Fb")).toBe(
      "a/b",
    );
  });

  test("reads native guest links", () => {
    expect(parseGuestCapability("multiplex://watch-together/guest/invite-token")).toBe(
      "invite-token",
    );
  });

  test("rejects unrelated and malformed links", () => {
    expect(parseGuestCapability("https://multiplex.example/login")).toBeNull();
    expect(parseGuestCapability("not a link")).toBeNull();
  });
});
