import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { PlexTvAuthService, type PlexUserInfo } from "@multiplex/plex-query";
import { createEndpoint } from "better-call";
import { decodeOAuthState } from "./return-to";
import { plex } from "./server";

const AUTH_BASE_URL = "https://multiplex.example/api/auth";
const AUTH_SECRET = "test-only-better-auth-secret-with-sufficient-length";
const ATTEMPT_COOKIE_NAME = "multiplex.plex_auth_attempt";

const originalFetch = globalThis.fetch;

const pinResponse = {
  id: 42,
  code: "pin-code",
  product: "Multiplex",
  trusted: false,
  qr: "qr-value",
  clientIdentifier: "multiplex-app",
  location: {
    code: "US",
    european_union_member: false,
    continent_code: "NA",
    country: "United States",
    city: "Chicago",
    time_zone: "America/Chicago",
    postal_code: "60601",
    in_privacy_restricted_country: false,
    subdivisions: "Illinois",
    coordinates: "0,0",
  },
  expiresIn: 600,
  createdAt: new Date(Date.now() - 1_000).toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  authToken: null,
  newRegistration: null,
};

const plexUser = fromPartial<PlexUserInfo>({
  id: 7,
  uuid: "plex-user-uuid",
  username: "plex-user",
  email: "plex-user@example.com",
  friendlyName: "Plex User",
  thumb: "https://example.com/avatar.png",
  confirmed: true,
});

const betterAuthUser = {
  id: "better-auth-user",
  name: "Plex User",
  email: "plex-user@example.com",
  emailVerified: true,
  image: "https://example.com/avatar.png",
  createdAt: new Date(),
  updatedAt: new Date(),
  plexId: plexUser.id,
  plexUuid: plexUser.uuid,
  plexUsername: plexUser.username,
  plexAuthToken: "authorized-token",
};

class CookieJar {
  readonly values = new Map<string, string>();

  apply(headers: Headers): void {
    for (const setCookie of headers.getSetCookie()) {
      const [pair = "", ...attributes] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;

      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const isExpired = attributes.some((attribute) =>
        attribute.trim().toLowerCase().startsWith("max-age=0"),
      );

      if (isExpired || value === "") {
        this.values.delete(name);
      } else {
        this.values.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function createContext() {
  const calls = {
    createAccount: 0,
    createSession: 0,
    createUser: 0,
    updateUser: 0,
  };

  const context = {
    baseURL: AUTH_BASE_URL,
    secret: AUTH_SECRET,
    options: {},
    sessionConfig: {
      expiresIn: 60 * 60,
    },
    authCookies: {
      sessionToken: {
        name: "better-auth.session_token",
        options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
      },
      sessionData: {
        name: "better-auth.session_data",
        options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
      },
      dontRememberToken: {
        name: "better-auth.dont_remember",
        options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
      },
    },
    setNewSession: mock(() => {}),
    adapter: {
      findOne: mock(async ({ model }: { model: string }) =>
        model === "user" ? { id: betterAuthUser.id, plexUuid: betterAuthUser.plexUuid } : null,
      ),
      delete: mock(async () => {}),
    },
    internalAdapter: {
      createUser: mock(async () => {
        calls.createUser += 1;
        return betterAuthUser;
      }),
      updateUser: mock(async () => {
        calls.updateUser += 1;
        return betterAuthUser;
      }),
      createAccount: mock(async () => {
        calls.createAccount += 1;
        return {};
      }),
      createSession: mock(async () => {
        calls.createSession += 1;
        return {
          id: "session-id",
          token: "session-token",
          userId: betterAuthUser.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        };
      }),
    },
  };

  return { calls, context };
}

function createPlexFetch(pin = pinResponse) {
  return mock(async (_input: string | URL | Request, init?: RequestInit) => {
    const body =
      init?.method === "POST"
        ? pin
        : {
            ...pin,
            authToken: "authorized-token",
          };

    return Response.json(body);
  });
}

function extractCallback(response: Response): URL {
  const redirect = new URL(response.headers.get("location") ?? "");
  const authParams = new URLSearchParams(redirect.hash.replace(/^#!\?/, ""));
  return new URL(authParams.get("forwardUrl") ?? "");
}

function requireResponse(value: unknown): Response {
  if (!(value instanceof Response)) {
    throw new TypeError("Expected endpoint to return a Response");
  }

  return value;
}

async function initiate(
  jar: CookieJar,
  context: ReturnType<typeof createContext>["context"],
  query: Record<string, unknown> = {},
) {
  const response = requireResponse(
    await plex().endpoints.initiatePlexAuth(
      fromAny({
        asResponse: true,
        context,
        query,
      }),
    ),
  );
  jar.apply(response.headers);
  return { callback: extractCallback(response), response };
}

async function callback(
  jar: CookieJar,
  context: ReturnType<typeof createContext>["context"],
  query: Record<string, unknown>,
) {
  const response = requireResponse(
    await plex().endpoints.plexCallback(
      fromAny({
        asResponse: true,
        context,
        headers: new Headers({ cookie: jar.header() }),
        query,
      }),
    ),
  );
  jar.apply(response.headers);
  return response;
}

async function signAttemptCookie(payload: unknown): Promise<string> {
  const signer = createEndpoint("/test/sign-cookie", { method: "GET" }, async (ctx) => {
    await ctx.setSignedCookie(ATTEMPT_COOKIE_NAME, JSON.stringify(payload), AUTH_SECRET, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/api/auth/plex/auth",
    });
    return { ok: true };
  });
  const result = await signer({ returnHeaders: true });
  const jar = new CookieJar();
  jar.apply(result.headers);
  return jar.values.get(ATTEMPT_COOKIE_NAME) ?? "";
}

function expectNoDownstreamCalls(
  fetchMock: ReturnType<typeof createPlexFetch>,
  getUserInfoSpy: ReturnType<typeof spyOn>,
  calls: ReturnType<typeof createContext>["calls"],
): void {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getUserInfoSpy).not.toHaveBeenCalled();
  expect(calls.createAccount).toBe(0);
  expect(calls.createSession).toBe(0);
  expect(calls.createUser).toBe(0);
  expect(calls.updateUser).toBe(0);
}

describe("Plex authentication attempt binding", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let fetchMock: ReturnType<typeof createPlexFetch>;
  let getUserInfoSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    fetchMock = createPlexFetch();
    globalThis.fetch = Object.assign(fetchMock, {
      preconnect: originalFetch.preconnect.bind(originalFetch),
    });
    getUserInfoSpy = spyOn(PlexTvAuthService.prototype, "getUserInfo").mockResolvedValue(plexUser);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
    getUserInfoSpy.mockRestore();
  });

  test("does not expose token-forwarding endpoints", () => {
    const endpointNames = Object.keys(plex().endpoints);

    expect(endpointNames).toContain("initiatePlexAuth");
    expect(endpointNames).toContain("plexCallback");
    expect(endpointNames).not.toContain("getPlexServers");
    expect(endpointNames).not.toContain("getPlexUser");
  });

  test("derives the callback authority and sets a short-lived protected cookie", async () => {
    const jar = new CookieJar();
    const { context } = createContext();
    const { callback: callbackUrl, response } = await initiate(jar, context);
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${ATTEMPT_COOKIE_NAME}=`));

    expect(response.status).toBe(302);
    expect(callbackUrl.origin).toBe("https://multiplex.example");
    expect(callbackUrl.pathname).toBe("/api/auth/plex/auth/callback");
    expect(callbackUrl.searchParams.get("id")).toBe(String(pinResponse.id));
    expect(callbackUrl.searchParams.get("code")).toBe(pinResponse.code);
    const state = callbackUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(decodeOAuthState(state)).toMatchObject({ returnTo: "/" });
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/api/auth/plex/auth");
  });

  test("completes authentication for the initiating browser and consumes the attempt", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    const { callback: callbackUrl } = await initiate(jar, context);
    fetchMock.mockClear();

    const response = await callback(jar, context, {
      id: callbackUrl.searchParams.get("id"),
      code: callbackUrl.searchParams.get("code"),
      state: callbackUrl.searchParams.get("state"),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(jar.values.has(ATTEMPT_COOKIE_NAME)).toBeFalse();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUserInfoSpy).toHaveBeenCalledWith("authorized-token");
    expect(calls.updateUser).toBe(1);
    expect(calls.createAccount).toBe(1);
    expect(calls.createSession).toBe(1);
  });

  test("redirects to a sanitized returnTo carried in OAuth state", async () => {
    const jar = new CookieJar();
    const { context } = createContext();
    const { callback: callbackUrl } = await initiate(jar, context, {
      returnTo: "/watch-together/room-42",
    });

    expect(decodeOAuthState(callbackUrl.searchParams.get("state"))).toEqual({
      nonce: expect.any(String),
      returnTo: "/watch-together/room-42",
    });

    const response = await callback(jar, context, Object.fromEntries(callbackUrl.searchParams));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/watch-together/room-42");
  });

  test("forged off-origin returnTo lands on / after a successful callback", async () => {
    const jar = new CookieJar();
    const { context } = createContext();
    const { callback: callbackUrl } = await initiate(jar, context, {
      returnTo: "https://evil.example/phish",
    });

    expect(decodeOAuthState(callbackUrl.searchParams.get("state"))?.returnTo).toBe("/");

    const response = await callback(jar, context, Object.fromEntries(callbackUrl.searchParams));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("rejects a callback from a foreign browser before downstream work", async () => {
    const initiatingJar = new CookieJar();
    const foreignJar = new CookieJar();
    const { calls, context } = createContext();
    const { callback: callbackUrl } = await initiate(initiatingJar, context);
    fetchMock.mockClear();

    const response = await callback(foreignJar, context, {
      id: callbackUrl.searchParams.get("id"),
      code: callbackUrl.searchParams.get("code"),
      state: callbackUrl.searchParams.get("state"),
    });

    expect(response.status).toBe(401);
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test.each(["id", "code", "state"] as const)(
    "rejects a mismatched %s and consumes the attempt",
    async (field) => {
      const jar = new CookieJar();
      const { calls, context } = createContext();
      const { callback: callbackUrl } = await initiate(jar, context);
      fetchMock.mockClear();
      const query = {
        id: callbackUrl.searchParams.get("id"),
        code: callbackUrl.searchParams.get("code"),
        state: callbackUrl.searchParams.get("state"),
      };
      query[field] = field === "id" ? "99" : `wrong-${field}`;

      const response = await callback(jar, context, query);

      expect(response.status).toBe(401);
      expect(jar.values.has(ATTEMPT_COOKIE_NAME)).toBeFalse();
      expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
    },
  );

  test("rejects a cookie with an invalid signature", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    const { callback: callbackUrl } = await initiate(jar, context);
    const signedValue = jar.values.get(ATTEMPT_COOKIE_NAME) ?? "";
    jar.values.set(ATTEMPT_COOKIE_NAME, `${signedValue.slice(0, -1)}x`);
    fetchMock.mockClear();

    const response = await callback(jar, context, Object.fromEntries(callbackUrl.searchParams));

    expect(response.status).toBe(401);
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test("rejects an expired attempt", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    const state = "expired-state";
    jar.values.set(
      ATTEMPT_COOKIE_NAME,
      await signAttemptCookie({
        version: 1,
        state,
        id: pinResponse.id,
        code: pinResponse.code,
        expiresAt: Date.now() - 1,
      }),
    );

    const response = await callback(jar, context, {
      id: String(pinResponse.id),
      code: pinResponse.code,
      state,
    });

    expect(response.status).toBe(401);
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test("rejects missing callback state before downstream work", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    jar.values.set(
      ATTEMPT_COOKIE_NAME,
      await signAttemptCookie({
        version: 1,
        state: "expected-state",
        id: pinResponse.id,
        code: pinResponse.code,
        expiresAt: Date.now() + 60_000,
      }),
    );

    const response = await callback(jar, context, {
      id: String(pinResponse.id),
      code: pinResponse.code,
    });

    expect(response.status).toBe(401);
    expect(jar.values.has(ATTEMPT_COOKIE_NAME)).toBeFalse();
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test("rejects a malformed signed payload before downstream work", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    jar.values.set(ATTEMPT_COOKIE_NAME, await signAttemptCookie({ version: 1, state: 5 }));

    const response = await callback(jar, context, {
      id: String(pinResponse.id),
      code: pinResponse.code,
      state: "expected-state",
    });

    expect(response.status).toBe(401);
    expect(jar.values.has(ATTEMPT_COOKIE_NAME)).toBeFalse();
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test("rejects replay after the browser applies the consume cookie", async () => {
    const jar = new CookieJar();
    const { calls, context } = createContext();
    const { callback: callbackUrl } = await initiate(jar, context);
    const query = Object.fromEntries(callbackUrl.searchParams);

    const firstResponse = await callback(jar, context, query);
    expect(firstResponse.status).toBe(302);
    fetchMock.mockClear();
    getUserInfoSpy.mockClear();
    calls.createAccount = 0;
    calls.createSession = 0;
    calls.createUser = 0;
    calls.updateUser = 0;

    const replayResponse = await callback(jar, context, query);

    expect(replayResponse.status).toBe(401);
    expectNoDownstreamCalls(fetchMock, getUserInfoSpy, calls);
  });

  test("the latest browser initiation replaces an earlier attempt", async () => {
    const jar = new CookieJar();
    const { context } = createContext();
    const first = await initiate(jar, context);
    const firstCookie = jar.values.get(ATTEMPT_COOKIE_NAME);
    const second = await initiate(jar, context);
    const secondCookie = jar.values.get(ATTEMPT_COOKIE_NAME);

    expect(secondCookie).not.toBe(firstCookie);
    expect(second.callback.searchParams.get("state")).not.toBe(
      first.callback.searchParams.get("state"),
    );

    const response = await callback(jar, context, Object.fromEntries(second.callback.searchParams));
    expect(response.status).toBe(302);
  });
});
