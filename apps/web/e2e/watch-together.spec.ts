import { test, expect } from "@playwright/test";
import { setupSyncedRoom } from "./helpers/watch-together";

// These run against a live Plex server with two real accounts, so keep them
// strictly sequential (shared rooms, one server).
test.describe.configure({ mode: "serial" });

const DEVICE_ID_KEY = "multiplex-watch-together-device-id";

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
      .evaluate((v: HTMLVideoElement) => v.play().catch(() => undefined));
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
    // We seek transcoded streams by reloading at a new `offset`, so the guest
    // following the seek shows up as its stream reloading at ~the same offset
    // (the raw <video>.currentTime restarts near 0 for the new offset stream).
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((v: HTMLVideoElement) => {
              const match = /[?&]offset=(\d+)/.exec(v.currentSrc);
              return match ? Number(match[1]) : 0;
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
