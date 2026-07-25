import { describe, expect, test } from "bun:test";

import { decodeOAuthState, encodeOAuthState, sanitizeReturnTo } from "./return-to";

describe("sanitizeReturnTo", () => {
  test("keeps same-origin relative app paths", () => {
    expect(sanitizeReturnTo("/watch-together/abc")).toBe("/watch-together/abc");
    expect(sanitizeReturnTo("/media/1/library/2")).toBe("/media/1/library/2");
    expect(sanitizeReturnTo("/")).toBe("/");
  });

  test("rejects absolute, protocol-relative, and API paths", () => {
    expect(sanitizeReturnTo("https://evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("//evil.example/phish")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example")).toBe("/");
    expect(sanitizeReturnTo("/api/auth/plex/auth/callback")).toBe("/");
    expect(sanitizeReturnTo("/api")).toBe("/");
    expect(sanitizeReturnTo("/login")).toBe("/");
    expect(sanitizeReturnTo("/login?x=1")).toBe("/");
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo(12)).toBe("/");
  });
});

describe("encodeOAuthState / decodeOAuthState", () => {
  test("round-trips nonce and returnTo", () => {
    const encoded = encodeOAuthState({
      nonce: "abc123nonce",
      returnTo: "/watch-together/room-1",
    });
    const decoded = decodeOAuthState(encoded);

    expect(decoded).toEqual({
      nonce: "abc123nonce",
      returnTo: "/watch-together/room-1",
    });
  });

  test("omits default returnTo from the payload and decodes to /", () => {
    const encoded = encodeOAuthState({ nonce: "n", returnTo: "/" });
    const json = Buffer.from(encoded, "base64url").toString("utf8");

    expect(JSON.parse(json)).toEqual({ nonce: "n" });
    expect(decodeOAuthState(encoded)).toEqual({ nonce: "n", returnTo: "/" });
  });

  test("sanitizes a forged returnTo inside state", () => {
    const forged = Buffer.from(
      JSON.stringify({ nonce: "n", returnTo: "https://evil.example" }),
      "utf8",
    ).toString("base64url");

    expect(decodeOAuthState(forged)).toEqual({ nonce: "n", returnTo: "/" });
  });

  test("junk state never throws", () => {
    expect(decodeOAuthState("!!!")).toBeNull();
    expect(decodeOAuthState("")).toBeNull();
    expect(decodeOAuthState(null)).toBeNull();
    expect(decodeOAuthState("{")).toBeNull();
  });
});
