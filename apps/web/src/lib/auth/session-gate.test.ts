import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const getSessionCookie = mock((_request: unknown) => null as string | null);
const getCookieCache = mock(
  async (_request: unknown, _config?: unknown) =>
    null as null | {
      session: { token: string };
      user: { name: string; email?: string; image?: string };
    },
);
const getSession = mock(async (_args: unknown) => ({
  headers: new Headers(),
  response: null as null | {
    session: { token: string };
    user: { name: string; email?: string; image?: string };
  },
}));

await mock.module("better-auth/cookies", () => ({
  getSessionCookie,
  getCookieCache,
}));

await mock.module("~/lib/auth/server", () => ({
  auth: {
    api: {
      getSession,
    },
  },
}));

const { gateDocumentSession } = await import("./session-gate");

function documentRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "GET",
    headers: {
      accept: "text/html",
      "sec-fetch-dest": "document",
      ...(cookie ? { cookie } : {}),
    },
  });
}

function apiRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "GET",
    headers: {
      accept: "application/json",
      "sec-fetch-dest": "empty",
    },
  });
}

describe("gateDocumentSession", () => {
  beforeEach(() => {
    getSessionCookie.mockReset();
    getCookieCache.mockReset();
    getSession.mockReset();
    getSessionCookie.mockImplementation(() => null);
    getCookieCache.mockImplementation(async () => null);
    getSession.mockImplementation(async () => ({
      headers: new Headers(),
      response: null,
    }));
    process.env.BETTER_AUTH_SECRET = "test-secret-with-sufficient-length";
  });

  test("does not gate non-document requests", async () => {
    const response = await gateDocumentSession(apiRequest("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getSessionCookie).not.toHaveBeenCalled();
  });

  test("redirects signed-out document navigations to login with returnTo", async () => {
    const response = await gateDocumentSession(
      documentRequest("/watch-together/room-1"),
    );

    expect(response.status).toBe(302);
    const location = new URL(
      response.headers.get("location") ?? "",
      "http://localhost:3000",
    );
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe(
      "/watch-together/room-1",
    );

    const setCookies = response.headers.getSetCookie();
    expect(
      setCookies.some(
        (value) =>
          value.includes("better-auth.session_token=") &&
          value.includes("Max-Age=0"),
      ),
    ).toBe(true);
    expect(
      setCookies.some(
        (value) =>
          value.includes("multiplex.auth_hint=") && value.includes("Max-Age=0"),
      ),
    ).toBe(true);
  });

  test("serves the app when the signed cookie cache is valid", async () => {
    getSessionCookie.mockImplementation(() => "session-token");
    getCookieCache.mockImplementation(async () => ({
      session: { token: "session-token" },
      user: { name: "Augie", email: "a@example.com" },
    }));

    const response = await gateDocumentSession(documentRequest("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getSession).not.toHaveBeenCalled();

    const setCookies = response.headers.getSetCookie();
    expect(
      setCookies.some((value) => value.startsWith("multiplex.auth_hint=")),
    ).toBe(true);
  });

  test("clears invalid carriers when getSession returns null", async () => {
    getSessionCookie.mockImplementation(() => "stale-token");
    getCookieCache.mockImplementation(async () => null);
    const clearHeaders = new Headers();
    clearHeaders.append(
      "set-cookie",
      "better-auth.session_token=; Max-Age=0; Path=/",
    );
    getSession.mockImplementation(async () => ({
      headers: clearHeaders,
      response: null,
    }));

    const response = await gateDocumentSession(documentRequest("/media/abc"));

    expect(response.status).toBe(302);
    const location = new URL(
      response.headers.get("location") ?? "",
      "http://localhost:3000",
    );
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("returnTo")).toBe("/media/abc");
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.includes("better-auth.session_token=")),
    ).toBe(true);
  });

  test("public login path is not redirected", async () => {
    const response = await gateDocumentSession(documentRequest("/login"));
    expect(response.status).toBe(200);
  });
});
