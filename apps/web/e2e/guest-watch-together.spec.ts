import { expect, test, type Page } from "@playwright/test";

import { ACCOUNT_A, storageStatePath } from "./helpers/accounts";
import {
  disbandRoom,
  expectPlayingAndAdvancing,
  openTestVideoDetails,
} from "./helpers/watch-together";
import { readPlaybackProbe } from "./helpers/playback-probe";
import { createInstrumentedContext } from "./helpers/watch-together-artifacts";
import { guestWatchTogetherContinuationResponseSchema } from "../src/lib/guest-watch-together-bootstrap";

declare global {
  interface Window {
    __capturedWatchTogetherToasts: string[];
  }
}

async function pressPlayerKey(page: Page, code: string): Promise<void> {
  await page.evaluate((keyCode) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: keyCode, bubbles: true }),
    );
  }, code);
}

test("an unauthenticated guest does not request protected player metadata", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const hostArtifacts = await createInstrumentedContext({
    browser,
    label: "host",
    baseURL,
    storageState: storageStatePath(ACCOUNT_A),
    permissions: ["clipboard-read", "clipboard-write"],
    testInfo,
  });
  const guestArtifacts = await createInstrumentedContext({
    browser,
    label: "guest",
    baseURL,
    testInfo,
  }).catch(async (error) => {
    await hostArtifacts.closeAndAttach();
    throw error;
  });
  const hostContext = hostArtifacts.context;
  const guestContext = guestArtifacts.context;
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomId: string | undefined;
  let successorRoomId: string | undefined;
  let testError: unknown;

  const hostSyncplayFrames: string[] = [];
  const guestSyncplayFrames: string[] = [];
  const captureSyncplayFrames = (page: typeof host, frames: string[]) => {
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      const capture = (
        direction: "sent" | "received",
        payload: string | Buffer,
      ) => {
        frames.push(
          JSON.stringify({
            at: Date.now(),
            direction,
            payload: payload.toString(),
          }),
        );
      };
      socket.on("framesent", (event) => capture("sent", event.payload));
      socket.on("framereceived", (event) => capture("received", event.payload));
    });
  };
  captureSyncplayFrames(host, hostSyncplayFrames);
  captureSyncplayFrames(guest, guestSyncplayFrames);

  const metadataResponses: number[] = [];
  const guestConsoleErrors: string[] = [];
  const continuationResponses: Array<{
    status: number;
    outcome: string;
  }> = [];
  guest.on("response", (response) => {
    if (response.url().includes("/api/trpc/plex.getItemMetadata")) {
      metadataResponses.push(response.status());
    }
    if (response.url().endsWith("/api/watch-together/guest/continue")) {
      void response
        .json()
        .then((body) => {
          const parsed =
            guestWatchTogetherContinuationResponseSchema.safeParse(body);
          continuationResponses.push({
            status: response.status(),
            outcome: parsed.success
              ? parsed.data.ok
                ? "success"
                : parsed.data.reason
              : "invalid-response",
          });
        })
        .catch(() => {
          continuationResponses.push({
            status: response.status(),
            outcome: "invalid-response",
          });
        });
    }
  });
  guest.on("console", (message) => {
    if (message.type() === "error") guestConsoleErrors.push(message.text());
  });

  try {
    await openTestVideoDetails(host);
    await host.getByRole("button", { name: "More actions" }).click();
    await host.getByRole("menuitem", { name: /watch together/i }).click();

    const dialog = host.getByRole("dialog");
    await dialog.getByRole("button", { name: /guest link/i }).click();
    const createLink = dialog.getByRole("button", {
      name: "Create guest link",
    });
    await expect(createLink).toBeEnabled({ timeout: 30_000 });
    await createLink.click();

    await host.waitForURL(/\/watch-together\/[^/?]+$/, {
      timeout: 30_000,
    });
    const hostUrl = new URL(host.url());
    roomId = hostUrl.pathname.split("/").at(-1);
    expect(roomId).toBeTruthy();
    expect(hostUrl.search).toBe("");

    await host
      .getByRole("button", { name: "Copy Guest Watch Together link" })
      .click();
    const guestUrl = new URL(
      await host.evaluate(() => navigator.clipboard.readText()),
    );
    const capability = guestUrl.pathname.split("/").at(-1);
    if (!capability) {
      throw new Error("Guest link did not contain a capability path segment");
    }
    expect(capability.length).toBeLessThan(125);
    expect(guestUrl.href.length).toBeLessThan(200);

    await host.evaluate(() => {
      const captured: string[] = [];
      const captureToasts = () => {
        for (const element of document.querySelectorAll(
          '[data-slot="toast-root"]',
        )) {
          const text = element.textContent?.trim();
          if (text && !captured.includes(text)) captured.push(text);
        }
      };
      window.__capturedWatchTogetherToasts = captured;
      new MutationObserver(captureToasts).observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    await guest.goto(guestUrl.href);
    await guest.getByLabel("Display name").fill("Browser Guest");
    await guest.getByRole("button", { name: "Join session" }).click();
    await expect(guest.getByText(/you're in/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(host.getByText("Browser Guest")).toBeVisible({
      timeout: 30_000,
    });
    // Plex can report the guest to the host just before the reciprocal
    // Syncplay presence reaches the guest. Let that handshake settle before
    // the one-shot host Start event.
    await host.waitForTimeout(5_000);

    const start = host.getByRole("button", { name: "Start" });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(guest.locator("video")).toBeVisible({ timeout: 60_000 });
    await Promise.all([
      expectPlayingAndAdvancing(host, "guest-link host"),
      expectPlayingAndAdvancing(guest, "guest-link guest"),
    ]);

    await pressPlayerKey(host, "KeyK");
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.paused),
        { message: "Guest Link guest should follow host pause" },
      )
      .toBe(true);

    await pressPlayerKey(host, "KeyK");
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.paused),
        { message: "Guest Link guest should follow host resume" },
      )
      .toBe(false);

    const hostDuration = (await readPlaybackProbe(host)).durationSeconds;
    const seekTarget = hostDuration * 0.5;
    await host.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Digit5", bubbles: true }),
      );
    });
    await expect
      .poll(
        async () =>
          Math.abs(
            (await readPlaybackProbe(guest)).timelinePositionSeconds -
              seekTarget,
          ),
        {
          message: "Guest Link guest should follow host seek",
          timeout: 60_000,
        },
      )
      .toBeLessThan(10);

    const initialHostPath = new URL(host.url()).pathname;
    const initialGuestPath = new URL(guest.url()).pathname;
    const initialHostSource = (await readPlaybackProbe(host)).currentSrc;
    const initialGuestSource = (await readPlaybackProbe(guest)).currentSrc;

    // Guest links use a distinct continuation API and capability handoff.
    // Exercise that real path instead of treating authenticated rotation as
    // sufficient coverage for unauthenticated viewers.
    await host.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "End", bubbles: true }),
      );
    });
    await expect
      .poll(() => new URL(host.url()).pathname, {
        message: "Guest Link host should route to the successor room",
        timeout: 60_000,
      })
      .not.toBe(initialHostPath);
    await expect
      .poll(
        () =>
          new URL(guest.url()).pathname !== initialGuestPath
            ? "changed"
            : (continuationResponses.at(-1)?.outcome ?? "no-response"),
        {
          message: "Guest Link guest should receive a successor capability",
          timeout: 60_000,
        },
      )
      .toBe("changed");

    successorRoomId = new URL(host.url()).pathname.split("/").at(-1);
    expect(successorRoomId).toBeTruthy();
    await Promise.all([
      expectPlayingAndAdvancing(host, "guest-link host after auto-advance"),
      expectPlayingAndAdvancing(guest, "guest-link guest after auto-advance"),
    ]);
    await expect
      .poll(async () => (await readPlaybackProbe(host)).currentSrc)
      .not.toBe(initialHostSource);
    await expect
      .poll(async () => (await readPlaybackProbe(guest)).currentSrc)
      .not.toBe(initialGuestSource);

    const hostToasts = await host.evaluate(
      () => window.__capturedWatchTogetherToasts,
    );
    expect(metadataResponses).toEqual([]);
    expect(
      guestConsoleErrors.filter((message) =>
        /plex\.getItemMetadata|unauthorized/i.test(message),
      ),
    ).toEqual([]);
    await expect(guest.getByText(/join watch together/i)).toHaveCount(0);
    expect(hostToasts.filter((text) => /jumped to/i.test(text))).toEqual([]);
  } catch (error) {
    testError = error;
    throw error;
  } finally {
    const pageState = async (page: typeof host) =>
      page
        .evaluate(() => {
          const video = document.querySelector("video");
          return {
            url: window.location.href,
            body: document.body.innerText,
            video: video
              ? {
                  currentTime: video.currentTime,
                  duration: video.duration,
                  paused: video.paused,
                  readyState: video.readyState,
                  networkState: video.networkState,
                  error: video.error?.message ?? null,
                }
              : null,
          };
        })
        .catch(() => null);
    if (testError) {
      await testInfo.attach("syncplay-diagnostics.json", {
        body: Buffer.from(
          JSON.stringify(
            {
              host: {
                page: await pageState(host),
                frames: hostSyncplayFrames,
              },
              guest: {
                page: await pageState(guest),
                frames: guestSyncplayFrames,
                continuationResponses,
              },
            },
            null,
            2,
          ),
        ),
        contentType: "application/json",
      });
    }
    await Promise.all([
      host.keyboard.press("Escape").catch(() => undefined),
      guest.keyboard.press("Escape").catch(() => undefined),
    ]);
    // Let the app's asynchronous Plex transcode teardown finish before the
    // contexts disappear. Otherwise repeated runs can exhaust server slots.
    await host.waitForTimeout(1_500).catch(() => undefined);
    if (roomId) await disbandRoom(hostContext, roomId);
    if (successorRoomId && successorRoomId !== roomId) {
      await disbandRoom(hostContext, successorRoomId);
    }
    await Promise.all([
      hostArtifacts.closeAndAttach(),
      guestArtifacts.closeAndAttach(),
    ]);
  }
});
