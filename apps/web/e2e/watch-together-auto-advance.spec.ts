import { test, expect, type Page } from "@playwright/test";
import {
  disbandRoom,
  expectPlayingAndAdvancing,
  openItemDetails,
  setupSyncedRoom,
} from "./helpers/watch-together";

interface EpisodePick {
  href: string;
  serverId: string;
  ratingKey: string;
  title: string;
  durationMs: number;
  next: { ratingKey: string; title: string };
}

interface PlayQueueItemShape {
  ratingKey?: string;
  title?: string;
  duration?: number;
}

/**
 * Finds an episode on the home page whose continuous play queue has a next
 * episode, using the app's own tRPC endpoint (authenticated via the page's
 * session), so the test doesn't hardcode library contents.
 */
async function pickEpisodeWithNext(page: Page): Promise<EpisodePick> {
  await page.goto("/");
  const links = page.locator('a[href*="/item/episode/"]');
  await expect(links.first()).toBeVisible({ timeout: 30_000 });
  const hrefs = [
    ...new Set(
      await links.evaluateAll((anchors) =>
        anchors.map((a) => a.getAttribute("href")),
      ),
    ),
  ].filter((href): href is string => Boolean(href));

  for (const href of hrefs) {
    const match = /\/item\/episode\/([^/]+)\/(\d+)/.exec(href);
    if (!match) continue;
    const [, serverId, ratingKey] = match;

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
    const body = (await response.json().catch(() => null)) as
      | {
          result?: {
            data?: {
              json?: { MediaContainer?: { Metadata?: PlayQueueItemShape[] } };
            };
          };
        }[]
      | null;
    const items = body?.[0]?.result?.data?.json?.MediaContainer?.Metadata ?? [];
    const index = items.findIndex((item) => item.ratingKey === ratingKey);
    const current = index >= 0 ? items[index] : undefined;
    const next = index >= 0 ? items[index + 1] : undefined;
    if (
      current?.duration &&
      next?.ratingKey &&
      serverId !== undefined &&
      ratingKey !== undefined &&
      // Prefer episodes short enough that Digit9 (90%) lands inside / near the
      // auto-advance lead window. Very long episodes flake when skip-forward
      // after a percent seek reloads the stream without the timeline offset.
      current.duration <= 12 * 60 * 1000
    ) {
      return {
        href,
        serverId,
        ratingKey,
        title: current.title ?? "",
        durationMs: current.duration,
        next: { ratingKey: next.ratingKey, title: next.title ?? "" },
      };
    }
  }

  throw new Error("no home episode with a next episode in its play queue");
}

/** Dispatches a player keyboard shortcut on the document (see seek test). */
async function pressPlayerKey(page: Page, code: string, shiftKey = false) {
  await page.evaluate(
    ({ code, shiftKey }) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code, shiftKey, bubbles: true }),
      );
    },
    { code, shiftKey },
  );
}

/** The viewer's full-timeline playback position (transcode offset + local). */
async function playbackPosition(page: Page): Promise<number> {
  return page
    .locator("video")
    .evaluate((el: HTMLVideoElement) => {
      const match = /[?&]offset=(\d+(?:\.\d+)?)/.exec(el.currentSrc);
      const offset = match ? Number(match[1]) : 0;
      return offset + el.currentTime;
    })
    .catch(() => 0);
}

/**
 * Identifies the episode the player is currently on. Transcoded streams carry
 * the rating key in the URL (`path=/library/metadata/{id}`); direct-play URLs
 * (`/library/parts/{partId}/...`) don't, so also read the player dialog's
 * accessible title ("Media Player - {episode title}") as a fallback signal.
 */
async function playingEpisode(
  page: Page,
): Promise<{ ratingKey: string | null; title: string | null }> {
  const ratingKey = await page
    .locator("video")
    .evaluate((el: HTMLVideoElement) => {
      const match = /\/library\/metadata\/(\d+)/.exec(
        decodeURIComponent(el.currentSrc),
      );
      return match?.[1] ?? null;
    })
    .catch(() => null);
  const title = await page
    .evaluate(() => {
      for (const heading of document.querySelectorAll("h2")) {
        const text = heading.textContent ?? "";
        if (text.startsWith("Media Player - ")) {
          return text.slice("Media Player - ".length);
        }
      }
      return null;
    })
    .catch(() => null);
  return { ratingKey, title };
}

test("a session auto-advances both viewers to the next episode without leaving the player", async ({
  browser,
  baseURL,
}) => {
  // Two live transcodes, a near-end seek, a real episode ending, and a second
  // pair of transcodes for the next episode: give it plenty of room.
  test.setTimeout(600_000);

  // The host picks an episode that verifiably has a next episode.
  let episode: EpisodePick | undefined;
  const { host, guest, hostContext, roomId, cleanup } = await setupSyncedRoom(
    browser,
    baseURL,
    {
      // Optional demo captures of the whole flow (E2E_RECORD_DIR=<dir>).
      recordVideoDir: process.env.E2E_RECORD_DIR,
      openDetails: async (page) => {
        episode = await pickEpisodeWithNext(page);
        console.error(
          `E2E step: picked episode ${episode.title} (${episode.ratingKey}) -> next ${episode.next.title} (${episode.next.ratingKey})`,
        );
        await openItemDetails(page, episode.href);
      },
    },
  );

  try {
    expect(episode, "an episode with a next episode").toBeTruthy();
    const durationSeconds = episode!.durationMs / 1000;

    // Seek close to the end through the app's real seek path (keyboard
    // shortcuts -> transcode reload), pacing the skips so each reload settles.
    console.error("E2E step: host seeks to 90%");
    await pressPlayerKey(host, "Digit9");
    await expectPlayingAndAdvancing(host, "host after 90% seek");

    const seekDeadline = Date.now() + 120_000;
    let lastRemaining = Number.POSITIVE_INFINITY;
    for (;;) {
      const remaining = durationSeconds - (await playbackPosition(host));
      console.error(`E2E step: host remaining ~${Math.round(remaining)}s`);
      // Land inside the auto-advance lead window (<=45s) but above the
      // countdown, so the whole arm -> create -> discover flow gets exercised.
      if (remaining <= 40) {
        break;
      }
      if (Date.now() > seekDeadline) {
        throw new Error("could not get near the episode end in time");
      }
      // If a skip-forward reload lost the timeline offset (remaining jumps back
      // up), re-assert the percent seek instead of digging a deeper hole.
      if (remaining > lastRemaining + 30) {
        await pressPlayerKey(host, "Digit9");
      } else {
        await pressPlayerKey(host, "ArrowRight", remaining > 75);
      }
      lastRemaining = remaining;
      await host.waitForTimeout(5_000);
    }

    // The guest follows the seek (their own remaining time drops too).
    await expect
      .poll(async () => durationSeconds - (await playbackPosition(guest)), {
        message: "guest should follow the host near the end",
        timeout: 60_000,
      })
      .toBeLessThan(60);

    // Both players must swap to the next episode's stream, and the player
    // modal must never close (no lobby flash): the <video> stays mounted.
    // Also watch for false leave/join toasts during the Syncplay room handoff.
    console.error("E2E step: waiting for auto-advance on both viewers");
    const swapDeadline = Date.now() + 180_000;
    const onNextEpisode = (episodeInfo: {
      ratingKey: string | null;
      title: string | null;
    }) =>
      episodeInfo.ratingKey === episode!.next.ratingKey ||
      (episodeInfo.ratingKey === null &&
        episodeInfo.title === episode!.next.title);
    const socialToastRe =
      /(left the session|joined the session|paused playback)/i;
    const unexpectedToasts: string[] = [];
    for (;;) {
      for (const page of [host, guest]) {
        const texts = await page
          .locator("[data-sonner-toast]")
          .allTextContents()
          .catch(() => []);
        for (const text of texts) {
          if (socialToastRe.test(text) && !unexpectedToasts.includes(text)) {
            unexpectedToasts.push(text);
          }
        }
      }
      const [hostEpisode, guestEpisode] = await Promise.all([
        playingEpisode(host),
        playingEpisode(guest),
      ]);
      await Promise.all(
        [[host, "host"] as const, [guest, "guest"] as const].map(
          async ([page, label]) => {
            await expect(
              page.locator("video"),
              `${label}: player must stay open through the swap`,
            ).toBeVisible();
          },
        ),
      );
      if (onNextEpisode(hostEpisode) && onNextEpisode(guestEpisode)) {
        break;
      }
      if (Date.now() > swapDeadline) {
        throw new Error(
          `auto-advance never happened (host=${JSON.stringify(hostEpisode)}, guest=${JSON.stringify(guestEpisode)}, expected=${episode!.next.ratingKey} "${episode!.next.title}")`,
        );
      }
      await host.waitForTimeout(2_500);
    }
    console.error("E2E step: both viewers are on the next episode");
    console.error(
      `E2E step: social toasts during swap: ${JSON.stringify(unexpectedToasts)}`,
    );
    expect(
      unexpectedToasts,
      "rotation must not toast leave/join/pause for the Syncplay room handoff",
    ).toEqual([]);

    // Give App Router replace a moment to commit, then require both backgrounds
    // on the same *next* room lobby — not the pre-swap room id.
    await expect
      .poll(
        async () => {
          const hostLobby = new URL(host.url()).pathname;
          const guestLobby = new URL(guest.url()).pathname;
          return {
            hostLobby,
            guestLobby,
            movedOffOriginal:
              hostLobby !== `/watch-together/${roomId}` &&
              guestLobby !== `/watch-together/${roomId}`,
            matched:
              hostLobby === guestLobby &&
              hostLobby.startsWith("/watch-together/"),
          };
        },
        {
          message:
            "both viewers should share the next-room lobby URL after swap",
          timeout: 30_000,
        },
      )
      .toMatchObject({ movedOffOriginal: true, matched: true });
    const hostPath = new URL(host.url()).pathname;
    console.error(`E2E step: both lobby URLs on ${hostPath}`);

    // ...and the next episode actually plays for both.
    await Promise.all([
      expectPlayingAndAdvancing(host, "host next episode"),
      expectPlayingAndAdvancing(guest, "guest next episode"),
    ]);
    console.error("E2E step: next episode playing on both viewers");

    // Regression: after episode rotation the session must still own Syncplay.
    // A mismatch-triggered leave during swap used to kill pause propagation.
    console.error("E2E step: host pauses after auto-advance");
    await host.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
    await expect
      .poll(
        () =>
          guest
            .locator("video")
            .evaluate((v: HTMLVideoElement) => v.paused)
            .catch(() => false),
        {
          message: "guest should pause when host pauses after auto-advance",
          timeout: 30_000,
        },
      )
      .toBe(true);
    console.error("E2E step: guest paused with host after auto-advance");

    console.error("E2E step: host resumes after auto-advance");
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
        {
          message: "guest should resume when host resumes after auto-advance",
          timeout: 30_000,
        },
      )
      .toBe(false);
    console.error("E2E step: guest resumed with host after auto-advance");

    // Seek sync must also survive rotation (same Syncplay controller path as
    // pause). Jump to ~50% via the real keyboard/transcode-reload seek path —
    // not near the end, which would arm another auto-advance cycle.
    console.error("E2E step: host seeks to ~50% after auto-advance");
    const nextDuration = await host
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.duration || 0);
    const seekTarget = nextDuration > 0 ? nextDuration * 0.5 : 0;
    expect(seekTarget, "next episode should expose a duration").toBeGreaterThan(
      30,
    );
    await pressPlayerKey(host, "Digit5");
    await expect
      .poll(async () => playbackPosition(guest), {
        message: "guest should follow the host's seek after auto-advance",
        timeout: 60_000,
      })
      .toBeGreaterThan(seekTarget - 60);
    console.error("E2E step: guest followed seek after auto-advance");

    // Closing the player must land on the live next-room lobby, not a deleted
    // previous room ("unavailable") — requires App Router URL follow on swap.
    console.error("E2E step: host closes player onto live lobby");
    const liveLobbyPath = new URL(host.url()).pathname;
    await host.locator('button[aria-label="Close"]').click();
    await expect(host.locator("video")).toHaveCount(0, { timeout: 15_000 });
    await expect(
      host.getByText("This Watch Together room is unavailable."),
    ).toHaveCount(0);
    await expect(host).toHaveURL(/\/watch-together\/[^/]+/);
    // Prefer staying on the live room we were following; allow a replace that
    // lands on the session room if the earlier URL read was still catching up.
    const afterClosePath = new URL(host.url()).pathname;
    expect(
      afterClosePath.startsWith("/watch-together/"),
      `expected live lobby after close, got ${afterClosePath} (pre-close ${liveLobbyPath})`,
    ).toBe(true);
    console.error(`E2E step: host is on ${afterClosePath} after close`);

    await guest.waitForTimeout(2_000);
    await expect(guest.locator("video")).toBeVisible();
  } finally {
    // Disband whatever rooms this test left behind (the original room is
    // usually already removed by the rotation; the next-episode room isn't).
    const rooms = await hostContext.request
      .get(
        "/api/trpc/plex.getWatchTogetherRooms?batch=1&input=" +
          encodeURIComponent(JSON.stringify({ 0: { json: null } })),
      )
      .then(
        (response) =>
          response.json() as Promise<
            {
              result?: {
                data?: { json?: { id: string; sourceUri: string }[] };
              };
            }[]
          >,
      )
      .catch(() => null);
    for (const room of rooms?.[0]?.result?.data?.json ?? []) {
      if (
        episode &&
        (room.sourceUri.endsWith(`/library/metadata/${episode.ratingKey}`) ||
          room.sourceUri.endsWith(
            `/library/metadata/${episode.next.ratingKey}`,
          ))
      ) {
        await disbandRoom(hostContext, room.id);
      }
    }
    await cleanup();
  }
});
