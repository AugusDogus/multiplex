import { describe, expect, test } from "bun:test";

import {
  authHintFromUser,
  parseAuthHint,
  serializeAuthHint,
} from "./auth-hint";

describe("auth hint cookie", () => {
  test("round-trips a valid hint", () => {
    const encoded = serializeAuthHint({
      name: "Augie",
      email: "augie@example.com",
      image: "https://example.com/a.png",
    });

    expect(parseAuthHint(encoded)).toEqual({
      v: 1,
      name: "Augie",
      email: "augie@example.com",
      image: "https://example.com/a.png",
    });
  });

  test("treats malformed payloads as absent", () => {
    expect(parseAuthHint("not-valid")).toBeNull();
    expect(parseAuthHint("")).toBeNull();
    expect(
      parseAuthHint(
        Buffer.from(JSON.stringify({ v: 2, name: "x" }), "utf8").toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });

  test("authHintFromUser requires a name", () => {
    expect(authHintFromUser({ name: null, email: "a@b.c" })).toBeNull();
    expect(authHintFromUser({ name: "A" })).toEqual({ v: 1, name: "A" });
  });
});
