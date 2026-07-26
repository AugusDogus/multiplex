import { describe, expect, test } from "bun:test";

import { decodeOAuthState, encodeOAuthState, sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  test("rejects open-redirect shapes", () => {
    expect(sanitizeReturnTo("https://evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("//evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example")).toBe("/");
    expect(sanitizeReturnTo("/api/auth/plex/auth/callback")).toBe("/");
    expect(sanitizeReturnTo("/api")).toBe("/");
    expect(sanitizeReturnTo("/api?x=1")).toBe("/");
    expect(sanitizeReturnTo("/api#x")).toBe("/");
    expect(sanitizeReturnTo("/login")).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
  });

  test("keeps in-app relative paths", () => {
    expect(sanitizeReturnTo("/watch-together/abc")).toBe("/watch-together/abc");
    expect(sanitizeReturnTo("/media/1/library/2?tab=all")).toBe("/media/1/library/2?tab=all");
  });
});

describe("decodeOAuthState", () => {
  test("forged off-origin returnTo inside state collapses to /", () => {
    const forged = Buffer.from(
      JSON.stringify({ nonce: "n", returnTo: "https://evil.example" }),
      "utf8",
    ).toString("base64url");

    expect(decodeOAuthState(forged)).toEqual({ nonce: "n", returnTo: "/" });
  });

  test("provider junk never throws", () => {
    expect(decodeOAuthState("!!!")).toBeNull();
    expect(decodeOAuthState("")).toBeNull();
    expect(decodeOAuthState(null)).toBeNull();
    expect(decodeOAuthState("{")).toBeNull();
  });

  test("encode/decode preserves a safe returnTo for the callback", () => {
    const state = encodeOAuthState({
      nonce: "abc",
      returnTo: "/watch-together/room-1",
    });
    expect(decodeOAuthState(state)).toEqual({
      nonce: "abc",
      returnTo: "/watch-together/room-1",
    });
  });
});
