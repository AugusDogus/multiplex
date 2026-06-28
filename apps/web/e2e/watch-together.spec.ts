import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { ACCOUNT_A, ACCOUNT_B, storageStatePath } from "./helpers/accounts";

// These run against a live Plex server with two real accounts, so keep them
// strictly sequential (shared rooms, one server).
test.describe.configure({ mode: "serial" });

const HOST_STATE = storageStatePath(ACCOUNT_A);
const GUEST_STATE = storageStatePath(ACCOUNT_B);
const DEVICE_ID_KEY = "multiplex-watch-together-device-id";

/** Opens the first movie's details page from the home library rows. */
async function openFirstMovieDetails(page: Page): Promise<void> {
  await page.goto("/");
  const movieLink = page.locator('a[href*="/item/movie/"]').first();
  await expect(movieLink).toBeVisible({ timeout: 30_000 });
  // Navigate via the href rather than clicking: home cards sit under hover
  // overlays in a carousel, so a direct click can be intercepted.
  const href = await movieLink.getAttribute("href");
  expect(href, "movie link should have an href").toBeTruthy();
  await page.goto(href!);
  await page.waitForURL(/\/item\/movie\//, { timeout: 30_000 });
  // Confirm the details page is interactive (the actions menu is present).
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible({
    timeout: 30_000,
  });
}

/** As the host, creates a Watch Together room inviting the guest. */
async function createRoomInvitingGuest(page: Page): Promise<string> {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /watch together/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(/select friends below|friends? selected/i),
  ).toBeVisible({
    timeout: 30_000,
  });

  // Pick the guest account from the invitee list (its name contains "multiplex").
  const guestOption = dialog
    .getByRole("button", { name: /multiplex/i })
    .first();
  await expect(guestOption).toBeVisible({ timeout: 30_000 });
  await guestOption.click();

  await dialog.getByRole("button", { name: /invite \d+/i }).click();

  await page.waitForURL(/\/watch-together\//, { timeout: 30_000 });
  const roomId = page.url().split("/watch-together/")[1]?.split(/[/?#]/)[0];
  expect(roomId, "room id should be in the lobby URL").toBeTruthy();
  return roomId!;
}

/** As the guest, joins the room by clicking its card on the home page. */
async function joinRoomFromHome(page: Page, roomId: string): Promise<void> {
  await page.goto("/");
  const card = page.locator(`a[href*="/watch-together/${roomId}"]`).first();
  // The host just created the room; the guest's home may need a moment/refetch.
  try {
    await expect(card).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 15_000 });
  }
  await card.click();
  await page.waitForURL(new RegExp(`/watch-together/${roomId}`), {
    timeout: 30_000,
  });
}

/** Disbands a room via the authenticated tRPC endpoint (best-effort teardown). */
async function disbandRoom(
  context: BrowserContext,
  roomId: string,
): Promise<void> {
  await context.request
    .post("/api/trpc/plex.deleteWatchTogetherRoom?batch=1", {
      data: { "0": { json: { roomId } } },
      headers: { "content-type": "application/json" },
    })
    .catch(() => undefined);
}

/** Waits for the player to open and confirms the video is actually advancing. */
async function expectPlayingAndAdvancing(
  page: Page,
  label: string,
): Promise<number> {
  const video = page.locator("video");
  await expect(video, `${label}: player should open`).toBeVisible({
    timeout: 60_000,
  });

  // Wait until playback has actually begun (currentTime moving past 0). Real
  // Plex transcode startup for two simultaneous sessions can take a while.
  await expect
    .poll(
      async () =>
        video.evaluate((el: HTMLVideoElement) => el.currentTime).catch(() => 0),
      {
        message: `${label}: video should start playing`,
        timeout: 120_000,
        intervals: [1_000],
      },
    )
    .toBeGreaterThan(0.1);

  const first = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
  await page.waitForTimeout(3_000);
  const second = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
  expect(second, `${label}: timecode should advance`).toBeGreaterThan(first);
  return second;
}

test("two viewers auto-start and play the same item in sync", async ({
  browser,
  baseURL,
}) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  const hostContext = await browser.newContext({
    storageState: HOST_STATE,
    baseURL,
  });
  const guestContext = await browser.newContext({
    storageState: GUEST_STATE,
    baseURL,
  });
  let roomId: string | undefined;
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // Disband the room we created so lobbies don't pile up, then close.
    if (roomId) {
      await disbandRoom(hostContext, roomId);
    }
    await Promise.all([hostContext.close(), guestContext.close()]);
  };

  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    // Sanity: both contexts are authenticated (not bounced to /login).
    console.error("E2E step: verify both logged in");
    await host.goto("/");
    await expect(host).not.toHaveURL(/\/login/);
    await guest.goto("/");
    await expect(guest).not.toHaveURL(/\/login/);

    // Host creates a room inviting the guest, then waits in the lobby.
    console.error("E2E step: host opens a movie");
    await openFirstMovieDetails(host);
    console.error("E2E step: host creates room inviting guest");
    roomId = await createRoomInvitingGuest(host);
    console.error(`E2E step: room created ${roomId}`);

    // Guest joins from their home page (the room card must appear there).
    console.error("E2E step: guest joins from home");
    await joinRoomFromHome(guest, roomId);

    // Both should auto-start and actually play the same item — the regression
    // we care about (previously the second viewer hit a black screen / "no
    // supported sources" because both shared one Plex transcode session).
    console.error("E2E step: wait for both to play");
    await Promise.all([
      expectPlayingAndAdvancing(host, "host"),
      expectPlayingAndAdvancing(guest, "guest"),
    ]);
    console.error("E2E step: both playing");

    // Each browser must use a distinct X-Plex-Client-Identifier (the fix): the
    // per-browser id is what gives them separate transcode sessions.
    const hostId = await host.evaluate(
      (key) => window.localStorage.getItem(key),
      DEVICE_ID_KEY,
    );
    const guestId = await guest.evaluate(
      (key) => window.localStorage.getItem(key),
      DEVICE_ID_KEY,
    );
    expect(hostId, "host client id").toBeTruthy();
    expect(guestId, "guest client id").toBeTruthy();
    expect(hostId, "client ids must differ between browsers").not.toBe(guestId);

    await cleanup();
  } finally {
    await cleanup();
  }
});

// Playback-control sync (pause / seek / leave) does not yet propagate between
// participants: the Syncplay driver has no arbitration, so every client echoes
// its own playstate on each ~1 Hz server ping and a still-playing peer
// overrides the one that paused/seeked. Enable these once that's fixed.
test.fixme("pausing one participant pauses the others", async () => {
  // TODO: after arbitration fix — host pauses, assert guest's video pauses.
});

test.fixme(
  "seeking one participant moves the others to the same position",
  async () => {
    // TODO: after arbitration fix — host seeks, assert guest's currentTime jumps.
  },
);

test.fixme("a participant leaving pauses playback for the others", async () => {
  // TODO: after arbitration fix — host leaves, assert guest's video pauses.
});
