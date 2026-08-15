import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { ACCOUNT_A, ACCOUNT_B, storageStatePath } from "./accounts";
import { waitForPlaybackAdvance } from "./playback-probe";
import { createInstrumentedContext } from "./watch-together-artifacts";

const HOST_STATE = storageStatePath(ACCOUNT_A);
const GUEST_STATE = storageStatePath(ACCOUNT_B);

/**
 * Opens the stable direct-play fixture used by live Watch Together tests.
 * The White Hole is MP4/H.264/AAC with no selected subtitle on the test server,
 * so synchronization tests do not contend for Plex's limited transcode slots.
 */
export async function openTestVideoDetails(page: Page): Promise<void> {
  await page.goto(
    "/item/episode/0019947d618464e70d2b754687dc070b9dd628a9/406025",
  );
  await page.waitForURL(/\/item\/episode\//, { timeout: 30_000 });
  // Confirm the details page is interactive (the actions menu is present).
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Opens a specific item's details page directly by path. */
export async function openItemDetails(
  page: Page,
  itemPath: string,
): Promise<void> {
  await page.goto(itemPath);
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible({
    timeout: 30_000,
  });
}

/** As the host, creates a Watch Together room inviting the guest. */
export async function createRoomInvitingGuest(page: Page): Promise<string> {
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
  if (!roomId) {
    throw new Error("room id should be in the lobby URL");
  }
  return roomId;
}

/** As the guest, joins the room by clicking its card on the home page. */
export async function joinRoomFromHome(
  page: Page,
  roomId: string,
): Promise<void> {
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
export async function disbandRoom(
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
 * Waits for the player to open and confirms the video advances without test
 * intervention. A stuck autoplay or stalled guest is a functional failure.
 */
export async function expectPlayingAndAdvancing(
  page: Page,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const video = page.locator("video");
  await expect(video, `${label}: player should open`).toBeVisible({
    timeout: timeoutMs,
  });

  await waitForPlaybackAdvance(page, { label, timeoutMs });
}

export interface SyncedRoom {
  host: Page;
  guest: Page;
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  roomId: string;
  cleanup: () => Promise<void>;
}

export interface SetupSyncedRoomOptions {
  /** Opens the details page to create the room from (default: direct-play fixture). */
  openDetails?: (page: Page) => Promise<void>;
  /** Record videos of both pages into this directory. */
  recordVideoDir?: string;
}

/**
 * Logs in both accounts, has the host create a room inviting the guest, the
 * guest join from their home card, and waits until both are actually playing the
 * same item. Returns the pages plus a cleanup that disbands the room.
 */
export async function setupSyncedRoom(
  browser: Browser,
  baseURL: string | undefined,
  testInfo: TestInfo,
  options: SetupSyncedRoomOptions = {},
): Promise<SyncedRoom> {
  const hostArtifacts = await createInstrumentedContext({
    browser,
    label: "host",
    storageState: HOST_STATE,
    baseURL,
    recordVideoDir: options.recordVideoDir,
    testInfo,
  });
  const guestArtifacts = await createInstrumentedContext({
    browser,
    label: "guest",
    storageState: GUEST_STATE,
    baseURL,
    recordVideoDir: options.recordVideoDir,
    testInfo,
  }).catch(async (error: unknown) => {
    await hostArtifacts.closeAndAttach();
    throw error;
  });
  const hostContext = hostArtifacts.context;
  const guestContext = guestArtifacts.context;
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
    await Promise.all([
      hostArtifacts.closeAndAttach(),
      guestArtifacts.closeAndAttach(),
    ]);
  };

  try {
    host = await hostContext.newPage();
    guest = await guestContext.newPage();

    console.error("E2E step: verify both logged in");
    await host.goto("/");
    await expect(host).not.toHaveURL(/\/login/);
    await guest.goto("/");
    await expect(guest).not.toHaveURL(/\/login/);

    console.error("E2E step: host opens the item details");
    await (options.openDetails ?? openTestVideoDetails)(host);
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

    return { host, guest, hostContext, guestContext, roomId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
