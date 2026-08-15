import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { z } from "zod";

import { ACCOUNT_A, storageStatePath } from "./helpers/accounts";
import {
  disbandRoom,
  expectPlayingAndAdvancing,
  openItemDetails,
  setupSyncedRoom,
} from "./helpers/watch-together";
import { readPlaybackProbe } from "./helpers/playback-probe";
import { createInstrumentedContext } from "./helpers/watch-together-artifacts";
import { decideStreamMode } from "../src/components/media-player/utils/plex-playback-plan";

const playQueueItemSchema = z.object({
  ratingKey: z.string(),
  title: z.string().optional(),
  duration: z.number().positive(),
  Media: z
    .array(
      z.object({
        audioCodec: z.string().optional(),
        videoCodec: z.string().optional(),
        container: z.string().optional(),
      }),
    )
    .optional(),
});

const playQueueResponseSchema = z.array(
  z.object({
    result: z.object({
      data: z.object({
        json: z.object({
          MediaContainer: z.object({
            Metadata: z.array(playQueueItemSchema).optional(),
          }),
        }),
      }),
    }),
  }),
);

interface EpisodeFixture {
  readonly ratingKey: string;
  readonly title: string;
  readonly durationSeconds: number;
}

interface EpisodeRun {
  readonly href: string;
  readonly episodes: readonly [EpisodeFixture, EpisodeFixture, EpisodeFixture];
}

function toEpisodeFixture(
  item: z.infer<typeof playQueueItemSchema>,
): EpisodeFixture {
  return {
    ratingKey: item.ratingKey,
    title: item.title ?? "",
    durationSeconds: item.duration / 1_000,
  };
}

async function pickThreeEpisodeRun(page: Page): Promise<EpisodeRun> {
  await page.goto("/");
  const links = page.locator('a[href*="/item/episode/"]');
  await expect(links.first()).toBeVisible({ timeout: 30_000 });
  const hrefs = [
    ...new Set(
      await links.evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href")),
      ),
    ),
  ].filter((href): href is string => Boolean(href));

  for (const href of hrefs) {
    const match = /\/item\/episode\/([^/]+)\/(\d+)/.exec(href);
    if (!match) continue;
    const serverId = match[1];
    const ratingKey = match[2];
    if (!serverId || !ratingKey) continue;

    const response = await page.request.post(
      "/api/trpc/plex.createPlayQueue?batch=1",
      {
        data: {
          "0": {
            json: {
              serverId,
              type: "video",
              ratingKey,
              continuous: true,
              includeMarkers: true,
              includeChapters: true,
              shuffle: false,
              repeat: 0,
            },
          },
        },
        headers: { "content-type": "application/json" },
      },
    );
    const parsed = playQueueResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) continue;
    const items =
      parsed.data[0]?.result.data.json.MediaContainer.Metadata ?? [];
    const index = items.findIndex((item) => item.ratingKey === ratingKey);
    if (index < 0) continue;
    const run = items.slice(index, index + 3);
    const first = run[0];
    const second = run[1];
    const third = run[2];
    if (!first || !second || !third) continue;
    if (decideStreamMode(first) !== "direct-stream") continue;

    return {
      href,
      episodes: [
        toEpisodeFixture(first),
        toEpisodeFixture(second),
        toEpisodeFixture(third),
      ],
    };
  }

  throw new Error(
    "no recently added transcoded episode has two playable successors",
  );
}

async function pressPlayerKey(page: Page, code: string): Promise<void> {
  await page.evaluate((keyCode) => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: keyCode, bubbles: true }),
    );
  }, code);
}

async function expectPlaybackConverged(
  viewers: readonly [Page, Page],
  label: string,
  targetSeconds?: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const [first, second] = await Promise.all([
          readPlaybackProbe(viewers[0]).catch(() => null),
          readPlaybackProbe(viewers[1]).catch(() => null),
        ]);
        if (!first || !second) {
          return {
            bothPlaying: false,
            synchronized: false,
            atTarget: false,
          };
        }
        return {
          bothPlaying: !first.paused && !second.paused,
          synchronized:
            Math.abs(
              first.timelinePositionSeconds - second.timelinePositionSeconds,
            ) < 5,
          atTarget:
            targetSeconds === undefined ||
            (Math.abs(first.timelinePositionSeconds - targetSeconds) < 10 &&
              Math.abs(second.timelinePositionSeconds - targetSeconds) < 10),
        };
      },
      { message: `${label}: viewers should converge`, timeout: 30_000 },
    )
    .toEqual({ bothPlaying: true, synchronized: true, atTarget: true });

  await Promise.all([
    expectPlayingAndAdvancing(viewers[0], `${label} first viewer`),
    expectPlayingAndAdvancing(viewers[1], `${label} second viewer`),
  ]);
}

async function expectPaused(
  viewers: readonly [Page, Page],
  paused: boolean,
  label: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        Promise.all(
          viewers.map((page) =>
            readPlaybackProbe(page)
              .then((sample) => sample.paused)
              .catch(() => null),
          ),
        ),
      { message: label, timeout: 15_000 },
    )
    .toEqual([paused, paused]);
}

async function settlePlaybackState(
  controller: Page,
  viewers: readonly [Page, Page],
  paused: boolean,
  label: string,
): Promise<void> {
  await controller.waitForTimeout(2_000);
  if ((await readPlaybackProbe(controller)).paused !== paused) {
    await pressPlayerKey(controller, "KeyK");
  }
  await expectPaused(viewers, paused, label);
}

async function runControlStorm(
  first: Page,
  second: Page,
  durationSeconds: number,
): Promise<void> {
  console.error("Torture step: simultaneous conflicting seeks");
  const conflictingSeekPairs: ReadonlyArray<readonly [string, string]> = [
    ["Digit2", "Digit8"],
    ["Digit7", "Digit1"],
    ["Digit3", "Digit9"],
  ];
  for (const [firstKey, secondKey] of conflictingSeekPairs) {
    await Promise.all([
      pressPlayerKey(first, firstKey),
      pressPlayerKey(second, secondKey),
    ]);
    await first.waitForTimeout(100);
  }
  await first.waitForTimeout(1_000);
  await pressPlayerKey(first, "Digit4");
  await expectPlaybackConverged(
    [first, second],
    "after conflicting seeks",
    durationSeconds * 0.4,
  );

  console.error("Torture step: simultaneous play/pause storm");
  for (let index = 0; index < 12; index += 1) {
    await Promise.all([
      pressPlayerKey(first, "KeyK"),
      pressPlayerKey(second, "KeyK"),
    ]);
    await first.waitForTimeout(75);
  }
  await settlePlaybackState(
    first,
    [first, second],
    true,
    "both viewers should settle paused after control contention",
  );
  await pressPlayerKey(first, "KeyK");
  await expectPlaybackConverged(
    [first, second],
    "after control contention resume",
  );
}

async function runOfflineRecovery(
  controller: Page,
  disconnected: Page,
  disconnectedContext: BrowserContext,
  label: string,
): Promise<void> {
  console.error(`Torture step: ${label} loses all network connectivity`);
  const before = (await readPlaybackProbe(controller)).timelinePositionSeconds;
  await disconnectedContext.setOffline(true);
  await controller.waitForTimeout(6_000);
  const after = (await readPlaybackProbe(controller)).timelinePositionSeconds;
  expect(
    after - before,
    "connected viewer should keep playing",
  ).toBeGreaterThan(2);
  await disconnectedContext.setOffline(false);
  await expectPlaybackConverged(
    [controller, disconnected],
    `${label} after network recovery`,
  );
}

async function abortNextTranscodeAndRecover(
  controller: Page,
  disrupted: Page,
  disruptedContext: BrowserContext,
  label: string,
): Promise<void> {
  let aborted = false;
  const handler = async (route: Route): Promise<void> => {
    if (!aborted) {
      aborted = true;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  };
  await disruptedContext.route(
    /\/video\/:\/transcode\/universal\/start/,
    handler,
  );
  try {
    console.error(`Torture step: abort ${label}'s next Plex transcode`);
    await pressPlayerKey(disrupted, "Digit6");
    await expect
      .poll(() => aborted, {
        message: `${label}: a real transcode request should be aborted`,
        timeout: 10_000,
      })
      .toBe(true);
    await expectPlaybackConverged(
      [controller, disrupted],
      `${label} after transcode retry`,
    );
  } finally {
    await disruptedContext.unroute(
      /\/video\/:\/transcode\/universal\/start/,
      handler,
    );
  }
}

async function currentEpisodeRatingKey(page: Page): Promise<string | null> {
  return page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => {
      const resourceUrls = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .reverse();
      for (const url of [video.currentSrc, video.src, ...resourceUrls]) {
        const ratingKey = /\/library\/metadata\/(\d+)/.exec(
          decodeURIComponent(url),
        )?.[1];
        if (ratingKey) return ratingKey;
      }
      return null;
    })
    .catch(() => null);
}

async function rotateAuthenticatedViewers(
  host: Page,
  guest: Page,
  expected: EpisodeFixture,
  previousRoomPath: string,
): Promise<string> {
  console.error(
    `Torture step: rotate both authenticated viewers to ${expected.ratingKey}`,
  );
  await pressPlayerKey(host, "End");
  await expect
    .poll(
      async () => ({
        hostEpisode: await currentEpisodeRatingKey(host),
        guestEpisode: await currentEpisodeRatingKey(guest),
        hostPath: new URL(host.url()).pathname,
        guestPath: new URL(guest.url()).pathname,
        movedTogether:
          new URL(host.url()).pathname !== previousRoomPath &&
          new URL(host.url()).pathname === new URL(guest.url()).pathname,
      }),
      { message: "both viewers should rotate together", timeout: 60_000 },
    )
    .toMatchObject({
      hostEpisode: expected.ratingKey,
      guestEpisode: expected.ratingKey,
      movedTogether: true,
    });
  const roomPath = new URL(host.url()).pathname;
  expect(roomPath).not.toBe(previousRoomPath);
  expect(new URL(guest.url()).pathname).toBe(roomPath);
  await expectPlaybackConverged([host, guest], "after episode rotation");
  return roomPath;
}

async function rotateGuestLinkViewers(
  host: Page,
  guest: Page,
  expected: EpisodeFixture,
  previousHostPath: string,
  previousGuestPath: string,
): Promise<{ readonly hostPath: string; readonly guestPath: string }> {
  console.error(
    `Torture step: rotate Guest Link viewers to ${expected.ratingKey}`,
  );
  await pressPlayerKey(host, "End");
  await expect
    .poll(
      async () => ({
        hostEpisode: await currentEpisodeRatingKey(host),
        guestEpisode: await currentEpisodeRatingKey(guest),
        hostMoved: new URL(host.url()).pathname !== previousHostPath,
        guestMoved: new URL(guest.url()).pathname !== previousGuestPath,
      }),
      {
        message: "Guest Link viewers should rotate together",
        timeout: 60_000,
      },
    )
    .toEqual({
      hostEpisode: expected.ratingKey,
      guestEpisode: expected.ratingKey,
      hostMoved: true,
      guestMoved: true,
    });
  const hostPath = new URL(host.url()).pathname;
  const guestPath = new URL(guest.url()).pathname;
  expect(hostPath).not.toBe(previousHostPath);
  expect(guestPath).not.toBe(previousGuestPath);
  await expectPlaybackConverged([host, guest], "after Guest Link rotation");
  return { hostPath, guestPath };
}

function roomIdFromPath(pathname: string): string {
  const roomId = pathname.split("/").filter(Boolean).at(-1);
  if (!roomId) throw new Error(`room id missing from path ${pathname}`);
  return roomId;
}

test("authenticated viewers survive control, transport, reconnect, and rotation torture", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  let fixture: EpisodeRun | undefined;
  const roomIds = new Set<string>();
  const synced = await setupSyncedRoom(browser, baseURL, testInfo, {
    openDetails: async (page) => {
      fixture = await pickThreeEpisodeRun(page);
      await openItemDetails(page, fixture.href);
    },
  });
  roomIds.add(synced.roomId);
  let activeGuest = synced.guest;

  try {
    const selected = fixture;
    if (!selected) throw new Error("three-episode fixture was not selected");
    const [first, second, third] = selected.episodes;

    console.error("Torture step: reload host during active transcoding");
    await synced.host.reload({ waitUntil: "domcontentloaded" });
    await expectPlaybackConverged(
      [synced.host, activeGuest],
      "after initial authenticated host reload",
    );

    console.error(
      "Torture step: recreate authenticated guest tab before stress",
    );
    await activeGuest.close();
    activeGuest = await synced.guestContext.newPage();
    await activeGuest.goto(`/watch-together/${synced.roomId}`);
    await expectPlaybackConverged(
      [synced.host, activeGuest],
      "after initial authenticated guest tab recreation",
    );

    await runControlStorm(synced.host, activeGuest, first.durationSeconds);
    await runOfflineRecovery(
      synced.host,
      activeGuest,
      synced.guestContext,
      "authenticated guest",
    );
    await abortNextTranscodeAndRecover(
      synced.host,
      activeGuest,
      synced.guestContext,
      "authenticated guest",
    );

    console.error("Torture step: sustain synchronized playback for 30 seconds");
    for (let sample = 0; sample < 6; sample += 1) {
      await synced.host.waitForTimeout(5_000);
      await expectPlaybackConverged(
        [synced.host, activeGuest],
        `long-running drift sample ${sample + 1}`,
      );
    }

    let roomPath = await rotateAuthenticatedViewers(
      synced.host,
      activeGuest,
      second,
      `/watch-together/${synced.roomId}`,
    );
    roomIds.add(roomIdFromPath(roomPath));

    console.error("Torture step: reload host in the successor room");
    await synced.host.reload({ waitUntil: "domcontentloaded" });
    await expectPlaybackConverged(
      [synced.host, activeGuest],
      "after authenticated host reload",
    );

    console.error("Torture step: close and recreate authenticated guest tab");
    await activeGuest.close();
    activeGuest = await synced.guestContext.newPage();
    await activeGuest.goto(roomPath);
    await expectPlaybackConverged(
      [synced.host, activeGuest],
      "after authenticated guest tab recreation",
    );

    roomPath = await rotateAuthenticatedViewers(
      synced.host,
      activeGuest,
      third,
      roomPath,
    );
    roomIds.add(roomIdFromPath(roomPath));
    await runControlStorm(synced.host, activeGuest, third.durationSeconds);
  } finally {
    for (const roomId of roomIds) {
      await disbandRoom(synced.hostContext, roomId);
    }
    await synced.cleanup();
  }
});

test("Guest Link viewers survive transport, rejoin, host refresh, and repeated rotation torture", async ({
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
  }).catch(async (error: unknown) => {
    await hostArtifacts.closeAndAttach();
    throw error;
  });
  const host = await hostArtifacts.context.newPage();
  const guest = await guestArtifacts.context.newPage();
  const roomIds = new Set<string>();
  const protectedMetadataResponses: number[] = [];
  guestArtifacts.context.on("response", (response) => {
    if (response.url().includes("/api/trpc/plex.getItemMetadata")) {
      protectedMetadataResponses.push(response.status());
    }
  });

  try {
    const fixture = await pickThreeEpisodeRun(host);
    const [first, second, third] = fixture.episodes;
    await openItemDetails(host, fixture.href);
    await host.getByRole("button", { name: "More actions" }).click();
    await host.getByRole("menuitem", { name: /watch together/i }).click();
    const dialog = host.getByRole("dialog");
    await dialog.getByRole("button", { name: /guest link/i }).click();
    const createGuestLink = dialog.getByRole("button", {
      name: "Create guest link",
    });
    await expect(createGuestLink).toBeEnabled({ timeout: 30_000 });
    await createGuestLink.click();
    await host.waitForURL(/\/watch-together\/[^/?]+$/, { timeout: 30_000 });
    roomIds.add(roomIdFromPath(new URL(host.url()).pathname));
    await host
      .getByRole("button", { name: "Copy Guest Watch Together link" })
      .click();
    const guestUrl = await host.evaluate(() => navigator.clipboard.readText());

    await guest.goto(guestUrl);
    await guest.getByLabel("Display name").fill("Torture Guest");
    await guest.getByRole("button", { name: "Join session" }).click();
    await expect(guest.getByText(/playback will begin/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(host.getByText("Torture Guest")).toBeVisible({
      timeout: 30_000,
    });
    await host.waitForTimeout(5_000);
    await host.getByRole("button", { name: "Start" }).click();
    await expectPlaybackConverged([host, guest], "initial Guest Link playback");

    await runControlStorm(host, guest, first.durationSeconds);
    await runOfflineRecovery(
      host,
      guest,
      guestArtifacts.context,
      "Guest Link viewer",
    );
    await abortNextTranscodeAndRecover(
      host,
      guest,
      guestArtifacts.context,
      "Guest Link viewer",
    );

    let paths = await rotateGuestLinkViewers(
      host,
      guest,
      second,
      new URL(host.url()).pathname,
      new URL(guest.url()).pathname,
    );
    roomIds.add(roomIdFromPath(paths.hostPath));

    console.error("Torture step: reload unauthenticated guest capability");
    await guest.reload({ waitUntil: "domcontentloaded" });
    const displayName = guest.getByLabel("Display name");
    await expect
      .poll(
        async () =>
          (await guest.locator("video").count()) > 0 ||
          (await displayName.isVisible().catch(() => false)),
        {
          message: "Guest reload should restore playback or the rejoin form",
          timeout: 10_000,
        },
      )
      .toBe(true);
    if (await displayName.isVisible().catch(() => false)) {
      await displayName.fill("Torture Guest");
      await guest.getByRole("button", { name: "Join session" }).click();
      await expect
        .poll(
          async () =>
            (await guest.locator("video").count()) > 0 ||
            (await guest
              .getByText(/playback will begin/i)
              .isVisible()
              .catch(() => false)),
          {
            message: "Guest rejoin should reach its lobby or resume playback",
            timeout: 10_000,
          },
        )
        .toBe(true);
    }
    await expectPlaybackConverged(
      [host, guest],
      "after Guest Link guest reload",
    );

    console.error("Torture step: reload Guest Link host in successor room");
    await host.reload({ waitUntil: "domcontentloaded" });
    const resumeFromLobby = host.getByRole("button", {
      name: /^(Join|Start)$/,
    });
    await expect
      .poll(
        async () =>
          (await host.locator("video").count()) > 0 ||
          (await resumeFromLobby.isEnabled().catch(() => false)),
        {
          message: "reloaded Guest Link host should resume or reach its lobby",
          timeout: 10_000,
        },
      )
      .toBe(true);
    if (await resumeFromLobby.isVisible().catch(() => false)) {
      await resumeFromLobby.click();
    }
    await expectPlaybackConverged(
      [host, guest],
      "after Guest Link host reload",
    );

    paths = await rotateGuestLinkViewers(
      host,
      guest,
      third,
      paths.hostPath,
      paths.guestPath,
    );
    roomIds.add(roomIdFromPath(paths.hostPath));
    await runControlStorm(host, guest, third.durationSeconds);
    expect(protectedMetadataResponses).toEqual([]);
  } finally {
    await Promise.all([
      host.keyboard.press("Escape").catch(() => undefined),
      guest.keyboard.press("Escape").catch(() => undefined),
    ]);
    await host.waitForTimeout(1_500).catch(() => undefined);
    for (const roomId of roomIds) {
      await disbandRoom(hostArtifacts.context, roomId);
    }
    await Promise.all([
      hostArtifacts.closeAndAttach(),
      guestArtifacts.closeAndAttach(),
    ]);
  }
});
