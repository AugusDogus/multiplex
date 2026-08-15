import { describe, expect, test } from "bun:test";

import { assertMatchingAccountIdentities, cookieHeader } from "./provision-gamecube";

describe("cookieHeader", () => {
  test("selects only live cookies valid for the Multiplex claim endpoint", () => {
    const nowSeconds = 1_700_000_000;
    const cookies = cookieHeader(
      {
        cookies: [
          {
            name: "session",
            value: "private",
            domain: "multiplex.localhost",
            path: "/",
            expires: nowSeconds + 60,
            secure: true,
          },
          {
            name: "expired",
            value: "ignored",
            domain: "multiplex.localhost",
            path: "/",
            expires: nowSeconds - 1,
            secure: true,
          },
          {
            name: "other-origin",
            value: "ignored",
            domain: "plex.tv",
            path: "/",
            expires: -1,
            secure: true,
          },
          {
            name: "wrong-path",
            value: "ignored",
            domain: ".multiplex.localhost",
            path: "/account",
            expires: -1,
            secure: true,
          },
        ],
      },
      new URL("https://multiplex.localhost/api/console/pairings/claim"),
      nowSeconds,
    );

    expect(cookies).toBe("session=private");
  });
});

describe("assertMatchingAccountIdentities", () => {
  test("accepts the same Plex account across both credential sources", () => {
    expect(() =>
      assertMatchingAccountIdentities(
        { id: 42, username: "multiplextest" },
        { id: 42, username: "multiplextest" },
      ),
    ).not.toThrow();
  });

  test("rejects a Plex token and Multiplex session from different accounts", () => {
    expect(() =>
      assertMatchingAccountIdentities(
        { id: 42, username: "multiplextest" },
        { id: 7, username: "other-account" },
      ),
    ).toThrow(/Account A identity mismatch/);
  });
});
