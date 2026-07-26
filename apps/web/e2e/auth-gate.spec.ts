import { expect, test, type APIResponse, type Page } from "@playwright/test";

/**
 * Behavior tests for the no-ui-flash document gate.
 *
 * These assert observable HTTP + DOM outcomes a user would feel — not that
 * mocked helpers were called in a particular order. No Plex credentials needed.
 */

const DOCUMENT_HEADERS = {
  "sec-fetch-dest": "document",
  accept: "text/html,application/xhtml+xml",
} as const;

function setCookieHeaders(response: APIResponse): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}

function expectClearedAuthCookies(setCookies: string[]) {
  expect(
    setCookies.some(
      (value) =>
        value.includes("better-auth.session_token=") &&
        /max-age=0/i.test(value),
    ),
  ).toBe(true);
  expect(
    setCookies.some(
      (value) =>
        value.includes("multiplex.auth_hint=") && /max-age=0/i.test(value),
    ),
  ).toBe(true);
}

/** Plex forward URL embeds Multiplex callback + OAuth state. */
function oauthStateFromPlexLocation(location: string): string | null {
  try {
    // Location looks like https://app.plex.tv/auth#!?forwardUrl=...&clientID=...
    const hashQuery = location.includes("#!?")
      ? location.slice(location.indexOf("#!?") + 3)
      : new URL(location).searchParams.toString();
    const forward = new URLSearchParams(hashQuery).get("forwardUrl");
    if (!forward) return null;
    return new URL(forward).searchParams.get("state");
  } catch {
    return null;
  }
}

function decodeStatePayload(
  state: string,
): { nonce?: string; returnTo?: string } | null {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      nonce?: string;
      returnTo?: string;
    };
  } catch {
    return null;
  }
}

async function clickContinueAndReadPlexLocation(page: Page): Promise<string> {
  // Hashbang targets never reach plex.tv's HTTP server — read state from the
  // initiate redirect Location instead, and abort the outbound navigation.
  await page.route("https://app.plex.tv/**", async (route) => {
    await route.abort();
  });

  const initiateResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/plex/auth/initiate") &&
      (response.status() === 302 || response.status() === 307),
  );

  await page.getByRole("button", { name: "Continue with Plex" }).click();
  const initiateResponse = await initiateResponsePromise;
  const location = initiateResponse.headers().location;
  expect(location, "initiate must redirect to Plex").toBeTruthy();
  return location!;
}

test.describe("document auth gate", () => {
  test("signed-out deep link 302s to login with returnTo and clears carriers", async ({
    request,
  }) => {
    const response = await request.get("/watch-together/room-from-gate-test", {
      maxRedirects: 0,
      headers: DOCUMENT_HEADERS,
    });

    expect(response.status()).toBe(302);
    const location = response.headers().location ?? "";
    expect(location).toContain("/login?");
    expect(location).toContain(
      "returnTo=" + encodeURIComponent("/watch-together/room-from-gate-test"),
    );
    expectClearedAuthCookies(setCookieHeaders(response));
  });

  test("signed-out deep link never paints the app shell", async ({ page }) => {
    await page.goto("/watch-together/room-from-gate-test");

    await expect(page).toHaveURL(/\/login\?returnTo=/);
    await expect(
      page.getByRole("heading", { name: "Welcome to Multiplex" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Plex" }),
    ).toBeVisible();

    // Skeleton and real sidebar both use data-slot="sidebar".
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
  });

  test("junk session cookie is cleared and never paints the shell", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = baseURL ?? "http://localhost:3000";
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: "forged.junk",
        url: origin,
      },
      {
        name: "multiplex.auth_hint",
        value: "stale-hint",
        url: origin,
      },
    ]);

    await page.goto("/media/abc/library/1", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Welcome to Multiplex" }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);

    const probe = await page.request.get("/media/abc/library/1", {
      maxRedirects: 0,
      headers: {
        ...DOCUMENT_HEADERS,
        cookie:
          "better-auth.session_token=forged.junk; multiplex.auth_hint=stale",
      },
    });
    expect(probe.status()).toBe(302);
    expectClearedAuthCookies(setCookieHeaders(probe));
    expect(probe.headers().location ?? "").toContain(
      "returnTo=" + encodeURIComponent("/media/abc/library/1"),
    );
  });

  test("non-document requests are not bounced to login", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/get-session", {
      maxRedirects: 0,
      headers: {
        "sec-fetch-dest": "empty",
        accept: "application/json",
      },
    });

    // Unauthenticated get-session answers itself — never a login redirect
    // from the document gate.
    expect(response.status()).not.toBe(302);
    const location = response.headers().location ?? "";
    expect(location).not.toContain("/login");
  });

  test("login Continue with Plex carries returnTo into OAuth state", async ({
    page,
  }) => {
    await page.goto("/login?returnTo=/watch-together/room-42");
    const plexLocation = await clickContinueAndReadPlexLocation(page);

    const state = oauthStateFromPlexLocation(plexLocation);
    expect(state).toBeTruthy();
    expect(decodeStatePayload(state!)).toEqual({
      nonce: expect.any(String),
      returnTo: "/watch-together/room-42",
    });
  });

  test("forged off-origin returnTo is stripped before Plex OAuth state", async ({
    page,
  }) => {
    await page.goto("/login?returnTo=https://evil.example/phish");
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0);
    const plexLocation = await clickContinueAndReadPlexLocation(page);

    const state = oauthStateFromPlexLocation(plexLocation);
    expect(state).toBeTruthy();
    const payload = decodeStatePayload(state!);
    expect(payload).not.toBeNull();
    // Sanitized away — either omitted (defaults to /) or explicitly "/".
    expect(payload?.returnTo ?? "/").toBe("/");
  });
});
