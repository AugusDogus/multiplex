import { test, expect, type Page } from "@playwright/test";
import { setupSyncedRoom } from "./helpers/watch-together";
import { readPlaybackProbe } from "./helpers/playback-probe";

const DEVICE_ID_KEY = "multiplex-watch-together-device-id";

async function pressPlayerKey(page: Page, code: string): Promise<void> {
  await page.evaluate((keyCode) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: keyCode, bubbles: true }),
    );
  }, code);
}

test("two viewers synchronize playback and disable local speed controls", async ({
  browser,
  baseURL,
}, testInfo) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  const { host, guest, cleanup } = await setupSyncedRoom(
    browser,
    baseURL,
    testInfo,
  );

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
    await pressPlayerKey(host, "KeyK");
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
    await pressPlayerKey(host, "KeyK");
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

    const hostVideo = host.locator("video");
    const box = await hostVideo.boundingBox();
    if (!box) {
      throw new Error("host video should have a layout box");
    }
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // An unsynced local playback rate would desync the room, so both the hold
    // gesture and settings control must be unavailable during the session.
    console.error("E2E step: host presses and holds; rate must stay 1x");
    await host.mouse.move(centerX, centerY);
    await host.mouse.down();
    await host.waitForTimeout(3_000);
    const rateWhileHolding = await hostVideo.evaluate(
      (video: HTMLVideoElement) => video.playbackRate,
    );
    await host.mouse.up();
    expect(rateWhileHolding, "hold must not fast-forward in a session").toBe(1);

    console.error("E2E step: open settings; Playback Speed must be absent");
    await host.mouse.move(centerX, box.y + box.height - 24);
    const settingsButton = host.getByRole("button", {
      name: "Playback settings",
    });
    await expect(settingsButton).toBeVisible({ timeout: 15_000 });
    await settingsButton.click();
    await expect(host.getByText("Quality")).toBeVisible({ timeout: 10_000 });
    await expect(host.getByText("Playback Speed")).toHaveCount(0);
    console.error("E2E step: playback-speed controls confirmed disabled");
  } finally {
    await cleanup();
  }
});

test("a host seek propagates to the guest", async ({
  browser,
  baseURL,
}, testInfo) => {
  // Real Plex login + transcoded playback for two viewers is slow.
  test.setTimeout(360_000);
  const { host, guest, cleanup } = await setupSyncedRoom(
    browser,
    baseURL,
    testInfo,
  );

  try {
    // Seek via the app's keyboard shortcut (digit = jump to %), which goes
    // through the real transcoded-reload seek path (raw currentTime assignment
    // is rejected by Plex's transcoded stream).
    console.error("E2E step: host seeks to ~80%");
    const duration = (await readPlaybackProbe(host)).durationSeconds;
    const seekTarget = duration * 0.8;
    // Dispatch the keydown on document directly (the player's shortcut handler
    // is a document listener; Playwright's keyboard can miss it through the
    // dialog's focus trap).
    await host.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Digit8", bubbles: true }),
      );
    });
    // The probe normalizes direct-play currentTime and transcode offset streams
    // onto the same full media timeline.
    await expect
      .poll(
        async () =>
          Math.abs(
            (await readPlaybackProbe(guest)).timelinePositionSeconds -
              seekTarget,
          ),
        { message: "guest should follow the host's seek", timeout: 60_000 },
      )
      .toBeLessThan(10);
    console.error("E2E step: guest followed seek");
  } finally {
    await cleanup();
  }
});
