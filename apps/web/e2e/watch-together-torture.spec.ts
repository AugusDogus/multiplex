import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
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

const NETWORK_RECOVERY_SLO_MS = 5_000;
const STEADY_PLAYBACK_OBSERVATION_MS = 135_000;
const RUN_FULL_EPISODE_WITH_LATENCY =
  process.env.WATCH_TOGETHER_FULL_EPISODE === "1";
const TARGET_MEDIA_HREF = process.env.WATCH_TOGETHER_MEDIA_HREF;
const DEFAULT_CONTROL_FUZZ_SEED = 0x51c0ffee;
const parsedControlFuzzSeed = z.coerce
  .number()
  .int()
  .min(0)
  .max(0xffffffff)
  .safeParse(process.env.WATCH_TOGETHER_FUZZ_SEED);
const CONTROL_FUZZ_SEED = parsedControlFuzzSeed.success
  ? parsedControlFuzzSeed.data
  : DEFAULT_CONTROL_FUZZ_SEED;

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
  const discoveredHrefs = [
    ...new Set(
      await links.evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href")),
      ),
    ),
  ].filter((href): href is string => Boolean(href));
  const hrefs = TARGET_MEDIA_HREF
    ? [TARGET_MEDIA_HREF, ...discoveredHrefs]
    : discoveredHrefs;

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
  await page.keyboard.press(code);
}

async function expectPlaybackConverged(
  viewers: readonly [Page, Page],
  label: string,
  targetSeconds?: number,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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
      { message: `${label}: viewers should converge`, timeout: timeoutMs },
    )
    .toEqual({ bothPlaying: true, synchronized: true, atTarget: true });

  const remainingMs = Math.max(1, deadline - Date.now());
  await Promise.all([
    expectPlayingAndAdvancing(viewers[0], `${label} first viewer`, remainingMs),
    expectPlayingAndAdvancing(
      viewers[1],
      `${label} second viewer`,
      remainingMs,
    ),
  ]);
}

async function expectPaused(
  viewers: readonly [Page, Page],
  paused: boolean,
  label: string,
  timeoutMs = 15_000,
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
      { message: label, timeout: timeoutMs },
    )
    .toEqual([paused, paused]);
}

interface SteadyPlaybackTracker {
  source: string;
  lastProgressAt: number;
  lastProgressPosition: number;
  lowReadyStateSince: number | null;
  pausedSince: number | null;
  reportedLowReadyState: boolean;
  reportedPaused: boolean;
  reportedStall: boolean;
}

function makeSteadyPlaybackTracker(
  source: string,
  positionSeconds: number,
  startedAt: number,
): SteadyPlaybackTracker {
  return {
    source,
    lastProgressAt: startedAt,
    lastProgressPosition: positionSeconds,
    lowReadyStateSince: null,
    pausedSince: null,
    reportedLowReadyState: false,
    reportedPaused: false,
    reportedStall: false,
  };
}

async function observeUninterruptedPlayback(
  viewers: readonly [Page, Page],
  testInfo: TestInfo,
  options: {
    readonly attachmentName: string;
    readonly durationMs: number;
    readonly isComplete?: () => Promise<boolean>;
  },
): Promise<boolean> {
  const [initialHost, initialGuest] = await Promise.all([
    readPlaybackProbe(viewers[0]),
    readPlaybackProbe(viewers[1]),
  ]);
  const startedAt = Date.now();
  const trackers = {
    host: makeSteadyPlaybackTracker(
      initialHost.currentSrc,
      initialHost.timelinePositionSeconds,
      startedAt,
    ),
    guest: makeSteadyPlaybackTracker(
      initialGuest.currentSrc,
      initialGuest.timelinePositionSeconds,
      startedAt,
    ),
  };
  const observations: Array<{
    readonly atMs: number;
    readonly viewer: "host" | "guest";
    readonly timelinePositionSeconds: number;
    readonly paused: boolean;
    readonly readyState: number;
    readonly networkState: number;
    readonly sourceChanged: boolean;
  }> = [];
  const issues: Array<{
    readonly atMs: number;
    readonly viewer: "host" | "guest";
    readonly kind:
      | "source-changed"
      | "unexpected-backward-seek"
      | "paused"
      | "low-ready-state"
      | "stalled";
    readonly detail: string;
  }> = [];
  let completed = false;
  let reachedNaturalEnd = false;

  while (Date.now() - startedAt < options.durationMs) {
    await viewers[0].waitForTimeout(1_000);
    if (await options.isComplete?.()) {
      completed = true;
      break;
    }
    const [hostSample, guestSample] = await Promise.all([
      readPlaybackProbe(viewers[0]),
      readPlaybackProbe(viewers[1]),
    ]);
    const now = Date.now();
    const labeledSamples = [
      ["host", hostSample],
      ["guest", guestSample],
    ] as const;

    reachedNaturalEnd ||= labeledSamples.every(([, sample]) => {
      const remainingSourceSeconds =
        sample.durationSeconds - sample.currentTimeSeconds;
      return (
        sample.ended ||
        (sample.durationSeconds > 0 &&
          Number.isFinite(remainingSourceSeconds) &&
          remainingSourceSeconds <= 1)
      );
    });

    // Reaching EOF resets each media element before the successor room route
    // commits. Those resets and source changes are the expected rotation, not
    // interruptions in the episode that just completed.
    if (reachedNaturalEnd) continue;

    for (const [viewer, sample] of labeledSamples) {
      const tracker = trackers[viewer];
      const atMs = now - startedAt;
      const sourceChanged = sample.currentSrc !== tracker.source;
      observations.push({
        atMs,
        viewer,
        timelinePositionSeconds: sample.timelinePositionSeconds,
        paused: sample.paused,
        readyState: sample.readyState,
        networkState: sample.networkState,
        sourceChanged,
      });

      if (sourceChanged) {
        issues.push({
          atMs,
          viewer,
          kind: "source-changed",
          detail: "The video source changed during passive playback",
        });
        tracker.source = sample.currentSrc;
        tracker.lastProgressAt = now;
        tracker.lastProgressPosition = sample.timelinePositionSeconds;
      } else if (
        sample.timelinePositionSeconds <
        tracker.lastProgressPosition - 2
      ) {
        issues.push({
          atMs,
          viewer,
          kind: "unexpected-backward-seek",
          detail: `${tracker.lastProgressPosition.toFixed(2)} -> ${sample.timelinePositionSeconds.toFixed(2)}`,
        });
        tracker.lastProgressAt = now;
        tracker.lastProgressPosition = sample.timelinePositionSeconds;
      } else if (
        sample.timelinePositionSeconds >
        tracker.lastProgressPosition + 0.25
      ) {
        tracker.lastProgressAt = now;
        tracker.lastProgressPosition = sample.timelinePositionSeconds;
        tracker.reportedStall = false;
      }

      if (sample.paused || sample.ended) {
        tracker.pausedSince ??= now;
        if (!tracker.reportedPaused && now - tracker.pausedSince >= 3_000) {
          issues.push({
            atMs,
            viewer,
            kind: "paused",
            detail: "Playback remained paused for at least 3 seconds",
          });
          tracker.reportedPaused = true;
        }
      } else {
        tracker.pausedSince = null;
        tracker.reportedPaused = false;
      }

      if (sample.readyState < 3) {
        tracker.lowReadyStateSince ??= now;
        if (
          !tracker.reportedLowReadyState &&
          now - tracker.lowReadyStateSince >= 5_000
        ) {
          issues.push({
            atMs,
            viewer,
            kind: "low-ready-state",
            detail: `readyState remained ${sample.readyState} for at least 5 seconds`,
          });
          tracker.reportedLowReadyState = true;
        }
      } else {
        tracker.lowReadyStateSince = null;
        tracker.reportedLowReadyState = false;
      }

      if (!tracker.reportedStall && now - tracker.lastProgressAt >= 8_000) {
        issues.push({
          atMs,
          viewer,
          kind: "stalled",
          detail: "Timeline position did not advance for at least 8 seconds",
        });
        tracker.reportedStall = true;
      }
    }
  }

  await testInfo.attach(options.attachmentName, {
    body: Buffer.from(
      JSON.stringify({ completed, issues, observations }, null, 2),
    ),
    contentType: "application/json",
  });
  expect(
    issues,
    "Playback should remain uninterrupted after real controls and subtitle selection",
  ).toEqual([]);
  return completed;
}

async function settlePlaybackState(
  controller: Page,
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
              .then((sample) => sample.readyState >= 2)
              .catch(() => false),
          ),
        ),
      {
        message: `${label}: replacement sources should become media-ready`,
        timeout: 30_000,
      },
    )
    .toEqual([true, true]);
  // A replacement source can briefly be media-ready but paused before its
  // accepted room playstate is re-applied. Confirm the target across full
  // arbitration ticks, retrying from a viewer that actually differs.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await controller.waitForTimeout(1_000);
    const samples = await Promise.all(
      viewers.map((page) => readPlaybackProbe(page).catch(() => null)),
    );
    const actorIndex = samples.findIndex(
      (sample) => sample !== null && sample.paused !== paused,
    );
    const actor = actorIndex >= 0 ? viewers[actorIndex] : undefined;
    if (actor) {
      await pressPlayerKey(actor, "KeyK");
      continue;
    }

    await controller.waitForTimeout(1_000);
    const confirmation = await Promise.all(
      viewers.map((page) => readPlaybackProbe(page).catch(() => null)),
    );
    if (confirmation.every((sample) => sample?.paused === paused)) {
      return;
    }
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

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function runSeededControlFuzz(
  first: Page,
  second: Page,
  durationSeconds: number,
  label: string,
  seed: number,
): Promise<void> {
  console.error(
    `Torture step: ${label} seeded control fuzz (seed ${seed >>> 0})`,
  );
  const random = createSeededRandom(seed);
  const viewers: readonly [Page, Page] = [first, second];
  const seekKeys = [
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
  ] as const;
  const pickViewer = (): Page =>
    viewers[Math.floor(random() * viewers.length)] ?? first;
  const pickSeekKey = (): (typeof seekKeys)[number] =>
    seekKeys[Math.floor(random() * seekKeys.length)] ?? "Digit5";

  for (let wave = 0; wave < 3; wave += 1) {
    for (let action = 0; action < 10; action += 1) {
      const operation = random();
      if (operation < 0.25) {
        await Promise.all([
          pressPlayerKey(first, pickSeekKey()),
          pressPlayerKey(second, pickSeekKey()),
        ]);
      } else if (operation < 0.6) {
        await pressPlayerKey(pickViewer(), pickSeekKey());
      } else if (operation < 0.85) {
        await pressPlayerKey(pickViewer(), "KeyK");
      } else {
        await Promise.all([
          pressPlayerKey(first, "KeyK"),
          pressPlayerKey(second, "KeyK"),
        ]);
      }
      await first.waitForTimeout(30 + Math.floor(random() * 140));
    }

    await settlePlaybackState(
      first,
      viewers,
      true,
      `${label} fuzz wave ${wave + 1} should settle paused`,
    );
    await pressPlayerKey(first, "KeyK");
    const targetDigit = 2 + Math.floor(random() * 7);
    await pressPlayerKey(first, `Digit${targetDigit}`);
    await expectPlaybackConverged(
      viewers,
      `${label} after fuzz wave ${wave + 1}`,
      durationSeconds * (targetDigit / 10),
    );
  }
}

async function stallRemoteTranscodeAndRecover(
  controller: Page,
  disrupted: Page,
  disruptedContext: BrowserContext,
  durationSeconds: number,
  label: string,
): Promise<void> {
  let requestCount = 0;
  let releaseFirstRequest = (): void => undefined;
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    requestCount += 1;
    if (requestCount === 1) {
      await firstRequestGate;
    }
    await route.continue();
  };
  await disruptedContext.route(
    /\/video\/:\/transcode\/universal\/start/,
    handler,
  );
  try {
    console.error(`Torture step: stall ${label}'s remote-seek transcode`);
    await pressPlayerKey(controller, "Digit5");
    await expect
      .poll(() => requestCount, {
        message: `${label}: remote seek should start a real transcode`,
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await controller.waitForTimeout(6_000);
    expect(
      requestCount,
      `${label}: room heartbeats must not replace a still-loading transcode`,
    ).toBe(1);
    releaseFirstRequest();
    await expectPlaybackConverged(
      [controller, disrupted],
      `${label} after stalled transcode`,
      durationSeconds * 0.5,
    );
  } finally {
    releaseFirstRequest();
    await disruptedContext.unroute(
      /\/video\/:\/transcode\/universal\/start/,
      handler,
    );
  }
}

async function exerciseSubtitleSelection(
  viewer: Page,
  peer: Page,
  viewerLabel: string,
): Promise<void> {
  const openSubtitlesPane = async (): Promise<Locator> => {
    const videoBox = await viewer.locator("video").boundingBox();
    if (!videoBox) {
      throw new Error(`${viewerLabel} video should have a layout box`);
    }
    await viewer.mouse.move(
      videoBox.x + videoBox.width / 2,
      videoBox.y + videoBox.height - 24,
    );
    await viewer.getByRole("button", { name: "Playback settings" }).click();
    const popover = viewer.locator('[data-slot="popover-popup"]');
    const subtitles = popover
      .getByRole("button", { name: /^Subtitles .+/ })
      .first();
    await expect(subtitles).toBeEnabled();
    await subtitles.click();
    return popover;
  };

  console.error(`Torture step: ${viewerLabel} disables subtitles`);
  let popover = await openSubtitlesPane();
  await popover.getByRole("button", { name: "None", exact: true }).click();
  await expect(
    popover.getByRole("button", { name: /^Subtitles .+/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await viewer.getByRole("button", { name: "Playback settings" }).click();
  await expectPlaybackConverged(
    [peer, viewer],
    `after ${viewerLabel} subtitles are disabled`,
  );

  console.error(`Torture step: ${viewerLabel} enables subtitles`);
  popover = await openSubtitlesPane();
  const firstSubtitle = popover.locator('button[aria-pressed="false"]').first();
  await expect(firstSubtitle).toBeEnabled();
  await firstSubtitle.click();
  await expect(
    popover.getByRole("button", { name: /^Subtitles .+/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await viewer.getByRole("button", { name: "Playback settings" }).click();
  await expectPlaybackConverged(
    [peer, viewer],
    `after ${viewerLabel} subtitles are enabled`,
  );
}

async function replayReportedControlSequence(
  host: Page,
  invitedViewer: Page,
  durationSeconds: number,
  viewerLabel: string,
): Promise<void> {
  console.error(`Torture step: ${viewerLabel} pauses and resumes`);
  await pressPlayerKey(invitedViewer, "KeyK");
  await expectPaused(
    [host, invitedViewer],
    true,
    `host should follow ${viewerLabel} pause`,
  );
  await invitedViewer.waitForTimeout(1_000);
  await pressPlayerKey(invitedViewer, "KeyK");
  await expectPlaybackConverged(
    [host, invitedViewer],
    `after ${viewerLabel} resume`,
  );

  console.error("Torture step: host pauses and resumes");
  await pressPlayerKey(host, "KeyK");
  await expectPaused(
    [host, invitedViewer],
    true,
    `${viewerLabel} should follow host pause`,
  );
  await host.waitForTimeout(1_000);
  await pressPlayerKey(host, "KeyK");
  await expectPlaybackConverged([host, invitedViewer], "after host resume");

  console.error(`Torture step: ${viewerLabel} seeks manually`);
  await pressPlayerKey(invitedViewer, "Digit4");
  await expectPlaybackConverged(
    [host, invitedViewer],
    `after ${viewerLabel} seek`,
    durationSeconds * 0.4,
  );

  await exerciseSubtitleSelection(invitedViewer, host, viewerLabel);
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
  const recoveryDeadline = Date.now() + NETWORK_RECOVERY_SLO_MS;
  await pressPlayerKey(controller, "KeyK");
  await expectPaused(
    [controller, disconnected],
    true,
    `${label} should receive a pause after reconnecting`,
    Math.max(1, recoveryDeadline - Date.now()),
  );
  await controller.waitForTimeout(1_000);
  await pressPlayerKey(controller, "KeyK");
  await expectPlaybackConverged(
    [controller, disconnected],
    `${label} after network recovery`,
    undefined,
    Math.max(1, recoveryDeadline - Date.now()),
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
  await host.getByRole("slider", { name: "Playback position" }).press("End");
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
  await host.getByRole("slider", { name: "Playback position" }).press("End");
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
  test.setTimeout(RUN_FULL_EPISODE_WITH_LATENCY ? 7_200_000 : 600_000);
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

    if (RUN_FULL_EPISODE_WITH_LATENCY) {
      const guestNetwork = await synced.guestContext.newCDPSession(activeGuest);
      await guestNetwork.send("Network.enable");
      await guestNetwork.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 300,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: "cellular3g",
      });
      await replayReportedControlSequence(
        synced.host,
        activeGuest,
        first.durationSeconds,
        "authenticated invited viewer",
      );
      console.error(
        "Torture step: reset to the beginning and play a full episode with 300ms authenticated invited-viewer latency",
      );
      await pressPlayerKey(activeGuest, "Digit0");
      await expectPlaybackConverged(
        [synced.host, activeGuest],
        "at the beginning of the authenticated full-episode run",
        0,
        60_000,
      );
      const initialRoomPath = new URL(synced.host.url()).pathname;
      const completed = await observeUninterruptedPlayback(
        [synced.host, activeGuest],
        testInfo,
        {
          attachmentName: "authenticated-full-episode-playback.json",
          durationMs: (first.durationSeconds + 180) * 1_000,
          isComplete: async () =>
            new URL(synced.host.url()).pathname !== initialRoomPath,
        },
      );
      expect(
        completed,
        "The full episode should reach natural rotation before its duration plus the recovery allowance",
      ).toBe(true);
      const successorPath = new URL(synced.host.url()).pathname;
      roomIds.add(roomIdFromPath(successorPath));
      await expect
        .poll(() => new URL(activeGuest.url()).pathname, {
          message:
            "The delayed authenticated invited viewer should follow natural rotation",
          timeout: 60_000,
        })
        .toBe(successorPath);
      await expectPlaybackConverged(
        [synced.host, activeGuest],
        "after the delayed authenticated viewer completes the full episode",
      );
      return;
    }

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
    await runSeededControlFuzz(
      synced.host,
      activeGuest,
      first.durationSeconds,
      "authenticated viewers",
      CONTROL_FUZZ_SEED,
    );
    await stallRemoteTranscodeAndRecover(
      synced.host,
      activeGuest,
      synced.guestContext,
      first.durationSeconds,
      "authenticated guest",
    );
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
  test.setTimeout(900_000);
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

    await replayReportedControlSequence(
      host,
      guest,
      first.durationSeconds,
      "Guest Link viewer",
    );
    await host.waitForTimeout(5_000);
    await expectPlaybackConverged(
      [host, guest],
      "before passive Guest Link observation",
    );
    console.error(
      `Torture step: observe ${STEADY_PLAYBACK_OBSERVATION_MS / 1_000} seconds of passive Guest Link playback`,
    );
    await observeUninterruptedPlayback([host, guest], testInfo, {
      attachmentName: "guest-link-steady-playback.json",
      durationMs: STEADY_PLAYBACK_OBSERVATION_MS,
    });
    await runControlStorm(host, guest, first.durationSeconds);
    await runSeededControlFuzz(
      host,
      guest,
      first.durationSeconds,
      "Guest Link viewers",
      CONTROL_FUZZ_SEED ^ 0x9e3779b9,
    );
    await stallRemoteTranscodeAndRecover(
      host,
      guest,
      guestArtifacts.context,
      first.durationSeconds,
      "Guest Link viewer",
    );
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
