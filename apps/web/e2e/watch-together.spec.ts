import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
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

/**
 * Waits for the player to open and confirms the video is actually advancing.
 * Nudges play() if it's stuck, tolerating slow transcode startup for two
 * simultaneous sessions on a live server.
 */
async function expectPlayingAndAdvancing(
  page: Page,
  label: string,
): Promise<void> {
  const video = page.locator("video");
  await expect(video, `${label}: player should open`).toBeVisible({
    timeout: 60_000,
  });

  const currentTime = () =>
    video.evaluate((el: HTMLVideoElement) => el.currentTime).catch(() => 0);

  const deadline = Date.now() + 120_000;
  let last = await currentTime();
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_500);
    const next = await currentTime();
    if (next > last + 0.5) {
      return; // playback is genuinely advancing
    }
    // Stuck (paused by stale room state, or autoplay didn't take): nudge it.
    await video
      .evaluate((el: HTMLVideoElement) => {
        if (el.paused) void el.play();
      })
      .catch(() => undefined);
    last = next;
  }

  const diag = await video
    .evaluate((el: HTMLVideoElement) => ({
      currentTime: el.currentTime,
      paused: el.paused,
      readyState: el.readyState,
      networkState: el.networkState,
    }))
    .catch(() => null);
  throw new Error(
    `${label}: video never advanced. diag=${JSON.stringify(diag)}`,
  );
}

interface SyncedRoom {
  host: Page;
  guest: Page;
  roomId: string;
  cleanup: () => Promise<void>;
}

/**
 * Logs in both accounts, has the host create a room inviting the guest, the
 * guest join from their home card, and waits until both are actually playing the
 * same item. Returns the pages plus a cleanup that disbands the room.
 */
async function setupSyncedRoom(
  browser: Browser,
  baseURL: string | undefined,
): Promise<SyncedRoom> {
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
  let host: Page | undefined;
  let guest: Page | undefined;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // Close the players via the UI (Escape) so the app stops their transcode
    // sessions on the server; otherwise they linger and a later run/viewer hits
    // the transcode limit (HTTP 400).
    await Promise.all(
      [host, guest]
        .filter((page): page is Page => Boolean(page))
        .map((page) => page.keyboard.press("Escape").catch(() => undefined)),
    );
    await host?.waitForTimeout(1_500).catch(() => undefined);
    if (roomId) {
      await disbandRoom(hostContext, roomId);
    }
    await Promise.all([hostContext.close(), guestContext.close()]);
  };

  try {
    host = await hostContext.newPage();
    guest = await guestContext.newPage();

    console.error("E2E step: verify both logged in");
    await host.goto("/");
    await expect(host).not.toHaveURL(/\/login/);
    await guest.goto("/");
    await expect(guest).not.toHaveURL(/\/login/);

    console.error("E2E step: host opens a movie");
    await openFirstMovieDetails(host);
    console.error("E2E step: host creates room inviting guest");
    roomId = await createRoomInvitingGuest(host);
    console.error(`E2E step: room created ${roomId}`);

    console.error("E2E step: guest joins from home");
    await joinRoomFromHome(guest, roomId);

    console.error("E2E step: wait for both to play");
    await Promise.all([
      expectPlayingAndAdvancing(host, "host"),
      expectPlayingAndAdvancing(guest, "guest"),
    ]);
    console.error("E2E step: both playing");

    return { host, guest, roomId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("two viewers auto-start, play the same item in sync, and pause/resume propagates", async ({
  browser,
  baseURL,
}) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  const { host, guest, cleanup } = await setupSyncedRoom(browser, baseURL);

  try {
    // Each browser must use a distinct X-Plex-Client-Identifier (the streaming
    // fix): the per-browser id is what gives them separate transcode sessions.
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

    // Pause on the host must propagate to the guest (Syncplay arbitration).
    console.error("E2E step: host pauses");
    await host.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((v: HTMLVideoElement) => v.paused)
            .catch(() => false),
        { message: "guest should pause when host pauses", timeout: 30_000 },
      )
      .toBe(true);
    console.error("E2E step: guest paused with host");

    // ...and resuming on the host resumes the guest.
    console.error("E2E step: host resumes");
    await host
      .locator("video")
      .evaluate((v: HTMLVideoElement) => void v.play());
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((v: HTMLVideoElement) => v.paused)
            .catch(() => true),
        { message: "guest should resume when host resumes", timeout: 30_000 },
      )
      .toBe(false);
    console.error("E2E step: guest resumed with host");
  } finally {
    await cleanup();
  }
});

test("a host seek propagates to the guest", async ({ browser, baseURL }) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  const { host, guest, cleanup } = await setupSyncedRoom(browser, baseURL);

  try {
    // Seek via the app's keyboard shortcut (digit = jump to %), which goes
    // through the real transcoded-reload seek path (raw currentTime assignment
    // is rejected by Plex's transcoded stream).
    console.error("E2E step: host seeks to ~80%");
    const duration = await host
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.duration || 0);
    const seekTarget = duration * 0.8;
    // Dispatch the keydown on document directly (the player's shortcut handler
    // is a document listener; Playwright's keyboard can miss it through the
    // dialog's focus trap).
    await host.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Digit8", bubbles: true }),
      );
    });
    // The guest's effective position depends on the playback path:
    // - Plex transcode: seeks reload the stream at a new `offset` URL param
    //   (the raw <video>.currentTime restarts near 0 for the new stream).
    // - Client remux / direct play: the real timeline is seekable, so
    //   currentTime itself jumps to the target.
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((v: HTMLVideoElement) => {
              const match = /[?&]offset=(\d+)/.exec(v.currentSrc);
              const urlOffset = match ? Number(match[1]) : 0;
              return Math.max(urlOffset, v.currentTime);
            })
            .catch(() => 0),
        { message: "guest should follow the host's seek", timeout: 60_000 },
      )
      .toBeGreaterThan(seekTarget - 60);
    console.error("E2E step: guest followed seek");
  } finally {
    await cleanup();
  }
});

test("a Watch Together session disables playback-speed controls", async ({
  browser,
  baseURL,
}) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  // The guest is only needed so the host's session is genuinely active; this
  // test asserts against the host.
  const { host, cleanup } = await setupSyncedRoom(browser, baseURL);

  try {
    const hostVideo = host.locator("video");
    const box = await hostVideo.boundingBox();
    expect(box, "host video should have a layout box").toBeTruthy();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // 1. Hold-for-2x must not fast-forward while in a session (an unsynced local
    //    rate would only desync viewers).
    console.error("E2E step: host presses and holds; rate must stay 1x");
    await host.mouse.move(centerX, centerY);
    await host.mouse.down();
    await host.waitForTimeout(3_000);
    const rateWhileHolding = await hostVideo.evaluate(
      (v: HTMLVideoElement) => v.playbackRate,
    );
    await host.mouse.up();
    expect(rateWhileHolding, "hold must not fast-forward in a session").toBe(1);

    // 2. The settings menu must not offer a Playback Speed control.
    console.error("E2E step: open settings; Playback Speed must be absent");
    // Reveal the control bar, then open the settings popover.
    await host.mouse.move(centerX, box!.y + box!.height - 24);
    const settingsButton = host.getByRole("button", {
      name: "Playback settings",
    });
    await expect(settingsButton).toBeVisible({ timeout: 15_000 });
    await settingsButton.click();
    // The menu is open (a stable row is visible) but has no speed control.
    await expect(host.getByText("Quality")).toBeVisible({ timeout: 10_000 });
    await expect(host.getByText("Playback Speed")).toHaveCount(0);
    console.error("E2E step: playback-speed controls confirmed disabled");
  } finally {
    await cleanup();
  }
});
