import { expect, test } from "@playwright/test";

import { ACCOUNT_A, storageStatePath } from "./helpers/accounts";
import { disbandRoom, openFirstMovieDetails } from "./helpers/watch-together";

test("an unauthenticated guest does not request protected player metadata", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext({
    baseURL,
    storageState: storageStatePath(ACCOUNT_A),
  });
  const guestContext = await browser.newContext({ baseURL });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomId: string | undefined;

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
    await openFirstMovieDetails(host);
    await host.getByRole("button", { name: "More actions" }).click();
    await host.getByRole("menuitem", { name: /watch together/i }).click();

    const dialog = host.getByRole("dialog");
    await dialog.getByRole("button", { name: /guest link/i }).click();
    const createLink = dialog.getByRole("button", {
      name: "Create guest link",
    });
    await expect(createLink).toBeEnabled({ timeout: 30_000 });
    await createLink.click();

    await host.waitForURL(/\/watch-together\/[^/?]+\?guest=/, {
      timeout: 30_000,
    });
    const hostUrl = new URL(host.url());
    roomId = hostUrl.pathname.split("/").at(-1);
    const capability = hostUrl.searchParams.get("guest");
    expect(roomId).toBeTruthy();
    expect(capability).toBeTruthy();

    await guest.goto(
      `/watch-together/guest/${encodeURIComponent(capability!)}`,
    );
    await guest.getByLabel("Display name").fill("Browser Guest");
    await guest.getByRole("button", { name: "Join session" }).click();
    await expect(guest.getByText(/you're in/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(host.getByText("Browser Guest")).toBeVisible({
      timeout: 30_000,
    });

    const start = host.getByRole("button", { name: "Start" });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(guest.locator("video")).toBeVisible({ timeout: 60_000 });
    await guest.waitForTimeout(2_000);

    expect(metadataResponses).toEqual([]);
    expect(
      guestConsoleErrors.filter((message) =>
        /plex\.getItemMetadata|unauthorized/i.test(message),
      ),
    ).toEqual([]);
    await expect(guest.getByText(/join watch together/i)).toHaveCount(0);
  } finally {
    await Promise.all([
      host.keyboard.press("Escape").catch(() => undefined),
      guest.keyboard.press("Escape").catch(() => undefined),
    ]);
    if (roomId) await disbandRoom(hostContext, roomId);
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
