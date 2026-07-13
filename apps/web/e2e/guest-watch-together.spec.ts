import { expect, test } from "@playwright/test";

import { ACCOUNT_A, storageStatePath } from "./helpers/accounts";
import { disbandRoom, openTestVideoDetails } from "./helpers/watch-together";

test("an unauthenticated guest does not request protected player metadata", async ({
  browser,
  baseURL,
}, testInfo) => {
  const hostContext = await browser.newContext({
    baseURL,
    storageState: storageStatePath(ACCOUNT_A),
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const guestContext = await browser.newContext({ baseURL });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomId: string | undefined;
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
  guest.on("response", (response) => {
    if (response.url().includes("/api/trpc/plex.getItemMetadata")) {
      metadataResponses.push(response.status());
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
    expect(capability).toBeTruthy();
    expect(capability!.length).toBeLessThan(125);
    expect(guestUrl.href.length).toBeLessThan(200);

    await host.evaluate(() => {
      const captured: string[] = [];
      const captureToasts = () => {
        for (const element of document.querySelectorAll(
          "[data-sonner-toast]",
        )) {
          const text = element.textContent?.trim();
          if (text && !captured.includes(text)) captured.push(text);
        }
      };
      (
        window as typeof window & { __capturedWatchTogetherToasts: string[] }
      ).__capturedWatchTogetherToasts = captured;
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
    await guest.waitForTimeout(2_000);
    const hostToasts = await host.evaluate(
      () =>
        (
          window as typeof window & {
            __capturedWatchTogetherToasts: string[];
          }
        ).__capturedWatchTogetherToasts,
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
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
